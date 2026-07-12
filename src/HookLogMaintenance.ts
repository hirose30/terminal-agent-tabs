/**
 * Pure decision logic + file operations for keeping agent-events.jsonl bounded:
 * size-triggered rotation with generation retention (A), event-type hook filtering (B),
 * and a one-time startup trim safety valve for pre-existing oversized files (D).
 */

import * as fs from 'fs';

export interface RotationStep {
	op: 'delete' | 'rename';
	/** Generation index. 0 = the active log file (no suffix); N = `<base>.N`. */
	from: number;
	to?: number;
}

/** True once a file has grown to (or past) the configured size limit. */
export function isOverSizeLimit(currentSizeBytes: number, maxSizeBytes: number): boolean {
	if (maxSizeBytes <= 0) return false;
	return currentSizeBytes >= maxSizeBytes;
}

/** Path for a given rotation generation. Generation 0 is the active (unsuffixed) file. */
export function rotationFilePath(basePath: string, generation: number): string {
	return generation <= 0 ? basePath : `${basePath}.${generation}`;
}

/**
 * Build the ordered rename/delete plan for rotating the active log into generation 1,
 * shifting older generations up, and dropping whatever falls off the retained window.
 * Steps must be applied in the returned order (oldest generation first) so a rename
 * never clobbers a file before it has been moved out of the way.
 */
export function planRotation(maxGenerations: number): RotationStep[] {
	const generations = Math.max(1, Math.floor(maxGenerations));
	const steps: RotationStep[] = [{ op: 'delete', from: generations }];
	for (let gen = generations - 1; gen >= 1; gen -= 1) {
		steps.push({ op: 'rename', from: gen, to: gen + 1 });
	}
	steps.push({ op: 'rename', from: 0, to: 1 });
	return steps;
}

/** Apply a rotation plan against real files on disk. Missing files are silently skipped. */
export function applyRotationPlan(basePath: string, steps: RotationStep[]): void {
	for (const step of steps) {
		const fromPath = rotationFilePath(basePath, step.from);
		if (step.op === 'delete') {
			try {
				fs.rmSync(fromPath);
			} catch (error) {
				if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
			}
			continue;
		}
		const toPath = rotationFilePath(basePath, step.to as number);
		try {
			fs.renameSync(fromPath, toPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
		}
	}
}

/** Drop everything up to and including the first newline, so a byte-range read starts on a clean line. */
export function alignToLineBoundary(text: string): string {
	const newlineIndex = text.indexOf('\n');
	if (newlineIndex === -1) return '';
	return text.slice(newlineIndex + 1);
}

/**
 * One-time startup safety valve: if an existing log already exceeds the size limit
 * (e.g. an upgrade from a version without rotation), trim it down to the last
 * maxSizeBytes worth of content, aligned to a line boundary. No-op if under the limit.
 * Returns true if a trim was performed.
 */
export async function trimLogFileIfOversized(filePath: string, maxSizeBytes: number): Promise<boolean> {
	let stats: fs.Stats;
	try {
		stats = await fs.promises.stat(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
		throw error;
	}

	if (!isOverSizeLimit(stats.size, maxSizeBytes)) return false;

	const startOffset = Math.max(0, stats.size - maxSizeBytes);
	const readSize = stats.size - startOffset;
	const buffer = Buffer.alloc(readSize);
	const handle = await fs.promises.open(filePath, 'r');
	try {
		await handle.read(buffer, 0, readSize, startOffset);
	} finally {
		await handle.close();
	}

	const trimmed = alignToLineBoundary(buffer.toString('utf8'));
	const tmpPath = `${filePath}.trim-${process.pid}-${Date.now()}`;
	await fs.promises.writeFile(tmpPath, trimmed, 'utf8');
	await fs.promises.rename(tmpPath, filePath);
	return true;
}

export interface HookEventTypeFlags {
	notification: boolean;
	stop: boolean;
	preToolUse: boolean;
}

/**
 * Assemble the Claude Code `--settings` hooks payload from the enabled event-type
 * flags, omitting any type the user has turned off. Returns null when every type
 * is disabled (nothing to inject).
 */
export function buildHookSettingsPayload(
	flags: HookEventTypeFlags,
	commandFor: (hookType: string) => string
): { hooks: Record<string, unknown> } | null {
	const hooks: Record<string, unknown> = {};

	if (flags.notification) {
		hooks.Notification = [{
			matcher: '',
			hooks: [{ type: 'command', command: commandFor('notification'), timeout: 10 }]
		}];
	}
	if (flags.stop) {
		hooks.Stop = [{
			matcher: '',
			hooks: [{ type: 'command', command: commandFor('stop'), timeout: 10 }]
		}];
	}
	if (flags.preToolUse) {
		hooks.PreToolUse = [{
			matcher: '',
			hooks: [{ type: 'command', command: commandFor('pre-tool-use'), timeout: 5 }]
		}];
	}

	if (Object.keys(hooks).length === 0) return null;
	return { hooks };
}
