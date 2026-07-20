import { describe, it, expect } from 'vitest';
import { nextAgentActivity, hookActivityEvent, preToolUseActivityEvent } from '../AgentActivity';
import type { AgentActivityState } from '../types';

describe('nextAgentActivity', () => {
	const ALL_STATES: AgentActivityState[] = ['working', 'blocked', 'idle', 'unknown'];

	describe('blocked is sticky against osc-idle', () => {
		it('stays blocked when a U+2733 title arrives while blocked', () => {
			// The permission prompt keeps the same U+2733 title as plain idle;
			// a title re-emission must not demote a blocked session.
			expect(nextAgentActivity('blocked', 'osc-idle')).toBe('blocked');
		});

		it('flips to working when a braille title arrives while blocked', () => {
			// A running spinner proves the user answered the prompt.
			expect(nextAgentActivity('blocked', 'osc-working')).toBe('working');
		});

		it('flips to idle on hook-stop while blocked', () => {
			expect(nextAgentActivity('blocked', 'hook-stop')).toBe('idle');
		});
	});

	describe('osc-working wins from any state', () => {
		for (const from of ALL_STATES) {
			it(`${from} -> working`, () => {
				expect(nextAgentActivity(from, 'osc-working')).toBe('working');
			});
		}
	});

	describe('hook-blocked wins from any state', () => {
		for (const from of ALL_STATES) {
			it(`${from} -> blocked`, () => {
				expect(nextAgentActivity(from, 'hook-blocked')).toBe('blocked');
			});
		}
	});

	describe('hook-stop always ends the turn', () => {
		for (const from of ALL_STATES) {
			it(`${from} -> idle`, () => {
				expect(nextAgentActivity(from, 'hook-stop')).toBe('idle');
			});
		}
	});

	describe('user-input only clears blocked', () => {
		it('blocked -> idle (e.g. Esc-cancel with no Stop hook, no title change)', () => {
			expect(nextAgentActivity('blocked', 'user-input')).toBe('idle');
		});

		it('working stays working', () => {
			expect(nextAgentActivity('working', 'user-input')).toBe('working');
		});

		it('idle stays idle', () => {
			expect(nextAgentActivity('idle', 'user-input')).toBe('idle');
		});

		it('unknown stays unknown', () => {
			expect(nextAgentActivity('unknown', 'user-input')).toBe('unknown');
		});
	});

	describe('osc-idle from non-blocked states', () => {
		it('unknown -> idle', () => {
			expect(nextAgentActivity('unknown', 'osc-idle')).toBe('idle');
		});

		it('idle -> idle', () => {
			expect(nextAgentActivity('idle', 'osc-idle')).toBe('idle');
		});

		it('working -> idle (turn finished)', () => {
			expect(nextAgentActivity('working', 'osc-idle')).toBe('idle');
		});
	});
});

describe('hookActivityEvent', () => {
	it('maps task_complete to hook-stop regardless of raw type', () => {
		expect(hookActivityEvent('task_complete', undefined)).toBe('hook-stop');
		expect(hookActivityEvent('task_complete', 'anything')).toBe('hook-stop');
	});

	it('maps permission_prompt notifications to hook-blocked', () => {
		expect(hookActivityEvent('needs_input', 'permission_prompt')).toBe('hook-blocked');
		expect(hookActivityEvent('action_needed', 'permission_prompt')).toBe('hook-blocked');
	});

	it('does not move the state for idle_prompt (60s inactivity is not blocked)', () => {
		expect(hookActivityEvent('needs_input', 'idle_prompt')).toBeNull();
	});

	it('does not move the state for other raw types', () => {
		expect(hookActivityEvent('needs_input', 'push_notification')).toBeNull();
		expect(hookActivityEvent('needs_input', 'auth_success')).toBeNull();
		expect(hookActivityEvent('needs_input', 'elicitation_complete')).toBeNull();
	});

	it('falls back to hook-blocked when the raw type is absent (old relay lines)', () => {
		expect(hookActivityEvent('needs_input', undefined)).toBe('hook-blocked');
		expect(hookActivityEvent('action_needed', undefined)).toBe('hook-blocked');
	});

	it('never moves the state for agent_event', () => {
		expect(hookActivityEvent('agent_event', undefined)).toBeNull();
		expect(hookActivityEvent('agent_event', 'permission_prompt')).toBeNull();
	});
});

describe('preToolUseActivityEvent', () => {
	it('maps AskUserQuestion to hook-blocked (picker fires no Notification hook)', () => {
		expect(preToolUseActivityEvent('AskUserQuestion')).toBe('hook-blocked');
	});

	it('does not move the state for other tools', () => {
		expect(preToolUseActivityEvent('Bash')).toBeNull();
		expect(preToolUseActivityEvent('Edit')).toBeNull();
	});

	it('does not move the state when tool_name is absent', () => {
		expect(preToolUseActivityEvent(undefined)).toBeNull();
	});
});
