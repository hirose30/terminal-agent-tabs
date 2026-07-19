import * as os from 'os';
import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type ClaudeCodeTabsPlugin from './main';
import { ClaudeSessionView, VIEW_TYPE_CLAUDE_SESSION } from './ClaudeSessionView';
import type { AgentNotification, NotificationType } from './types';

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
		this.contentContainer.removeClass('is-density-compact', 'is-density-normal');
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
		const latestNotification = this.plugin.notificationStore.getLatestForSession(sessionId);
		const lastOutputLine = session?.lastOutputLine || '';
		const cliDisplayName = session
			? this.plugin.sessionManager.getCliDisplayName(session.cliId)
			: '';

		const statusKind = this.getNotificationStatusKind(latestNotification);
		const subtitleText = this.getSubtitleText(lastOutputLine, latestNotification, status, session?.exitCode);

		// A labelled, multi-line tooltip carries the full detail neither density can
		// show: the visible rows are truncated (normal subtitle) or omitted (compact).
		const tooltip = this.buildCardTooltip(
			view.getDisplayText(),
			session,
			status,
			cliDisplayName,
			lastOutputLine,
			latestNotification
		);

		const card = container.createDiv({
			cls: `claude-sidebar-card${isActive ? ' is-active' : ''}`,
			attr: tooltip ? { title: tooltip } : undefined
		});

		// Row 1: Title row. Attention is conveyed by the trailing status icon
		// below, not a numeric count.
		const titleRow = card.createDiv({ cls: 'claude-sidebar-card-title-row' });

		// Status dot
		const statusDot = titleRow.createSpan({ cls: 'claude-sidebar-card-status-dot' });
		if (status === 'running') {
			// Agent activity refines the running dot; idle/unknown keep the
			// legacy green so CLIs without OSC activity titles look unchanged.
			if (session?.agentActivity === 'working') {
				statusDot.addClass('status-working');
			} else {
				statusDot.addClass('status-running');
			}
		} else if (status === 'error') {
			statusDot.addClass('status-error');
		} else {
			statusDot.addClass('status-exited');
		}

		titleRow.createSpan({
			text: view.getDisplayText(),
			cls: 'claude-sidebar-card-title'
		});

		// Trailing status icon collapses the "needs input / complete" signal onto the title row.
		if (statusKind) {
			const titleStatus = titleRow.createSpan({ cls: `claude-sidebar-card-title-status type-${statusKind}` });
			setIcon(titleStatus, statusKind === 'action' ? 'alert-triangle' : 'check-circle');
		}

		// Row 2: one-line subtitle (normal only)
		if (density === 'normal' && subtitleText) {
			card.createDiv({
				text: subtitleText,
				cls: 'claude-sidebar-card-subtitle'
			});
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

	/** Build the labelled, multi-line tooltip shown on hover for a session card. */
	private buildCardTooltip(
		displayName: string,
		session: ReturnType<typeof this.plugin.sessionManager.getSession>,
		status: string,
		cliDisplayName: string,
		lastOutputLine: string,
		latestNotification: AgentNotification | undefined
	): string {
		const lines: string[] = [displayName];

		let statusText = status;
		if (status === 'exited') {
			statusText = `exited (${session?.exitCode ?? '?'})`;
		}
		lines.push(`Status: ${statusText}`);

		const activity = session?.agentActivity;
		if (activity && activity !== 'unknown') {
			lines.push(`Activity: ${activity}`);
		}

		if (cliDisplayName) lines.push(`CLI: ${cliDisplayName}`);
		if (session?.launchCwd) lines.push(`Folder: ${this.shortenHomePath(session.launchCwd)}`);
		if (session?.createdAt) lines.push(`Started: ${this.formatTimeAgo(session.createdAt)}`);
		if (lastOutputLine) lines.push(`Last output: ${lastOutputLine}`);

		if (latestNotification) {
			const label = this.getNotificationLabel(latestNotification.type);
			const body = latestNotification.body.length > 200
				? latestNotification.body.slice(0, 200) + '...'
				: latestNotification.body;
			const when = this.formatTimeAgo(latestNotification.timestamp);
			lines.push(`Latest: [${label}] ${body} (${when})`);
		}

		return lines.join('\n');
	}

	private getNotificationLabel(type: NotificationType): string {
		if (type === 'task_complete') return 'Complete';
		if (type === 'agent_event') return 'Agent event';
		// 'action_needed' | 'needs_input'
		return 'Needs input';
	}

	/** Replace a leading home-directory path with '~' for compact display. */
	private shortenHomePath(fsPath: string): string {
		const home = os.homedir();
		if (home && (fsPath === home || fsPath.startsWith(`${home}/`))) {
			return `~${fsPath.slice(home.length)}`;
		}
		return fsPath;
	}

	private getSubtitleText(
		lastOutputLine: string,
		latestNotification: AgentNotification | undefined,
		status: string,
		exitCode: number | null | undefined
	): string {
		// Priority: notification body > last output line > status fallback.
		// (lastOutputLine is usually Claude Code's status-bar line, so the
		// notification body is the more useful subtitle when one exists.)
		if (latestNotification) {
			// An empty/whitespace-only body must not swallow the lastOutputLine fallback.
			const body = this.toSingleLine(latestNotification.body, 120);
			if (body) return body;
		}
		if (lastOutputLine) {
			return lastOutputLine;
		}
		if (status === 'exited') {
			return `exited (${exitCode ?? '?'})`;
		}
		if (status === 'error') {
			return 'error';
		}
		return '';
	}

	/** Collapse whitespace to single spaces and cap length with a trailing ellipsis. */
	private toSingleLine(text: string, maxLength: number): string {
		const collapsed = text.replace(/\s+/g, ' ').trim();
		return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength)}…` : collapsed;
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
