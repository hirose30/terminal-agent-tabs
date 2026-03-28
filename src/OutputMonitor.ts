/**
 * Monitors terminal output to extract meaningful status information
 * and detect notification-worthy events (like permission prompts).
 *
 * Works by stripping ANSI escape sequences and tracking the last
 * non-empty line of output. Patterns are matched to detect when
 * the CLI is waiting for user input.
 */

export type OutputEvent =
	| { kind: 'action_needed'; message: string }
	| { kind: 'task_complete'; message: string }
	| { kind: 'status_update'; message: string };

export type OutputEventCallback = (sessionId: string, event: OutputEvent) => void;

/** Strip ANSI escape sequences from text. */
function stripAnsi(text: string): string {
	/* eslint-disable no-control-regex -- ANSI stripping requires control character literals (\x1b ESC, \x07 BEL, etc.) */
	return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
		.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')  // OSC sequences
		.replace(/\x1b[()][0-9A-Za-z]/g, '')                  // charset switches
		.replace(/\x1b[=>]/g, '')                              // keypad modes
		.replace(/\x1b\[[\?]?[0-9;]*[hlrs]/g, '')             // mode set/reset
		.replace(/[\x00-\x08\x0e-\x1f]/g, '');                // control characters (keep \t \n \r)
	/* eslint-enable no-control-regex */
}

/**
 * Patterns that indicate the CLI is waiting for user input.
 * Each pattern is tested against the last N lines of visible output.
 */
const ACTION_NEEDED_PATTERNS: RegExp[] = [
	// Claude Code permission prompts
	/needs? your permission/i,
	/allow\s+.*\?/i,
	/do you want to/i,
	/waiting for your input/i,
	/waiting for input/i,
	// Generic human-in-the-loop indicators
	/\[y\/n\]/i,
	/\(yes\/no\)/i,
	/press enter to continue/i,
	/approve|reject|deny/i,
];

const TASK_COMPLETE_PATTERNS: RegExp[] = [
	/task completed?/i,
	/all done/i,
	/session completed?/i,
];

export class OutputMonitor {
	private sessionBuffers: Map<string, {
		lastLine: string;
		lastLines: string[];
		lastEventTime: number;
		lastNotifiedPattern: string;
		idleTimer: ReturnType<typeof setTimeout> | null;
	}> = new Map();

	private listeners: Set<OutputEventCallback> = new Set();
	private maxLastLines = 5;
	private idleThresholdMs = 3000;

	onEvent(callback: OutputEventCallback): () => void {
		this.listeners.add(callback);
		return () => { this.listeners.delete(callback); };
	}

	/** Feed terminal output data for a session. */
	feed(sessionId: string, rawData: string): void {
		let buf = this.sessionBuffers.get(sessionId);
		if (!buf) {
			buf = {
				lastLine: '',
				lastLines: [],
				lastEventTime: Date.now(),
				lastNotifiedPattern: '',
				idleTimer: null,
			};
			this.sessionBuffers.set(sessionId, buf);
		}

		buf.lastEventTime = Date.now();

		// Strip ANSI and extract lines
		const clean = stripAnsi(rawData);
		const lines = clean.split(/\r?\n/)
			.map((l) => l.trim())
			.filter((l) => l.length > 0);

		if (lines.length === 0) return;

		// Update last lines buffer
		buf.lastLines.push(...lines);
		if (buf.lastLines.length > this.maxLastLines) {
			buf.lastLines = buf.lastLines.slice(-this.maxLastLines);
		}
		buf.lastLine = lines[lines.length - 1];

		// Reset idle timer - check patterns after output settles
		if (buf.idleTimer) clearTimeout(buf.idleTimer);
		buf.idleTimer = setTimeout(() => {
			this.checkPatterns(sessionId);
		}, this.idleThresholdMs);
	}

	/** Get the last meaningful output line for a session. */
	getLastLine(sessionId: string): string {
		return this.sessionBuffers.get(sessionId)?.lastLine || '';
	}

	/** Clean up when a session is destroyed. */
	removeSession(sessionId: string): void {
		const buf = this.sessionBuffers.get(sessionId);
		if (buf?.idleTimer) clearTimeout(buf.idleTimer);
		this.sessionBuffers.delete(sessionId);
	}

	private checkPatterns(sessionId: string): void {
		const buf = this.sessionBuffers.get(sessionId);
		if (!buf || buf.lastLines.length === 0) return;

		const recentText = buf.lastLines.join(' ');

		// Check action_needed patterns
		for (const pattern of ACTION_NEEDED_PATTERNS) {
			if (pattern.test(recentText)) {
				const patternKey = `action:${pattern.source}`;
				if (buf.lastNotifiedPattern !== patternKey) {
					buf.lastNotifiedPattern = patternKey;
					this.emit(sessionId, {
						kind: 'action_needed',
						message: buf.lastLine
					});
				}
				return;
			}
		}

		// Check task_complete patterns
		for (const pattern of TASK_COMPLETE_PATTERNS) {
			if (pattern.test(recentText)) {
				const patternKey = `complete:${pattern.source}`;
				if (buf.lastNotifiedPattern !== patternKey) {
					buf.lastNotifiedPattern = patternKey;
					this.emit(sessionId, {
						kind: 'task_complete',
						message: buf.lastLine
					});
				}
				return;
			}
		}

		// If none matched, clear the last pattern so future matches can fire
		buf.lastNotifiedPattern = '';
	}

	private emit(sessionId: string, event: OutputEvent): void {
		for (const cb of this.listeners) {
			try { cb(sessionId, event); } catch { /* ignore */ }
		}
	}

	destroy(): void {
		for (const buf of this.sessionBuffers.values()) {
			if (buf.idleTimer) clearTimeout(buf.idleTimer);
		}
		this.sessionBuffers.clear();
		this.listeners.clear();
	}
}
