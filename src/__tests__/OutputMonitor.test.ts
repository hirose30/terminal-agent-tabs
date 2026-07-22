import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OutputMonitor } from '../OutputMonitor';
import type { OutputEvent } from '../OutputMonitor';

describe('OutputMonitor', () => {
	let monitor: OutputMonitor;

	beforeEach(() => {
		vi.useFakeTimers();
		monitor = new OutputMonitor();
	});

	afterEach(() => {
		monitor.destroy();
		vi.useRealTimers();
	});

	describe('getLastLine()', () => {
		it('returns empty string for unknown session', () => {
			expect(monitor.getLastLine('unknown')).toBe('');
		});

		it('returns last non-empty line after feed', () => {
			monitor.feed('s1', 'Hello\nWorld\n');
			expect(monitor.getLastLine('s1')).toBe('World');
		});

		it('strips ANSI escape sequences', () => {
			monitor.feed('s1', '\x1b[32mGreen text\x1b[0m');
			expect(monitor.getLastLine('s1')).toBe('Green text');
		});

		it('ignores empty lines', () => {
			monitor.feed('s1', 'First\n\n\n');
			expect(monitor.getLastLine('s1')).toBe('First');
		});

		it('updates on subsequent feed calls', () => {
			monitor.feed('s1', 'First line\n');
			monitor.feed('s1', 'Second line\n');
			expect(monitor.getLastLine('s1')).toBe('Second line');
		});
	});

	describe('pattern detection', () => {
		it('fires action_needed for permission prompt after idle', () => {
			const cb = vi.fn();
			monitor.onEvent(cb);

			monitor.feed('s1', 'Tool needs your permission to run\n');
			vi.advanceTimersByTime(3000);

			expect(cb).toHaveBeenCalledOnce();
			expect(cb).toHaveBeenCalledWith('s1', expect.objectContaining<OutputEvent>({
				kind: 'action_needed',
				message: expect.any(String),
			}));
		});

		it('fires task_complete for completion message after idle', () => {
			const cb = vi.fn();
			monitor.onEvent(cb);

			monitor.feed('s1', 'Task completed successfully\n');
			vi.advanceTimersByTime(3000);

			expect(cb).toHaveBeenCalledOnce();
			expect(cb).toHaveBeenCalledWith('s1', expect.objectContaining<OutputEvent>({
				kind: 'task_complete',
				message: expect.any(String),
			}));
		});

		it('does not fire before idle threshold', () => {
			const cb = vi.fn();
			monitor.onEvent(cb);

			monitor.feed('s1', 'Task completed\n');
			vi.advanceTimersByTime(1000);

			expect(cb).not.toHaveBeenCalled();
		});

		it('does not fire the same pattern twice in a row', () => {
			const cb = vi.fn();
			monitor.onEvent(cb);

			monitor.feed('s1', 'needs your permission\n');
			vi.advanceTimersByTime(3000);
			monitor.feed('s1', 'needs your permission\n');
			vi.advanceTimersByTime(3000);

			expect(cb).toHaveBeenCalledOnce();
		});

		it('resets dedup once the matching line scrolls out of the 5-line buffer', () => {
			const cb = vi.fn();
			monitor.onEvent(cb);

			monitor.feed('s1', 'needs your permission\n');
			vi.advanceTimersByTime(3000);

			// Push the matching line out of the 5-line rolling buffer
			for (let i = 0; i < 5; i++) {
				monitor.feed('s1', `unrelated line ${i}\n`);
			}
			vi.advanceTimersByTime(3000);

			monitor.feed('s1', 'needs your permission\n');
			vi.advanceTimersByTime(3000);

			expect(cb).toHaveBeenCalledTimes(2);
		});
	});

	describe('Codex visible-screen blocked detection', () => {
		const approvalScreen = (title: string) => [
			`  ${title}`,
			'',
			'› 1. Yes, proceed (y)',
			'  2. No, and tell Codex what to do differently (esc)',
			'',
			'  Press enter to confirm or esc to cancel',
		].join('\n');

		it.each([
			'Would you like to run the following command?',
			'Would you like to make the following edits?',
			'Would you like to grant these permissions?',
			'Do you want to approve network access to "api.github.com"?',
			'github needs your approval.',
		])('marks the Codex approval screen blocked: %s', (title) => {
			const cb = vi.fn();
			monitor.onEvent(cb);
			monitor.feed(title, 'TUI redraw', {
				profile: 'codex',
				getVisibleText: () => approvalScreen(title),
			});

			vi.advanceTimersByTime(3000);

			expect(cb).toHaveBeenCalledWith(title, expect.objectContaining<OutputEvent>({
				kind: 'action_needed',
				agentActivity: 'blocked',
			}));
		});

		it('marks request_user_input blocked', () => {
			const cb = vi.fn();
			monitor.onEvent(cb);
			monitor.feed('s1', 'TUI redraw', {
				profile: 'codex',
				getVisibleText: () => [
					'  Question 1/1 (1 unanswered)',
					'  Choose an option.',
					'  › 1. Option 1  First choice.',
					'  tab to add notes | enter to submit answer | esc to interrupt',
				].join('\n'),
			});

			vi.advanceTimersByTime(3000);

			expect(cb).toHaveBeenCalledWith('s1', expect.objectContaining<OutputEvent>({
				kind: 'action_needed',
				agentActivity: 'blocked',
			}));
		});

		it('recognizes an approval title and footer wrapped by a narrow terminal', () => {
			const cb = vi.fn();
			monitor.onEvent(cb);
			monitor.feed('s1', 'TUI redraw', {
				profile: 'codex',
				getVisibleText: () => [
					'  Would you like to grant these',
					'  permissions?',
					'› 1. Yes, grant these permissions',
					'  Press enter to confirm or esc to',
					'  cancel',
				].join('\n'),
			});

			vi.advanceTimersByTime(3000);

			expect(cb).toHaveBeenCalledWith('s1', expect.objectContaining<OutputEvent>({
				kind: 'action_needed',
				agentActivity: 'blocked',
			}));
		});

		it('marks MCP elicitation blocked', () => {
			const cb = vi.fn();
			monitor.onEvent(cb);
			monitor.feed('s1', 'TUI redraw', {
				profile: 'codex',
				getVisibleText: () => [
					'  Field 1/1',
					'  Allow this request?',
					'  › 1. Allow   Run the tool and continue.',
					'  enter to submit | esc to cancel',
				].join('\n'),
			});

			vi.advanceTimersByTime(3000);

			expect(cb).toHaveBeenCalledWith('s1', expect.objectContaining<OutputEvent>({
				kind: 'action_needed',
				agentActivity: 'blocked',
			}));
		});

		it('marks the plan implementation decision blocked', () => {
			const cb = vi.fn();
			monitor.onEvent(cb);
			monitor.feed('s1', 'TUI redraw', {
				profile: 'codex',
				getVisibleText: () => [
					'  Implement this plan?',
					'› 1. Yes, implement this plan',
					'  2. No, stay in Plan mode',
					'  Press enter to confirm or esc to go back',
				].join('\n'),
			});

			vi.advanceTimersByTime(3000);

			expect(cb).toHaveBeenCalledWith('s1', expect.objectContaining<OutputEvent>({
				kind: 'action_needed',
				agentActivity: 'blocked',
			}));
		});

		it('does not mark a partial approval-looking screen blocked', () => {
			const cb = vi.fn();
			monitor.onEvent(cb);
			monitor.feed('s1', 'TUI redraw', {
				profile: 'codex',
				getVisibleText: () => [
					'Would you like to run the following command?',
					'This is transcript prose, not a selection modal.',
				].join('\n'),
			});

			vi.advanceTimersByTime(3000);

			expect(cb).not.toHaveBeenCalled();
		});

		it('skips user-opened menus before broad legacy patterns', () => {
			const cb = vi.fn();
			monitor.onEvent(cb);
			monitor.feed('s1', 'TUI redraw', {
				profile: 'codex',
				getVisibleText: () => [
					'  Select approval mode',
					'› 1. Ask before commands',
					'  enter to select | esc to close',
				].join('\n'),
			});

			vi.advanceTimersByTime(3000);

			expect(cb).not.toHaveBeenCalled();
		});

		it('uses the current viewport instead of stale raw TUI output', () => {
			const cb = vi.fn();
			monitor.onEvent(cb);
			monitor.feed('s1', 'Do you want to approve this stale line?\n', {
				profile: 'codex',
				getVisibleText: () => '› Ready for the next prompt\n  ? for shortcuts',
			});

			vi.advanceTimersByTime(3000);

			expect(cb).not.toHaveBeenCalled();
		});

		it('emits unblocked when the detected prompt leaves the screen', () => {
			const cb = vi.fn();
			let screen = approvalScreen('Would you like to run the following command?');
			monitor.onEvent(cb);
			monitor.feed('s1', 'approval redraw', {
				profile: 'codex',
				getVisibleText: () => screen,
			});
			vi.advanceTimersByTime(3000);

			screen = '✔ You approved Codex to run this command\n› Ready for the next prompt';
			monitor.feed('s1', 'ready redraw', {
				profile: 'codex',
				getVisibleText: () => screen,
			});
			vi.advanceTimersByTime(3000);

			expect(cb).toHaveBeenLastCalledWith('s1', {
				kind: 'activity_update',
				agentActivity: 'unblocked',
			});
			expect(cb).toHaveBeenCalledTimes(2);
		});

		it('rechecks the rendered screen after a control-sequence-only redraw', () => {
			const cb = vi.fn();
			let screen = approvalScreen('Would you like to run the following command?');
			monitor.onEvent(cb);
			monitor.feed('s1', 'approval redraw', {
				profile: 'codex',
				getVisibleText: () => screen,
			});
			vi.advanceTimersByTime(3000);

			screen = '› Ready for the next prompt';
			monitor.feed('s1', '\x1b[2J', {
				profile: 'codex',
				getVisibleText: () => screen,
			});
			vi.advanceTimersByTime(3000);

			expect(cb).toHaveBeenLastCalledWith('s1', {
				kind: 'activity_update',
				agentActivity: 'unblocked',
			});
		});

		it('does not apply Codex activity rules to a generic profile', () => {
			const cb = vi.fn();
			monitor.onEvent(cb);
			monitor.feed('s1', 'TUI redraw', {
				profile: 'generic',
				getVisibleText: () => approvalScreen('Would you like to run the following command?'),
			});

			vi.advanceTimersByTime(3000);

			expect(cb).not.toHaveBeenCalled();
		});
	});

	describe('onEvent()', () => {
		it('returns unsubscribe function that stops callbacks', () => {
			const cb = vi.fn();
			const unsub = monitor.onEvent(cb);
			unsub();

			monitor.feed('s1', 'needs your permission\n');
			vi.advanceTimersByTime(3000);

			expect(cb).not.toHaveBeenCalled();
		});
	});

	describe('removeSession()', () => {
		it('clears last line for removed session', () => {
			monitor.feed('s1', 'Hello\n');
			monitor.removeSession('s1');
			expect(monitor.getLastLine('s1')).toBe('');
		});
	});
});
