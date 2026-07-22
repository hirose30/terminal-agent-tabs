/**
 * Agent activity transition rules (issue #28).
 *
 * Pure logic, no Obsidian dependency, so the transition table stays
 * unit-testable in isolation.
 */

import type { AgentActivityState, NotificationType, SessionStatus } from './types';

/** Observed inputs that can move a session's agent activity. */
export type AgentActivityEvent =
	/** OSC title with a braille spinner prefix (turn in progress). */
	| 'osc-working'
	/** OSC title with a U+2733 prefix (agent is waiting). */
	| 'osc-idle'
	/** Notification hook: the agent is waiting for the user's answer. */
	| 'hook-blocked'
	/** Strict visible-screen rule: a hook-less CLI is waiting for an answer. */
	| 'screen-blocked'
	/** A previously detected hook-less CLI prompt left the active screen. */
	| 'screen-unblocked'
	/** Stop hook: task_complete (turn ended). */
	| 'hook-stop'
	/** The user typed into the terminal (any real PTY input). */
	| 'user-input';

/**
 * Compute the next activity state for an observed event.
 *
 * - 'osc-working' wins unconditionally: a running spinner is definitive
 *   evidence the user already answered, so it also clears 'blocked'.
 * - 'hook-stop' ends the turn: idle, clearing 'blocked' too.
 * - 'osc-idle' must NOT demote 'blocked': while a permission prompt is on
 *   screen the title carries the same U+2733 prefix as plain idle (measured
 *   in issue #28), and title re-emissions (e.g. summary updates) would
 *   otherwise flip a genuinely blocked session back to idle. Definitive
 *   hook/title/input events clear it immediately; hook-less screen detection
 *   clears it to unknown once the prompt is no longer rendered.
 * - 'user-input' only clears 'blocked': a keystroke while blocked means the
 *   user is answering the prompt (including Esc-cancel, which produces no
 *   Stop hook and no title change, so nothing else would clear the state).
 *   In any other state typing carries no signal and leaves it unchanged.
 */
export function nextAgentActivity(
	current: AgentActivityState,
	event: AgentActivityEvent
): AgentActivityState {
	switch (event) {
		case 'osc-working':
			return 'working';
		case 'hook-blocked':
		case 'screen-blocked':
			return 'blocked';
		case 'screen-unblocked':
			return current === 'blocked' ? 'unknown' : current;
		case 'hook-stop':
			return 'idle';
		case 'osc-idle':
			return current === 'blocked' ? 'blocked' : 'idle';
		case 'user-input':
			return current === 'blocked' ? 'idle' : current;
	}
}

/**
 * Whether a chunk of terminal input is a deliberate answer that should clear
 * 'blocked' (fire 'user-input'): it contains Enter (\r), or is exactly a
 * lone Esc (the cancel key).
 *
 * xterm's onData is NOT keystrokes-only. Claude Code enables focus
 * reporting, so merely focusing/blurring the tab emits \x1b[I / \x1b[O —
 * which used to clear the red dot just for looking at the tab. Any
 * \x1b-prefixed sequence longer than the lone Esc (CSI: focus events,
 * arrow keys, ...) is therefore ignored, and so are plain printable keys:
 * typing a shortcut to answer a prompt is confirmed by the turn restarting:
 * Claude emits a braille title and hook-less CLIs lose the matched prompt from
 * their rendered screen.
 */
export function isBlockedClearingInput(data: string): boolean {
	return data.includes('\r') || data === '\x1b';
}

/**
 * Count sessions whose agent is waiting on the user right now. Drives the
 * dock badge: "how many prompts are blocked on me" is actionable, unlike an
 * unread-notification total. Only running sessions count — exit paths reset
 * the activity, but stay defensive against stale snapshots.
 */
export function countBlockedSessions(
	sessions: Iterable<{ agentActivity: AgentActivityState; status: SessionStatus }>
): number {
	let count = 0;
	for (const session of sessions) {
		if (session.agentActivity === 'blocked' && session.status === 'running') {
			count += 1;
		}
	}
	return count;
}

/**
 * Map a PreToolUse hook (by tool_name) to an activity event, or null when
 * the tool must not move the state.
 *
 * AskUserQuestion renders its picker UI without firing any Notification hook
 * (no 'permission_prompt'), so its PreToolUse line is the only signal that
 * the agent is now waiting on the user. Every other tool (Bash, Edit, ...)
 * is just the agent working — no transition.
 *
 * Browsing the picker (arrow keys) does not clear 'blocked' — only a
 * submitted answer does (Enter / lone Esc via isBlockedClearingInput, or
 * the restarted turn's braille title).
 */
export function preToolUseActivityEvent(
	toolName: string | undefined
): AgentActivityEvent | null {
	return toolName === 'AskUserQuestion' ? 'hook-blocked' : null;
}

/**
 * Map a classified hook event (plus the raw notification_type from the hook
 * payload, when the relay recorded one) to an activity event, or null when
 * the hook must not move the state.
 *
 * Raw notification_type values observed in real Claude Code logs:
 * - 'permission_prompt': the agent is waiting for an approval -> blocked
 * - 'idle_prompt': fired after ~60s of inactivity; the agent is merely idle,
 *   so it must NOT enter blocked (the notification itself still shows)
 * - anything else ('push_notification', 'auth_success', ...): no transition
 * - absent (old relay lines without the field): conservatively blocked,
 *   preserving the pre-discrimination behavior
 */
export function hookActivityEvent(
	notificationType: NotificationType,
	rawNotificationType: string | undefined
): AgentActivityEvent | null {
	if (notificationType === 'task_complete') {
		return 'hook-stop';
	}
	if (notificationType === 'needs_input' || notificationType === 'action_needed') {
		if (rawNotificationType === undefined) return 'hook-blocked';
		return rawNotificationType === 'permission_prompt' ? 'hook-blocked' : null;
	}
	return null;
}
