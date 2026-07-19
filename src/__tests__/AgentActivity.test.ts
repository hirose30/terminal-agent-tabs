import { describe, it, expect } from 'vitest';
import { nextAgentActivity } from '../AgentActivity';
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
