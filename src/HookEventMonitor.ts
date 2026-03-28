/**
 * Monitors a JSONL file for hook events emitted by CLI hooks (e.g. Claude Code).
 * Polls the file at a configurable interval, parses new lines, and classifies
 * events using cmux-style substring matching.
 */

import * as fs from 'fs';
import type { NotificationType } from './types';

export interface HookEvent {
	notificationType: NotificationType;
	notificationTitle: string;
	soundKind: 'action' | 'complete' | 'event';
	message: string;
	source: string;
}

export type HookEventCallback = (event: HookEvent) => void;

export class HookEventMonitor {
	private timer: number | null = null;
	private readOffset: number = 0;
	private pollInFlight: boolean = false;
	private partialLine: string = '';
	private filePath: string | null = null;
	private pollIntervalMs: number;
	private debugLogging: boolean;
	private callback: HookEventCallback;

	constructor(options: {
		pollIntervalMs: number;
		debugLogging: boolean;
		callback: HookEventCallback;
	}) {
		this.pollIntervalMs = options.pollIntervalMs;
		this.debugLogging = options.debugLogging;
		this.callback = options.callback;
	}

	start(filePath: string): void {
		this.stop();

		this.filePath = filePath;
		this.readOffset = 0;
		this.partialLine = '';

		try {
			const stats = fs.statSync(this.filePath);
			this.readOffset = Math.max(0, stats.size);
		} catch (error: unknown) {
			if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT' && this.debugLogging) {
				console.debug('[TerminalAgentTabs] hook monitor init failed:', error);
			}
		}

		this.timer = window.setInterval(() => {
			void this.poll();
		}, this.pollIntervalMs);
	}

	stop(): void {
		if (this.timer !== null) {
			window.clearInterval(this.timer);
			this.timer = null;
		}
		this.pollInFlight = false;
		this.partialLine = '';
	}

	updateConfig(options: { pollIntervalMs?: number; debugLogging?: boolean }): void {
		if (options.pollIntervalMs !== undefined) this.pollIntervalMs = options.pollIntervalMs;
		if (options.debugLogging !== undefined) this.debugLogging = options.debugLogging;
	}

	private async poll(): Promise<void> {
		if (this.pollInFlight || !this.filePath) return;
		this.pollInFlight = true;
		try {
			const stats = await fs.promises.stat(this.filePath).catch((error: unknown) => {
				if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
				throw error;
			});
			if (!stats) {
				this.readOffset = 0;
				this.partialLine = '';
				return;
			}

			if (stats.size < this.readOffset) {
				this.readOffset = 0;
				this.partialLine = '';
			}
			const pendingBytes = stats.size - this.readOffset;
			if (pendingBytes <= 0) return;

			const maxReadBytes = 512 * 1024;
			const readBytes = Math.min(maxReadBytes, pendingBytes);
			const buffer = Buffer.alloc(readBytes);
			const file = await fs.promises.open(this.filePath, 'r');
			try {
				const { bytesRead } = await file.read(
					buffer,
					0,
					readBytes,
					this.readOffset
				);
				if (bytesRead > 0) {
					this.readOffset += bytesRead;
					this.consumeChunk(buffer.toString('utf8', 0, bytesRead));
				}
			} finally {
				await file.close();
			}
		} catch (error) {
			if (this.debugLogging) {
				console.debug('[TerminalAgentTabs] hook event polling failed:', error);
			}
		} finally {
			this.pollInFlight = false;
		}
	}

	private consumeChunk(chunk: string): void {
		const merged = `${this.partialLine}${chunk}`;
		const lines = merged.split(/\r?\n/);
		this.partialLine = lines.pop() ?? '';
		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (!line) continue;
			this.handleLine(line);
		}
	}

	private handleLine(line: string): void {
		let payload: Record<string, unknown>;
		try {
			const parsed = JSON.parse(line);
			if (!parsed || typeof parsed !== 'object') return;
			payload = parsed as Record<string, unknown>;
		} catch {
			if (this.debugLogging) {
				console.debug('[TerminalAgentTabs] invalid hook event json:', line);
			}
			return;
		}

		const rawEventType =
			(typeof payload.hook === 'string' && payload.hook) ||
			(typeof payload.event === 'string' && payload.event) ||
			(typeof payload.event_name === 'string' && payload.event_name) ||
			(typeof payload.type === 'string' && payload.type) ||
			'event';
		const message =
			(typeof payload.message === 'string' && payload.message.trim()) ||
			(typeof payload.msg === 'string' && payload.msg.trim()) ||
			(typeof payload.text === 'string' && payload.text.trim()) ||
			(typeof payload.body === 'string' && payload.body.trim()) ||
			(typeof payload.description === 'string' && payload.description.trim()) ||
			rawEventType;
		const source =
			(typeof payload.source === 'string' && payload.source.trim()) ||
			(typeof payload.cli === 'string' && payload.cli.trim()) ||
			'agent';

		const { notificationType, notificationTitle, soundKind } =
			classifyHookEvent(rawEventType, message);

		this.callback({
			notificationType,
			notificationTitle,
			soundKind,
			message,
			source
		});
	}
}

/**
 * Classify a hook event using substring matching (cmux-style).
 */
export function classifyHookEvent(eventType: string, message: string): {
	notificationType: NotificationType;
	notificationTitle: string;
	soundKind: 'action' | 'complete' | 'event';
} {
	const lower = `${eventType} ${message}`.toLowerCase();

	if (eventType.toLowerCase() === 'notification') {
		return { notificationType: 'needs_input', notificationTitle: 'Needs Input', soundKind: 'action' };
	}

	if (eventType.toLowerCase() === 'stop') {
		return { notificationType: 'task_complete', notificationTitle: 'Turn Complete', soundKind: 'complete' };
	}

	if (lower.includes('permission') || lower.includes('approve') || lower.includes('approval')) {
		return { notificationType: 'action_needed', notificationTitle: 'Permission', soundKind: 'action' };
	}

	if (lower.includes('error') || lower.includes('failed') || lower.includes('exception')) {
		return { notificationType: 'action_needed', notificationTitle: 'Error', soundKind: 'action' };
	}

	if (lower.includes('complet') || lower.includes('finish') || lower.includes('done') || lower.includes('success')) {
		return { notificationType: 'task_complete', notificationTitle: 'Complete', soundKind: 'complete' };
	}

	if (lower.includes('idle') || lower.includes('wait') || lower.includes('input') || lower.includes('hitl') || lower.includes('humanloop')) {
		return { notificationType: 'action_needed', notificationTitle: 'Waiting', soundKind: 'action' };
	}

	return { notificationType: 'agent_event', notificationTitle: 'Agent Event', soundKind: 'event' };
}
