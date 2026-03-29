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
