/**
 * Agent activity transition rules (issue #28).
 *
 * Pure logic, no Obsidian dependency, so the transition table stays
 * unit-testable in isolation.
 */

import type { AgentActivityState, NotificationType } from './types';

/** Observed inputs that can move a session's agent activity. */
export type AgentActivityEvent =
	/** OSC title with a braille spinner prefix (turn in progress). */
	| 'osc-working'
	/** OSC title with a U+2733 prefix (agent is waiting). */
	| 'osc-idle'
	/** Notification hook: the agent is waiting for the user's answer. */
	| 'hook-blocked'
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
 *   otherwise flip a genuinely blocked session back to idle. Only
 *   'osc-working', 'hook-stop' and 'user-input' can clear 'blocked'.
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
			return 'blocked';
		case 'hook-stop':
			return 'idle';
		case 'osc-idle':
			return current === 'blocked' ? 'blocked' : 'idle';
		case 'user-input':
			return current === 'blocked' ? 'idle' : current;
	}
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
