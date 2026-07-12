import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
	isOverSizeLimit,
	rotationFilePath,
	planRotation,
	applyRotationPlan,
	alignToLineBoundary,
	trimLogFileIfOversized,
	buildHookSettingsPayload
} from '../HookLogMaintenance';

describe('isOverSizeLimit()', () => {
	it('is false when under the limit', () => {
		expect(isOverSizeLimit(100, 200)).toBe(false);
	});

	it('is true when exactly at the limit', () => {
		expect(isOverSizeLimit(200, 200)).toBe(true);
	});

	it('is true when over the limit', () => {
		expect(isOverSizeLimit(300, 200)).toBe(true);
	});

	it('is false when the limit is zero or negative (disabled)', () => {
		expect(isOverSizeLimit(1_000_000, 0)).toBe(false);
		expect(isOverSizeLimit(1_000_000, -1)).toBe(false);
	});
});

describe('rotationFilePath()', () => {
	it('generation 0 is the unsuffixed active file', () => {
		expect(rotationFilePath('/tmp/agent-events.jsonl', 0)).toBe('/tmp/agent-events.jsonl');
	});

	it('generation N appends .N', () => {
		expect(rotationFilePath('/tmp/agent-events.jsonl', 1)).toBe('/tmp/agent-events.jsonl.1');
		expect(rotationFilePath('/tmp/agent-events.jsonl', 2)).toBe('/tmp/agent-events.jsonl.2');
	});
});

describe('planRotation()', () => {
	it('for 1 retained generation: delete .1, then move active to .1', () => {
		expect(planRotation(1)).toEqual([
			{ op: 'delete', from: 1 },
			{ op: 'rename', from: 0, to: 1 }
		]);
	});

	it('for 2 retained generations: delete .2, shift .1->.2, move active to .1', () => {
		expect(planRotation(2)).toEqual([
			{ op: 'delete', from: 2 },
			{ op: 'rename', from: 1, to: 2 },
			{ op: 'rename', from: 0, to: 1 }
		]);
	});

	it('clamps generations below 1 up to 1', () => {
		expect(planRotation(0)).toEqual(planRotation(1));
		expect(planRotation(-5)).toEqual(planRotation(1));
	});
});

describe('alignToLineBoundary()', () => {
	it('drops everything up to and including the first newline', () => {
		expect(alignToLineBoundary('partial\ncomplete line 1\ncomplete line 2\n'))
			.toBe('complete line 1\ncomplete line 2\n');
	});

	it('returns empty string when there is no newline (all partial)', () => {
		expect(alignToLineBoundary('no newline here')).toBe('');
	});

	it('returns empty string for an empty input', () => {
		expect(alignToLineBoundary('')).toBe('');
	});
});

describe('buildHookSettingsPayload()', () => {
	const commandFor = (hookType: string) => `run ${hookType}`;

	it('includes only enabled event types', () => {
		const payload = buildHookSettingsPayload(
			{ notification: true, stop: true, preToolUse: false },
			commandFor
		);
		expect(payload).not.toBeNull();
		expect(Object.keys(payload!.hooks).sort()).toEqual(['Notification', 'Stop']);
	});

	it('includes PreToolUse when explicitly enabled', () => {
		const payload = buildHookSettingsPayload(
			{ notification: false, stop: false, preToolUse: true },
			commandFor
		);
		expect(Object.keys(payload!.hooks)).toEqual(['PreToolUse']);
	});

	it('returns null when every event type is disabled', () => {
		const payload = buildHookSettingsPayload(
			{ notification: false, stop: false, preToolUse: false },
			commandFor
		);
		expect(payload).toBeNull();
	});

	it('wires the command factory into each hook entry', () => {
		const payload = buildHookSettingsPayload(
			{ notification: true, stop: false, preToolUse: false },
			commandFor
		);
		const notificationHooks = (payload!.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>).Notification;
		expect(notificationHooks[0].hooks[0].command).toBe('run notification');
	});
});

describe('applyRotationPlan() + planRotation() integration', () => {
	let dir: string;
	let basePath: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tat-log-rotation-'));
		basePath = path.join(dir, 'agent-events.jsonl');
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('rotates the active file to .1 when no backups exist yet', () => {
		fs.writeFileSync(basePath, 'active content\n');
		applyRotationPlan(basePath, planRotation(2));

		expect(fs.existsSync(basePath)).toBe(false);
		expect(fs.readFileSync(`${basePath}.1`, 'utf8')).toBe('active content\n');
	});

	it('shifts existing generations and drops the oldest beyond the retention window', () => {
		fs.writeFileSync(basePath, 'newest\n');
		fs.writeFileSync(`${basePath}.1`, 'gen1\n');
		fs.writeFileSync(`${basePath}.2`, 'gen2 (oldest)\n');

		applyRotationPlan(basePath, planRotation(2));

		expect(fs.existsSync(basePath)).toBe(false);
		expect(fs.readFileSync(`${basePath}.1`, 'utf8')).toBe('newest\n');
		expect(fs.readFileSync(`${basePath}.2`, 'utf8')).toBe('gen1\n');
		// gen2 content ("gen2 (oldest)") was deleted, not shifted further.
	});

	it('is a no-op when the active file does not exist', () => {
		expect(() => applyRotationPlan(basePath, planRotation(2))).not.toThrow();
		expect(fs.existsSync(`${basePath}.1`)).toBe(false);
	});
});

describe('trimLogFileIfOversized()', () => {
	let dir: string;
	let filePath: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tat-log-trim-'));
		filePath = path.join(dir, 'agent-events.jsonl');
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('does nothing when the file is under the size limit', async () => {
		const content = 'line1\nline2\n';
		fs.writeFileSync(filePath, content);

		const trimmed = await trimLogFileIfOversized(filePath, 1024);

		expect(trimmed).toBe(false);
		expect(fs.readFileSync(filePath, 'utf8')).toBe(content);
	});

	it('trims an oversized file down to roughly the tail, aligned to a line boundary', async () => {
		const lines = Array.from({ length: 1000 }, (_, i) => `{"line":${i}}`);
		fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
		const originalSize = fs.statSync(filePath).size;
		const maxSizeBytes = Math.floor(originalSize / 10);

		const trimmed = await trimLogFileIfOversized(filePath, maxSizeBytes);

		expect(trimmed).toBe(true);
		const result = fs.readFileSync(filePath, 'utf8');
		expect(result.length).toBeLessThan(originalSize);
		expect(result.length).toBeLessThanOrEqual(maxSizeBytes + 1);
		// Every surviving line must be a complete, valid JSON line (no partial line at the start).
		const resultLines = result.split('\n').filter(Boolean);
		for (const line of resultLines) {
			expect(() => { JSON.parse(line); }).not.toThrow();
		}
		// Should contain the tail of the original file (last line preserved).
		expect(result).toContain('{"line":999}');
	});

	it('returns false when the file does not exist', async () => {
		const trimmed = await trimLogFileIfOversized(path.join(dir, 'missing.jsonl'), 100);
		expect(trimmed).toBe(false);
	});
});
