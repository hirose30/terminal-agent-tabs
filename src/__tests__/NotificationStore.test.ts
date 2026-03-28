import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationStore } from '../NotificationStore';

describe('NotificationStore', () => {
	let store: NotificationStore;

	beforeEach(() => {
		store = new NotificationStore();
	});

	describe('addNotification()', () => {
		it('adds a notification and returns it', () => {
			const n = store.addNotification('s1', 'action_needed', 'Title', 'Body', 'claude');
			expect(n.sessionId).toBe('s1');
			expect(n.type).toBe('action_needed');
			expect(n.title).toBe('Title');
			expect(n.body).toBe('Body');
			expect(n.source).toBe('claude');
			expect(n.id).toBeTruthy();
		});

		it('increments total count', () => {
			store.addNotification('s1', 'agent_event', 'T', 'B', 'src');
			store.addNotification('s1', 'agent_event', 'T', 'B', 'src');
			expect(store.getTotalCount()).toBe(2);
		});

		it('prepends (latest first)', () => {
			store.addNotification('s1', 'agent_event', 'First', 'B', 'src');
			store.addNotification('s1', 'agent_event', 'Second', 'B', 'src');
			expect(store.getLatest()?.title).toBe('Second');
		});

		it('fires onChange listeners', () => {
			const cb = vi.fn();
			store.onChange(cb);
			store.addNotification('s1', 'agent_event', 'T', 'B', 'src');
			expect(cb).toHaveBeenCalledOnce();
		});
	});

	describe('getTotalCount() / getCountForSession()', () => {
		it('returns 0 initially', () => {
			expect(store.getTotalCount()).toBe(0);
			expect(store.getCountForSession('s1')).toBe(0);
		});

		it('counts per session independently', () => {
			store.addNotification('s1', 'agent_event', 'T', 'B', 'src');
			store.addNotification('s1', 'agent_event', 'T', 'B', 'src');
			store.addNotification('s2', 'agent_event', 'T', 'B', 'src');
			expect(store.getCountForSession('s1')).toBe(2);
			expect(store.getCountForSession('s2')).toBe(1);
			expect(store.getTotalCount()).toBe(3);
		});
	});

	describe('dismissNotification()', () => {
		it('removes the notification by id', () => {
			const n = store.addNotification('s1', 'agent_event', 'T', 'B', 'src');
			store.dismissNotification(n.id);
			expect(store.getTotalCount()).toBe(0);
		});

		it('fires onChange when removed', () => {
			const n = store.addNotification('s1', 'agent_event', 'T', 'B', 'src');
			const cb = vi.fn();
			store.onChange(cb);
			store.dismissNotification(n.id);
			expect(cb).toHaveBeenCalledOnce();
		});

		it('does not fire onChange for unknown id', () => {
			const cb = vi.fn();
			store.onChange(cb);
			store.dismissNotification('nonexistent-id');
			expect(cb).not.toHaveBeenCalled();
		});
	});

	describe('dismissAllForSession()', () => {
		it('removes all notifications for the session', () => {
			store.addNotification('s1', 'agent_event', 'T', 'B', 'src');
			store.addNotification('s1', 'agent_event', 'T', 'B', 'src');
			store.addNotification('s2', 'agent_event', 'T', 'B', 'src');
			store.dismissAllForSession('s1');
			expect(store.getCountForSession('s1')).toBe(0);
			expect(store.getCountForSession('s2')).toBe(1);
		});
	});

	describe('clearAll()', () => {
		it('removes everything', () => {
			store.addNotification('s1', 'agent_event', 'T', 'B', 'src');
			store.addNotification('s2', 'task_complete', 'T', 'B', 'src');
			store.clearAll();
			expect(store.getTotalCount()).toBe(0);
		});

		it('does not fire onChange when already empty', () => {
			const cb = vi.fn();
			store.onChange(cb);
			store.clearAll();
			expect(cb).not.toHaveBeenCalled();
		});
	});

	describe('getLatestForSession()', () => {
		it('returns undefined for unknown session', () => {
			expect(store.getLatestForSession('unknown')).toBeUndefined();
		});

		it('returns most recent notification for session', () => {
			store.addNotification('s1', 'agent_event', 'Old', 'B', 'src');
			store.addNotification('s1', 'task_complete', 'New', 'B', 'src');
			expect(store.getLatestForSession('s1')?.title).toBe('New');
		});
	});

	describe('onChange()', () => {
		it('returns unsubscribe function', () => {
			const cb = vi.fn();
			const unsub = store.onChange(cb);
			unsub();
			store.addNotification('s1', 'agent_event', 'T', 'B', 'src');
			expect(cb).not.toHaveBeenCalled();
		});
	});
});
