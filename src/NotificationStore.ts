import type { AgentNotification, NotificationType } from './types';

export type NotificationChangeCallback = () => void;

export class NotificationStore {
	private notifications: AgentNotification[] = [];
	private listeners: Set<NotificationChangeCallback> = new Set();
	private maxNotifications = 200;

	addNotification(
		sessionId: string,
		type: NotificationType,
		title: string,
		body: string,
		source: string
	): AgentNotification {
		const notification: AgentNotification = {
			id: crypto.randomUUID(),
			sessionId,
			type,
			title,
			body,
			source,
			timestamp: new Date()
		};

		this.notifications.unshift(notification);

		if (this.notifications.length > this.maxNotifications) {
			this.notifications = this.notifications.slice(0, this.maxNotifications);
		}

		this.emit();
		return notification;
	}

	dismissNotification(notificationId: string): void {
		const before = this.notifications.length;
		this.notifications = this.notifications.filter((n) => n.id !== notificationId);
		if (this.notifications.length !== before) this.emit();
	}

	dismissAllForSession(sessionId: string): void {
		const before = this.notifications.length;
		this.notifications = this.notifications.filter((n) => n.sessionId !== sessionId);
		if (this.notifications.length !== before) this.emit();
	}

	clearAll(): void {
		if (this.notifications.length === 0) return;
		this.notifications = [];
		this.emit();
	}

	getAll(): AgentNotification[] {
		return this.notifications;
	}

	getCountForSession(sessionId: string): number {
		let count = 0;
		for (const n of this.notifications) {
			if (n.sessionId === sessionId) count++;
		}
		return count;
	}

	getTotalCount(): number {
		return this.notifications.length;
	}

	getLatest(): AgentNotification | undefined {
		return this.notifications[0];
	}

	getLatestForSession(sessionId: string): AgentNotification | undefined {
		return this.notifications.find((n) => n.sessionId === sessionId);
	}

	onChange(callback: NotificationChangeCallback): () => void {
		this.listeners.add(callback);
		return () => {
			this.listeners.delete(callback);
		};
	}

	private emit(): void {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch {
				// ignore
			}
		}
	}
}
