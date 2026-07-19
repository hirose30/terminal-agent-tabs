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

		const density = this.plugin.settings.sessionListDensity;
		this.contentContainer.removeClass('is-density-compact', 'is-density-normal', 'is-density-detailed');
		this.contentContainer.addClass(`is-density-${density}`);

		this.renderSessionsSection(this.contentContainer);
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
		const density = this.plugin.settings.sessionListDensity;
		const status = session?.status || 'exited';
		const notificationCount = this.plugin.notificationStore.getCountForSession(sessionId);
		const latestNotification = this.plugin.notificationStore.getLatestForSession(sessionId);
		const lastOutputLine = session?.lastOutputLine || '';
		const cliDisplayName = session
			? this.plugin.sessionManager.getCliDisplayName(session.cliId)
			: '';

		const statusKind = this.getNotificationStatusKind(latestNotification);
		const subtitleText = this.getSubtitleText(lastOutputLine, latestNotification, status, session?.exitCode);

		// Context line (CLI profile + elapsed time)
		const contextParts: string[] = [];
		if (cliDisplayName) contextParts.push(cliDisplayName);
		if (session?.createdAt) {
			contextParts.push(this.formatTimeAgo(session.createdAt));
		}

		// In compact/normal the omitted rows are surfaced through the card tooltip.
		let tooltip = '';
		if (density !== 'detailed') {
			const tooltipParts: string[] = [];
			if (density === 'compact' && subtitleText) tooltipParts.push(subtitleText);
			if (statusKind === 'action') tooltipParts.push('Needs input');
			else if (statusKind === 'complete') tooltipParts.push('Complete');
			if (contextParts.length > 0) tooltipParts.push(contextParts.join(' \u00B7 '));
			tooltip = tooltipParts.join('\n');
		}

		const card = container.createDiv({
			cls: `claude-sidebar-card${isActive ? ' is-active' : ''}`,
			attr: tooltip ? { title: tooltip } : undefined
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

		// Compact/normal collapse the status label into a trailing icon on the title row.
		if (density !== 'detailed' && statusKind) {
			const titleStatus = titleRow.createSpan({ cls: `claude-sidebar-card-title-status type-${statusKind}` });
			setIcon(titleStatus, statusKind === 'action' ? 'alert-triangle' : 'check-circle');
		}

		// Row 2: Latest output line or notification body (normal + detailed)
		if (density !== 'compact' && subtitleText) {
			card.createDiv({
				text: subtitleText,
				cls: 'claude-sidebar-card-subtitle'
			});
		}

		if (density === 'detailed') {
			// Row 3: Status label (if action needed)
			if (statusKind === 'action') {
				const statusLabel = card.createDiv({ cls: 'claude-sidebar-card-status-label type-action' });
				setIcon(statusLabel, 'alert-triangle');
				statusLabel.createSpan({ text: 'Needs input' });
			} else if (statusKind === 'complete') {
				const statusLabel = card.createDiv({ cls: 'claude-sidebar-card-status-label type-complete' });
				setIcon(statusLabel, 'check-circle');
				statusLabel.createSpan({ text: 'Complete' });
			}

			// Row 4: Context line (CLI profile + time)
			if (contextParts.length > 0) {
				card.createDiv({
					text: contextParts.join(' \u00B7 '),
					cls: 'claude-sidebar-card-context'
				});
			}
		}

		card.onclick = () => {
			void this.app.workspace.revealLeaf(leaf);
			const v = leaf.view as ClaudeSessionView;
			v.focusTerminal();
		};
	}

	private getNotificationStatusKind(
		notification: AgentNotification | undefined
	): 'action' | 'complete' | null {
		if (!notification) return null;
		if (notification.type === 'action_needed' || notification.type === 'needs_input') {
			return 'action';
		}
		if (notification.type === 'task_complete') {
			return 'complete';
		}
		return null;
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
