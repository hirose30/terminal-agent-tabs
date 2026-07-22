/**
 * Monitors terminal output to extract meaningful status information
 * and detect notification-worthy events (like permission prompts).
 *
 * Legacy rules inspect stripped recent output. CLI-specific rules inspect the
 * rendered xterm screen after output settles, so full-screen TUI redraws do
 * not leave stale prompt text behind.
 */

export type OutputEvent =
	| { kind: 'action_needed'; message: string; agentActivity?: 'blocked' }
	| { kind: 'activity_update'; agentActivity: 'unblocked' }
	| { kind: 'task_complete'; message: string }
	| { kind: 'status_update'; message: string };

export type OutputEventCallback = (sessionId: string, event: OutputEvent) => void;

/** CLI-specific visible-screen rules. Unknown CLIs keep the legacy text checks only. */
export type OutputDetectionProfile = 'codex' | 'generic';

export interface OutputFeedContext {
	profile: OutputDetectionProfile;
	/** Read the current active xterm screen after output has settled. */
	getVisibleText?: () => string;
}

/** Strip ANSI escape sequences from text. */
function stripAnsi(text: string): string {
	/* eslint-disable no-control-regex -- ANSI stripping requires control character literals (\x1b ESC, \x07 BEL, etc.) */
	return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
		.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')  // OSC sequences
		.replace(/\x1b[()][0-9A-Za-z]/g, '')                  // charset switches
		.replace(/\x1b[=>]/g, '')                              // keypad modes
		.replace(/\x1b\[[?]?[0-9;]*[hlrs]/g, '')              // mode set/reset
		.replace(/[\x00-\x08\x0e-\x1f]/g, '');                // control characters (keep \t \n \r)
	/* eslint-enable no-control-regex -- end of ANSI stripping block */
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

interface DetectionInput {
	/** Rendered active screen, falling back to recent output in unit/headless use. */
	lines: string[];
	flatText: string;
	recentLines: string[];
	recentText: string;
}

interface DetectionRule {
	id: string;
	priority: number;
	profiles?: OutputDetectionProfile[];
	/** A skip rule suppresses lower-priority, broad legacy matches. */
	skip?: boolean;
	matches: (input: DetectionInput) => boolean;
	event?: (input: DetectionInput) => OutputEvent;
}

const CODEX_APPROVAL_TITLES: RegExp[] = [
	/Would you like to run the following command\?/i,
	/Would you like to make the following edits\?/i,
	/Would you like to grant these permissions\?/i,
	/Do you want to approve network access to ".+?"\?/i,
	/needs your approval\./i,
];

function findLine(input: DetectionInput, patterns: RegExp[]): string | undefined {
	return input.lines.find((line) => patterns.some((pattern) => pattern.test(line.trim())));
}

function hasLine(input: DetectionInput, pattern: RegExp): boolean {
	return input.lines.some((line) => pattern.test(line));
}

function findText(input: DetectionInput, patterns: RegExp[]): string | undefined {
	for (const pattern of patterns) {
		const match = input.flatText.match(pattern);
		if (match) return match[0];
	}
	return undefined;
}

function hasText(input: DetectionInput, pattern: RegExp): boolean {
	return pattern.test(input.flatText);
}

/**
 * Codex 0.145.0 approval/question layouts, verified against the upstream TUI
 * snapshots. Each rule requires the title/section marker AND the exact footer
 * (plus a selected option for approval modals), so transcript prose containing
 * a word such as "approve" cannot turn a tab red.
 */
const DETECTION_RULES: DetectionRule[] = [
	{
		id: 'codex-approval',
		priority: 1200,
		profiles: ['codex'],
		matches: (input) =>
			findText(input, CODEX_APPROVAL_TITLES) !== undefined
			&& hasLine(input, /^\s*[›>]\s*\d+\.\s+\S/)
			&& hasText(input, /\bPress enter to confirm or esc to cancel\b/i),
		event: (input) => ({
			kind: 'action_needed',
			message: findText(input, CODEX_APPROVAL_TITLES) ?? 'Codex is waiting for approval.',
			agentActivity: 'blocked',
		}),
	},
	{
		id: 'codex-request-user-input',
		priority: 1190,
		profiles: ['codex'],
		matches: (input) =>
			hasLine(input, /^\s*Question \d+\/\d+(?: \(\d+ unanswered\))?\s*$/i)
			&& hasText(input, /\benter to submit answer\b/i)
			&& hasText(input, /\besc to interrupt\b/i),
		event: (input) => ({
			kind: 'action_needed',
			message: findLine(input, [/^Question \d+\/\d+/i]) ?? 'Codex is waiting for input.',
			agentActivity: 'blocked',
		}),
	},
	{
		id: 'codex-mcp-elicitation',
		priority: 1180,
		profiles: ['codex'],
		matches: (input) =>
			hasLine(input, /^\s*Field \d+\/\d+\s*$/i)
			&& hasText(input, /\benter to submit\b/i)
			&& hasText(input, /\besc to cancel\b/i),
		event: (input) => ({
			kind: 'action_needed',
			message: findLine(input, [/^Field \d+\/\d+/i]) ?? 'Codex is waiting for input.',
			agentActivity: 'blocked',
		}),
	},
	{
		id: 'codex-plan-implementation',
		priority: 1170,
		profiles: ['codex'],
		matches: (input) =>
			hasLine(input, /^\s*Implement this plan\?\s*$/i)
			&& hasLine(input, /^\s*[›>]\s*\d+\.\s+\S/)
			&& hasText(input, /\bPress enter to confirm or esc to go back\b/i),
		event: () => ({
			kind: 'action_needed',
			message: 'Implement this plan?',
			agentActivity: 'blocked',
		}),
	},
	{
		// Menus opened by the user can contain words such as "approval". Their
		// selection footer is not evidence that an agent turn needs attention.
		id: 'codex-user-menu',
		priority: 1000,
		profiles: ['codex'],
		skip: true,
		matches: (input) =>
			hasText(input, /\benter to select\b/i)
			|| hasText(input, /\besc to close\b/i),
	},
	...ACTION_NEEDED_PATTERNS.map((pattern, index): DetectionRule => ({
		id: `legacy-action-${index}`,
		priority: 500 - index,
		profiles: ['generic'],
		matches: (input) => pattern.test(input.recentText),
		event: (input) => ({
			kind: 'action_needed',
			message: input.recentLines[input.recentLines.length - 1] ?? '',
		}),
	})),
	...TASK_COMPLETE_PATTERNS.map((pattern, index): DetectionRule => ({
		id: `legacy-complete-${index}`,
		priority: 300 - index,
		matches: (input) => pattern.test(input.recentText),
		event: (input) => ({
			kind: 'task_complete',
			message: input.recentLines[input.recentLines.length - 1] ?? '',
		}),
	})),
];
DETECTION_RULES.sort((a, b) => b.priority - a.priority);

const CODEX_BLOCKED_RULE_IDS = new Set([
	'codex-approval',
	'codex-request-user-input',
	'codex-mcp-elicitation',
	'codex-plan-implementation',
]);

export class OutputMonitor {
	private sessionBuffers: Map<string, {
		lastLine: string;
		lastLines: string[];
		lastEventTime: number;
		lastNotifiedPattern: string;
		idleTimer: ReturnType<typeof setTimeout> | null;
		profile: OutputDetectionProfile;
		getVisibleText?: () => string;
	}> = new Map();

	private listeners: Set<OutputEventCallback> = new Set();
	private maxLastLines = 5;
	private idleThresholdMs = 3000;

	onEvent(callback: OutputEventCallback): () => void {
		this.listeners.add(callback);
		return () => { this.listeners.delete(callback); };
	}

	/** Feed terminal output data for a session. */
	feed(sessionId: string, rawData: string, context?: OutputFeedContext): void {
		let buf = this.sessionBuffers.get(sessionId);
		if (!buf) {
			buf = {
				lastLine: '',
				lastLines: [],
				lastEventTime: Date.now(),
				lastNotifiedPattern: '',
				idleTimer: null,
				profile: context?.profile ?? 'generic',
				getVisibleText: context?.getVisibleText,
			};
			this.sessionBuffers.set(sessionId, buf);
		}
		if (context) {
			buf.profile = context.profile;
			buf.getVisibleText = context.getVisibleText;
		}

		buf.lastEventTime = Date.now();

		// Strip ANSI and extract lines
		const clean = stripAnsi(rawData);
		const lines = clean.split(/\r?\n/)
			.map((l) => l.trim())
			.filter((l) => l.length > 0);

		if (lines.length > 0) {
			// Update last lines buffer
			buf.lastLines.push(...lines);
			if (buf.lastLines.length > this.maxLastLines) {
				buf.lastLines = buf.lastLines.slice(-this.maxLastLines);
			}
			buf.lastLine = lines[lines.length - 1];
		} else if (!buf.getVisibleText) {
			return;
		}

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
		if (!buf) return;

		let visibleText = '';
		try {
			visibleText = buf.getVisibleText?.() ?? '';
		} catch {
			// A view can disappear between scheduling and the settled-output check.
		}
		const visibleLines = visibleText.split(/\r?\n/)
			.filter((line) => line.trim().length > 0);
		const lines = visibleLines.length > 0 ? visibleLines : buf.lastLines;
		if (lines.length === 0) return;
		const input: DetectionInput = {
			lines,
			flatText: lines.map((line) => line.trim()).join(' '),
			recentLines: buf.lastLines,
			recentText: buf.lastLines.join('\n'),
		};
		const matchedRule = DETECTION_RULES.find((rule) =>
			(!rule.profiles || rule.profiles.includes(buf.profile)) && rule.matches(input)
		);

		if (matchedRule?.skip) {
			if (CODEX_BLOCKED_RULE_IDS.has(buf.lastNotifiedPattern)) {
				this.emit(sessionId, { kind: 'activity_update', agentActivity: 'unblocked' });
			}
			buf.lastNotifiedPattern = '';
			return;
		}
		if (matchedRule?.event) {
			const patternKey = matchedRule.id;
			if (
				CODEX_BLOCKED_RULE_IDS.has(buf.lastNotifiedPattern)
				&& !CODEX_BLOCKED_RULE_IDS.has(patternKey)
			) {
				this.emit(sessionId, { kind: 'activity_update', agentActivity: 'unblocked' });
			}
			if (buf.lastNotifiedPattern !== patternKey) {
				buf.lastNotifiedPattern = patternKey;
				this.emit(sessionId, matchedRule.event(input));
			}
			return;
		}

		// If none matched, clear the last pattern so future matches can fire
		if (CODEX_BLOCKED_RULE_IDS.has(buf.lastNotifiedPattern)) {
			this.emit(sessionId, { kind: 'activity_update', agentActivity: 'unblocked' });
		}
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
