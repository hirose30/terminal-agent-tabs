/**
 * Monitors a JSONL file for hook events emitted by CLI hooks (e.g. Claude Code).
 * Polls the file at a configurable interval, parses new lines, and classifies
 * events using cmux-style substring matching.
 */

import * as fs from 'fs';
import type { NotificationType } from './types';
import { isOverSizeLimit, planRotation, applyRotationPlan } from './HookLogMaintenance';

export interface HookEvent {
	notificationType: NotificationType;
	notificationTitle: string;
	soundKind: 'action' | 'complete' | 'event';
	message: string;
	source: string;
	/** Plugin-side session id embedded by the relay's --tat-session flag, if present. */
	tatSessionId?: string;
	/** Agent-side session id from the hook payload (Claude Code's session_id), if present. */
	agentSessionId?: string;
	/** Raw notification_type from the hook payload (e.g. 'permission_prompt'), if present. */
	rawNotificationType?: string;
	/** tool_name from a PreToolUse payload (e.g. 'AskUserQuestion'), if present. */
	toolName?: string;
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
	private maxSizeBytes: number;
	private maxGenerations: number;

	constructor(options: {
		pollIntervalMs: number;
		debugLogging: boolean;
		callback: HookEventCallback;
		maxSizeBytes?: number;
		maxGenerations?: number;
	}) {
		this.pollIntervalMs = options.pollIntervalMs;
		this.debugLogging = options.debugLogging;
		this.callback = options.callback;
		this.maxSizeBytes = options.maxSizeBytes ?? 0;
		this.maxGenerations = options.maxGenerations ?? 2;
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

	updateConfig(options: {
		pollIntervalMs?: number;
		debugLogging?: boolean;
		maxSizeBytes?: number;
		maxGenerations?: number;
	}): void {
		if (options.pollIntervalMs !== undefined) this.pollIntervalMs = options.pollIntervalMs;
		if (options.debugLogging !== undefined) this.debugLogging = options.debugLogging;
		if (options.maxSizeBytes !== undefined) this.maxSizeBytes = options.maxSizeBytes;
		if (options.maxGenerations !== undefined) this.maxGenerations = options.maxGenerations;
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

			if (isOverSizeLimit(stats.size, this.maxSizeBytes)) {
				this.rotate();
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

	/** Rotate the active log into generation 1 (shifting older generations up) and reset read state. */
	private rotate(): void {
		if (!this.filePath) return;
		try {
			applyRotationPlan(this.filePath, planRotation(this.maxGenerations));
		} catch (error) {
			if (this.debugLogging) {
				console.debug('[TerminalAgentTabs] hook log rotation failed:', error);
			}
		}
		this.readOffset = 0;
		this.partialLine = '';
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
		const event = parseHookLine(line);
		if (!event) {
			if (this.debugLogging) {
				console.debug('[TerminalAgentTabs] invalid hook event json:', line);
			}
			return;
		}
		this.callback(event);
	}
}

/**
 * Parse one JSONL hook log line into a HookEvent. Returns null when the line
 * is not a JSON object. Exported for unit tests.
 */
export function parseHookLine(line: string): HookEvent | null {
	let payload: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(line);
		if (!parsed || typeof parsed !== 'object') return null;
		payload = parsed as Record<string, unknown>;
	} catch {
		return null;
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
	// The relay writes the Claude Code hook payload verbatim, so session_id
	// and notification_type ride along when the CLI provides them.
	// tat_session_id is the relay's own addition (--tat-session flag).
	const tatSessionId =
		(typeof payload.tat_session_id === 'string' && payload.tat_session_id.trim()) || undefined;
	const agentSessionId =
		(typeof payload.session_id === 'string' && payload.session_id.trim()) || undefined;
	const rawNotificationType =
		(typeof payload.notification_type === 'string' && payload.notification_type.trim()) || undefined;
	const toolName =
		(typeof payload.tool_name === 'string' && payload.tool_name.trim()) || undefined;

	const { notificationType, notificationTitle, soundKind } =
		classifyHookEvent(rawEventType, message);

	return {
		notificationType,
		notificationTitle,
		soundKind,
		message,
		source,
		tatSessionId,
		agentSessionId,
		rawNotificationType,
		toolName
	};
}

/**
 * Resolve the plugin-side session a hook event belongs to, most reliable
 * signal first:
 * 1. tatSessionId — the relay embeds our own session id, exact and immune
 *    to Claude-side id changes; used only if that session is still live.
 * 2. agentSessionId — Claude's session_id matched against assign-id
 *    resumeKeys; misses for resumed sessions, which fork to a fresh id.
 * 3. The caller's heuristic fallback (single running / last active).
 */
export function resolveHookSessionId(
	event: Pick<HookEvent, 'tatSessionId' | 'agentSessionId'>,
	resolver: {
		hasSession: (sessionId: string) => boolean;
		findByAgentSessionId: (agentSessionId: string) => string | null;
		fallback: () => string;
	}
): string {
	if (event.tatSessionId && resolver.hasSession(event.tatSessionId)) {
		return event.tatSessionId;
	}
	if (event.agentSessionId) {
		const matched = resolver.findByAgentSessionId(event.agentSessionId);
		if (matched) return matched;
	}
	return resolver.fallback();
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
