import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type ClaudeCodeTabsPlugin from './main';
import { ClaudeSessionView, VIEW_TYPE_CLAUDE_SESSION } from './ClaudeSessionView';
import type { AgentNotification } from './types';

export const VIEW_TYPE_SESSION_SIDEBAR = 'claude-session-sidebar';

export class SessionSidebarView extends ItemView {
	plugin: ClaudeCodeTabsPlugin;
	private contentContainer: HTMLElement | null = null;
	private unsubscribeNotifications: (() => void) | null = null;
	private unsubscribeSessions: (() => void) | null = null;
	private timeAgoTimer: ReturnType<typeof setInterval> | null = null;
	private renderDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ClaudeCodeTabsPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_SESSION_SIDEBAR;
	}

	getDisplayText(): string {
		return 'Agent sessions';
	}

	getIcon(): string {
		return 'terminal';
	}

	onOpen(): void {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('claude-sidebar-container');
		this.contentContainer = container;

		this.unsubscribeNotifications = this.plugin.notificationStore.onChange(() => {
			this.scheduleRender();
		});

		this.unsubscribeSessions = this.plugin.sessionManager.onChange(() => {
			this.scheduleRender();
		});

		// Refresh "time ago" labels every 60 seconds
		this.timeAgoTimer = setInterval(() => {
			this.render();
		}, 60_000);

		const activeLeafRef = this.app.workspace.on('active-leaf-change', () => {
			this.scheduleRender();
		});
		this.registerEvent(activeLeafRef);

		const layoutChangeRef = this.app.workspace.on('layout-change', () => {
			this.scheduleRender();
		});
		this.registerEvent(layoutChangeRef);

		this.render();
	}

	onClose(): void {
		if (this.unsubscribeNotifications) {
			this.unsubscribeNotifications();
			this.unsubscribeNotifications = null;
		}
		if (this.unsubscribeSessions) {
			this.unsubscribeSessions();
			this.unsubscribeSessions = null;
		}
		if (this.timeAgoTimer !== null) {
			clearInterval(this.timeAgoTimer);
			this.timeAgoTimer = null;
		}
		if (this.renderDebounceTimer !== null) {
			clearTimeout(this.renderDebounceTimer);
			this.renderDebounceTimer = null;
		}
	}

	/** Debounce render calls to avoid excessive DOM rebuilds. */
	private scheduleRender(): void {
		if (this.renderDebounceTimer !== null) {
			clearTimeout(this.renderDebounceTimer);
		}
		this.renderDebounceTimer = setTimeout(() => {
			this.renderDebounceTimer = null;
			this.render();
		}, 300);
	}

	render(): void {
		if (!this.contentContainer) return;
		this.contentContainer.empty();

		this.renderSessionsSection(this.contentContainer);
		this.renderNotificationsSection(this.contentContainer);
	}

	private renderSessionsSection(container: HTMLElement): void {
		const header = container.createDiv({ cls: 'claude-sidebar-section-header' });
		header.createSpan({ text: 'Sessions', cls: 'claude-sidebar-section-title' });

		const addBtn = header.createEl('button', { cls: 'claude-sidebar-icon-btn', attr: { 'aria-label': 'New session' } });
		setIcon(addBtn, 'plus');
		addBtn.onclick = () => {
			void this.plugin.openNewSession();
		};

		const sessionLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_SESSION);
		const activeLeaf = this.app.workspace.getMostRecentLeaf();

		if (sessionLeaves.length === 0) {
			container.createDiv({ text: 'No active sessions', cls: 'claude-sidebar-empty' });
			return;
		}

		const list = container.createDiv({ cls: 'claude-sidebar-session-list' });

		for (const leaf of sessionLeaves) {
			const view = leaf.view as ClaudeSessionView;
			const sessionId = view.sessionId;
			const session = this.plugin.sessionManager.getSession(sessionId);
			const isActive = leaf === activeLeaf;

			this.renderSessionCard(list, view, session, sessionId, isActive, leaf);
		}
	}

	private renderSessionCard(
		container: HTMLElement,
		view: ClaudeSessionView,
		session: ReturnType<typeof this.plugin.sessionManager.getSession>,
		sessionId: string,
		isActive: boolean,
		leaf: WorkspaceLeaf
	): void {
		const status = session?.status || 'exited';
		const notificationCount = this.plugin.notificationStore.getCountForSession(sessionId);
		const latestNotification = this.plugin.notificationStore.getLatestForSession(sessionId);
		const lastOutputLine = session?.lastOutputLine || '';
		const cliDisplayName = session
			? this.plugin.sessionManager.getCliDisplayName(session.cliId)
			: '';

		const card = container.createDiv({
			cls: `claude-sidebar-card${isActive ? ' is-active' : ''}`
		});

		// Row 1: Title with optional badge
		const titleRow = card.createDiv({ cls: 'claude-sidebar-card-title-row' });

		if (notificationCount > 0) {
			titleRow.createSpan({
				text: String(notificationCount),
				cls: 'claude-sidebar-badge'
			});
		}

		// Status dot
		const statusDot = titleRow.createSpan({ cls: 'claude-sidebar-card-status-dot' });
		if (status === 'running') {
			statusDot.addClass('status-running');
		} else if (status === 'error') {
			statusDot.addClass('status-error');
		} else {
			statusDot.addClass('status-exited');
		}

		titleRow.createSpan({
			text: view.getDisplayText(),
			cls: 'claude-sidebar-card-title'
		});

		// Row 2: Latest output line or notification body
		const subtitleText = this.getSubtitleText(lastOutputLine, latestNotification, status, session?.exitCode);
		if (subtitleText) {
			card.createDiv({
				text: subtitleText,
				cls: 'claude-sidebar-card-subtitle'
			});
		}

		// Row 3: Status label (if action needed)
		if (latestNotification && (latestNotification.type === 'action_needed' || latestNotification.type === 'needs_input')) {
			const statusLabel = card.createDiv({ cls: 'claude-sidebar-card-status-label type-action' });
			setIcon(statusLabel, 'alert-triangle');
			statusLabel.createSpan({ text: 'Needs input' });
		} else if (latestNotification && latestNotification.type === 'task_complete') {
			const statusLabel = card.createDiv({ cls: 'claude-sidebar-card-status-label type-complete' });
			setIcon(statusLabel, 'check-circle');
			statusLabel.createSpan({ text: 'Complete' });
		}

		// Row 4: Context line (CLI profile + time)
		const contextParts: string[] = [];
		if (cliDisplayName) contextParts.push(cliDisplayName);
		if (session?.createdAt) {
			contextParts.push(this.formatTimeAgo(session.createdAt));
		}
		if (contextParts.length > 0) {
			card.createDiv({
				text: contextParts.join(' \u00B7 '),
				cls: 'claude-sidebar-card-context'
			});
		}

		card.onclick = () => {
			void this.app.workspace.revealLeaf(leaf);
			const v = leaf.view as ClaudeSessionView;
			v.focusTerminal();
		};
	}

	private getSubtitleText(
		lastOutputLine: string,
		latestNotification: AgentNotification | undefined,
		status: string,
		exitCode: number | null | undefined
	): string {
		// Priority: last output line > notification body > status
		if (lastOutputLine) {
			return lastOutputLine;
		}
		if (latestNotification) {
			return latestNotification.body;
		}
		if (status === 'exited') {
			return `exited (${exitCode ?? '?'})`;
		}
		if (status === 'error') {
			return 'error';
		}
		return '';
	}

	private renderNotificationsSection(container: HTMLElement): void {
		const notifications = this.plugin.notificationStore.getAll();

		const header = container.createDiv({ cls: 'claude-sidebar-section-header' });
		const titleSpan = header.createSpan({ cls: 'claude-sidebar-section-title' });
		const totalUnread = this.plugin.notificationStore.getTotalCount();
		titleSpan.textContent = totalUnread > 0 ? `Notifications (${totalUnread})` : 'Notifications';

		if (notifications.length > 0) {
			const clearBtn = header.createEl('button', {
				cls: 'claude-sidebar-icon-btn',
				attr: { 'aria-label': 'Clear all notifications' }
			});
			setIcon(clearBtn, 'trash-2');
			clearBtn.onclick = () => {
				this.plugin.notificationStore.clearAll();
			};
		}

		if (notifications.length === 0) {
			container.createDiv({ text: 'No notifications', cls: 'claude-sidebar-empty' });
			return;
		}

		const list = container.createDiv({ cls: 'claude-sidebar-notification-list' });

		for (const notification of notifications) {
			this.renderNotificationItem(list, notification);
		}
	}

	private renderNotificationItem(container: HTMLElement, notification: AgentNotification): void {
		const item = container.createDiv({
			cls: 'claude-sidebar-notification-item is-unread'
		});

		// Row 1: Type badge + time
		const typeRow = item.createDiv({ cls: 'claude-sidebar-notification-type-row' });

		const typeBadge = typeRow.createSpan({ cls: 'claude-sidebar-notification-type' });
		if (notification.type === 'action_needed') {
			typeBadge.addClass('type-action');
			typeBadge.textContent = 'Action needed';
		} else if (notification.type === 'needs_input') {
			typeBadge.addClass('type-action');
			typeBadge.textContent = 'Needs input';
		} else if (notification.type === 'task_complete') {
			typeBadge.addClass('type-complete');
			typeBadge.textContent = 'Task complete';
		} else {
			typeBadge.addClass('type-event');
			typeBadge.textContent = 'Agent event';
		}

		const timeAgo = this.formatTimeAgo(notification.timestamp);
		typeRow.createSpan({ text: timeAgo, cls: 'claude-sidebar-notification-time' });

		// Row 2: Body (truncate to avoid huge JSON blobs)
		const bodyText = notification.body.length > 200
			? notification.body.slice(0, 200) + '...'
			: notification.body;
		item.createDiv({
			text: bodyText,
			cls: 'claude-sidebar-notification-body'
		});

		// Row 3: Source
		item.createDiv({
			text: notification.source,
			cls: 'claude-sidebar-notification-source'
		});

		item.onclick = () => {
			this.plugin.notificationStore.dismissNotification(notification.id);
			this.jumpToSession(notification.sessionId);
		};
	}

	private jumpToSession(sessionId: string): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_SESSION);
		let targetLeaf = leaves.find((leaf) => (leaf.view as ClaudeSessionView).sessionId === sessionId);
		// Fallback to first session if exact match not found
		if (!targetLeaf && leaves.length > 0) {
			targetLeaf = leaves[0];
		}
		if (targetLeaf) {
			void this.app.workspace.revealLeaf(targetLeaf);
			// Focus the terminal inside the view
			const view = targetLeaf.view as ClaudeSessionView;
			view.focusTerminal();
		}
	}

	private formatTimeAgo(date: Date): string {
		const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
		if (seconds < 60) return 'just now';
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}min ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}
}
