/**
 * Agent activity transition rules (issue #28).
 *
 * Pure logic, no Obsidian dependency, so the transition table stays
 * unit-testable in isolation.
 */

import type { AgentActivityState } from './types';

/** Observed inputs that can move a session's agent activity. */
export type AgentActivityEvent =
	/** OSC title with a braille spinner prefix (turn in progress). */
	| 'osc-working'
	/** OSC title with a U+2733 prefix (agent is waiting). */
	| 'osc-idle'
	/** Notification hook: needs_input / action_needed. */
	| 'hook-blocked'
	/** Stop hook: task_complete (turn ended). */
	| 'hook-stop';

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
 *   'osc-working' and 'hook-stop' can clear 'blocked'.
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
	}
}
