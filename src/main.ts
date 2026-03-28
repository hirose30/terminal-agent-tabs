import { Plugin, WorkspaceLeaf, Notice, FuzzySuggestModal, App, Editor, FileSystemAdapter } from 'obsidian';
import * as path from 'path';
import { ClaudeSessionView, VIEW_TYPE_CLAUDE_SESSION } from './ClaudeSessionView';
import {
	SessionManager,
	SPECIAL_CLI_ID_DEFAULT_SHELL
} from './SessionManager';
import { NotificationStore } from './NotificationStore';
import { OutputMonitor } from './OutputMonitor';
import { HookEventMonitor } from './HookEventMonitor';
import { DockBadge } from './DockBadge';
import { SessionSidebarView, VIEW_TYPE_SESSION_SIDEBAR } from './SessionSidebarView';
import { ClaudeCodeTabsSettingTab } from './settings';
import {
	ClaudeCodeTabsSettings,
	DEFAULT_SETTINGS,
	DEFAULT_TERMINAL_FONT_FAMILY,
	type CliProfile,
	type TabLaunchConfig,
} from './types';
import { migrateCliProfiles, type LegacySettingsShape } from './SettingsMigration';

function sanitizeTerminalFontFamily(value: unknown): string {
	if (typeof value !== 'string') return DEFAULT_TERMINAL_FONT_FAMILY;
	const trimmed = value.trim();
	if (!trimmed) return DEFAULT_TERMINAL_FONT_FAMILY;
	if (trimmed.includes('var(')) return DEFAULT_TERMINAL_FONT_FAMILY;
	return trimmed;
}

function sanitizeTerminalCustomGlyphs(value: unknown): boolean {
	if (typeof value === 'boolean') return value;
	return DEFAULT_SETTINGS.terminalCustomGlyphs;
}

export default class ClaudeCodeTabsPlugin extends Plugin {
	settings: ClaudeCodeTabsSettings;
	sessionManager: SessionManager;
	notificationStore: NotificationStore;
	outputMonitor: OutputMonitor;
	private hookEventMonitor: HookEventMonitor;
	private dockBadge: DockBadge;
	private pendingLaunchConfig: Partial<TabLaunchConfig> | null = null;

	async onload() {
		await this.loadSettings();

		this.sessionManager = new SessionManager(this);
		this.notificationStore = new NotificationStore();
		this.outputMonitor = new OutputMonitor();
		this.dockBadge = new DockBadge();

		// Sync dock badge with unread notification count
		this.notificationStore.onChange(() => {
			this.dockBadge.update(this.notificationStore.getTotalCount());
		});
		this.hookEventMonitor = new HookEventMonitor({
			pollIntervalMs: this.settings.hookEventsPollIntervalMs,
			debugLogging: this.settings.enableDebugLogging,
			callback: (event) => this.handleHookEvent(event)
		});

		// Auto-generate notifications from terminal output patterns
		this.outputMonitor.onEvent((sessionId, event) => {
			if (event.kind === 'action_needed') {
				this.notificationStore.addNotification(
					sessionId, 'action_needed', 'Action Needed', event.message, 'terminal'
				);
				this.playHookNotificationSound('action');
			} else if (event.kind === 'task_complete') {
				this.notificationStore.addNotification(
					sessionId, 'task_complete', 'Task Complete', event.message, 'terminal'
				);
				this.playHookNotificationSound('complete');
			}
		});

		// Register custom view
		this.registerView(
			VIEW_TYPE_CLAUDE_SESSION,
			(leaf: WorkspaceLeaf) => new ClaudeSessionView(leaf, this)
		);

		// Register sidebar view
		this.registerView(
			VIEW_TYPE_SESSION_SIDEBAR,
			(leaf: WorkspaceLeaf) => new SessionSidebarView(leaf, this)
		);

		// Ribbon icon to toggle sidebar
		this.addRibbonIcon('terminal', 'Agent Sessions', () => {
			this.toggleSidebar();
		});

		// Command: New Session Tab
		this.addCommand({
			id: 'new-session-tab',
			name: 'New Session Tab',
			callback: () => this.openNewSession({ cliId: this.settings.defaultCliId })
		});

		// Command: New Session Tab (Choose Target)
		this.addCommand({
			id: 'new-session-tab-choose-target',
			name: 'New Session Tab (Choose Target)',
			callback: () => this.openNewSessionWithPicker()
		});

		// Command: Send Selection to Current Session
		this.addCommand({
			id: 'send-selection',
			name: 'Send Selection to Current Session',
			editorCallback: (editor) => this.sendSelection(editor)
		});

		// Command: Increase Font Size (this tab)
		this.addCommand({
			id: 'increase-font-size',
			name: 'Increase Font Size (this tab)',
			checkCallback: (checking: boolean) => {
				const view = this.getActiveClaudeSessionView();
				if (view) {
					if (!checking) {
						view.increaseFontSize();
					}
					return true;
				}
				return false;
			}
		});

		// Command: Decrease Font Size (this tab)
		this.addCommand({
			id: 'decrease-font-size',
			name: 'Decrease Font Size (this tab)',
			checkCallback: (checking: boolean) => {
				const view = this.getActiveClaudeSessionView();
				if (view) {
					if (!checking) {
						view.decreaseFontSize();
					}
					return true;
				}
				return false;
			}
		});

		// Command: Reset Font Size (this tab)
		this.addCommand({
			id: 'reset-font-size',
			name: 'Reset Font Size (this tab)',
			checkCallback: (checking: boolean) => {
				const view = this.getActiveClaudeSessionView();
				if (view) {
					if (!checking) {
						view.resetFontSize();
					}
					return true;
				}
				return false;
			}
		});

		// Command: Toggle Session Sidebar
		this.addCommand({
			id: 'toggle-session-sidebar',
			name: 'Toggle Session Sidebar',
			callback: () => this.toggleSidebar()
		});

		// Command: Focus Active Session
		this.addCommand({
			id: 'focus-active-session',
			name: 'Focus Active Session',
			callback: () => this.focusActiveSession()
		});

		// Command: Focus Next Session
		this.addCommand({
			id: 'focus-next-session',
			name: 'Focus Next Session',
			callback: () => this.focusSessionByOffset(1)
		});

		// Command: Focus Previous Session
		this.addCommand({
			id: 'focus-previous-session',
			name: 'Focus Previous Session',
			callback: () => this.focusSessionByOffset(-1)
		});

		// Command: Split Session Horizontal
		this.addCommand({
			id: 'split-session-horizontal',
			name: 'Split Session (Horizontal)',
			callback: () => this.splitSession('horizontal')
		});

		// Command: Split Session Vertical
		this.addCommand({
			id: 'split-session-vertical',
			name: 'Split Session (Vertical)',
			callback: () => this.splitSession('vertical')
		});

		// Track active session for Send Selection + mark notifications as read
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf?.view instanceof ClaudeSessionView) {
					const view = leaf.view as ClaudeSessionView;
					this.sessionManager.setActiveSession(view.sessionId);
					this.notificationStore.dismissAllForSession(view.sessionId);
				}
			})
		);

		// Add settings tab
		this.addSettingTab(new ClaudeCodeTabsSettingTab(this.app, this));
		this.restartHookEventMonitor();

		// Window unload handler for emergency cleanup
		this.registerEvent(
			this.app.workspace.on('quit', () => {
				this.sessionManager.terminateAllSessions();
			})
		);
	}

	async onunload() {
		this.hookEventMonitor.stop();
		this.dockBadge.clear();
		this.outputMonitor.destroy();
		await this.sessionManager.terminateAllSessions();
	}

	async loadSettings() {
		const loaded = ((await this.loadData()) || {}) as LegacySettingsShape;
		const cliProfiles = migrateCliProfiles(loaded);
		const legacyDefault = loaded.defaultCliId;
		const isSpecialDefault = legacyDefault === SPECIAL_CLI_ID_DEFAULT_SHELL;
		const resolvedDefaultCliId = cliProfiles.some((profile) => profile.id === legacyDefault) || isSpecialDefault
			? (legacyDefault as string)
			: (cliProfiles.find((profile) => profile.id === 'claude')?.id || cliProfiles[0].id);

		this.settings = {
			defaultFontSize: loaded.defaultFontSize ?? DEFAULT_SETTINGS.defaultFontSize,
			terminalFontFamily: sanitizeTerminalFontFamily(loaded.terminalFontFamily),
			terminalCustomGlyphs: sanitizeTerminalCustomGlyphs(loaded.terminalCustomGlyphs),
			enableOsc52ClipboardSync:
				loaded.enableOsc52ClipboardSync ?? DEFAULT_SETTINGS.enableOsc52ClipboardSync,
			enableHookNotifications:
				loaded.enableHookNotifications ?? DEFAULT_SETTINGS.enableHookNotifications,
			enableHookNotificationSound:
				loaded.enableHookNotificationSound ?? DEFAULT_SETTINGS.enableHookNotificationSound,
			hookEventsFilePath:
				typeof loaded.hookEventsFilePath === 'string'
					? loaded.hookEventsFilePath
					: DEFAULT_SETTINGS.hookEventsFilePath,
			hookEventsPollIntervalMs:
				typeof loaded.hookEventsPollIntervalMs === 'number' && Number.isFinite(loaded.hookEventsPollIntervalMs)
					? Math.max(250, Math.min(10000, Math.floor(loaded.hookEventsPollIntervalMs)))
					: DEFAULT_SETTINGS.hookEventsPollIntervalMs,
			wrapSelectionInCodeBlock:
				loaded.wrapSelectionInCodeBlock ?? DEFAULT_SETTINGS.wrapSelectionInCodeBlock,
			includeNotePathInSelectionSend:
				loaded.includeNotePathInSelectionSend ?? DEFAULT_SETTINGS.includeNotePathInSelectionSend,
			enableDebugLogging: loaded.enableDebugLogging ?? DEFAULT_SETTINGS.enableDebugLogging,
			defaultCliId: resolvedDefaultCliId,
			terminalThemeName:
				typeof loaded.terminalThemeName === 'string'
					? loaded.terminalThemeName
					: DEFAULT_SETTINGS.terminalThemeName,
			cliProfiles
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	getDefaultHookEventsFilePath(): string {
		const adapter = this.app.vault.adapter;
		const vaultPath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
		const configDir = this.app.vault.configDir;
		return path.join(vaultPath, configDir, 'plugins', this.manifest.id, 'agent-events.jsonl');
	}

	getEffectiveHookEventsFilePath(): string {
		const configured = this.settings.hookEventsFilePath?.trim();
		return configured || this.getDefaultHookEventsFilePath();
	}

	restartHookEventMonitor(): void {
		this.hookEventMonitor.updateConfig({
			pollIntervalMs: this.settings.hookEventsPollIntervalMs,
			debugLogging: this.settings.enableDebugLogging
		});
		this.hookEventMonitor.start(this.getEffectiveHookEventsFilePath());
	}

	private handleHookEvent(event: import('./HookEventMonitor').HookEvent): void {
		// Skip agent_event notifications (e.g. pre-tool-use) as they are
		// high-frequency informational events that don't require user attention.
		if (event.notificationType === 'agent_event') {
			return;
		}

		const targetSessionId = this.sessionManager.resolveNotificationSessionId();
		this.notificationStore.addNotification(
			targetSessionId,
			event.notificationType,
			event.notificationTitle,
			event.message,
			event.source
		);

		if (this.settings.enableHookNotifications) {
			const noticeTimeout = event.notificationType === 'action_needed' ? 10000 : 5000;
			new Notice(`[${event.notificationTitle}] ${event.message}`, noticeTimeout);
		}
		this.playHookNotificationSound(event.soundKind);
	}

	private playHookNotificationSound(kind: 'action' | 'complete' | 'event'): void {
		if (!this.settings.enableHookNotificationSound) return;

		try {
			const electron = (window as any).require?.('electron');
			if (electron?.shell?.beep) {
				electron.shell.beep();
				if (kind === 'action') {
					window.setTimeout(() => {
						try {
							electron.shell.beep();
						} catch {
							// ignore
						}
					}, 120);
				}
				return;
			}
		} catch {
			// fallback to web audio below
		}

		try {
			const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
			if (!AudioCtx) return;
			const ctx = new AudioCtx();
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = 'sine';
			osc.frequency.value = kind === 'action' ? 920 : kind === 'complete' ? 740 : 620;
			gain.gain.value = 0.03;
			osc.connect(gain);
			gain.connect(ctx.destination);
			const now = ctx.currentTime;
			osc.start(now);
			osc.stop(now + 0.08);
			osc.onended = () => {
				void ctx.close();
			};
		} catch {
			// no-op if audio APIs are unavailable
		}
	}

	private async toggleSidebar(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_SESSION_SIDEBAR);
		if (existing.length > 0) {
			existing[0].detach();
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: VIEW_TYPE_SESSION_SIDEBAR,
				active: true
			});
			this.app.workspace.revealLeaf(leaf);
		}
	}

	private async splitSession(direction: 'horizontal' | 'vertical'): Promise<void> {
		const launchConfig: Partial<TabLaunchConfig> = { cliId: this.settings.defaultCliId };
		this.pendingLaunchConfig = launchConfig;
		const leaf = this.app.workspace.getLeaf('split', direction);
		await leaf.setViewState({
			type: VIEW_TYPE_CLAUDE_SESSION,
			state: { initialLaunchConfig: launchConfig },
			active: true
		});
		this.app.workspace.revealLeaf(leaf);
	}

	async openNewSession(initialLaunchConfig?: Partial<TabLaunchConfig>) {
		this.pendingLaunchConfig = initialLaunchConfig ?? null;
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({
			type: VIEW_TYPE_CLAUDE_SESSION,
			state: initialLaunchConfig ? { initialLaunchConfig } : {},
			active: true
		});
		this.app.workspace.revealLeaf(leaf);
	}

	consumePendingLaunchConfig(): Partial<TabLaunchConfig> | null {
		const pending = this.pendingLaunchConfig;
		this.pendingLaunchConfig = null;
		return pending;
	}

	applyTerminalAppearanceToOpenSessions(options?: { resetFontSize?: boolean }): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_SESSION);
		for (const leaf of leaves) {
			if (leaf.view instanceof ClaudeSessionView) {
				leaf.view.applyTerminalAppearanceSettings(options);
			}
		}
	}

	private focusActiveSession(): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_SESSION);
		if (leaves.length === 0) return;

		// Try last active session first (regardless of running status)
		const lastActiveId = this.sessionManager.getLastActiveSessionId();
		if (lastActiveId) {
			const leaf = leaves.find((l) =>
				l.view instanceof ClaudeSessionView && l.view.sessionId === lastActiveId
			);
			if (leaf) {
				this.app.workspace.revealLeaf(leaf);
				(leaf.view as ClaudeSessionView).focusTerminal();
				return;
			}
		}
		// Fallback to first session tab
		this.app.workspace.revealLeaf(leaves[0]);
		if (leaves[0].view instanceof ClaudeSessionView) {
			leaves[0].view.focusTerminal();
		}
	}

	private focusSessionByOffset(offset: number): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_SESSION);
		if (leaves.length === 0) return;

		const currentLeaf = this.app.workspace.activeLeaf;
		const currentIndex = leaves.findIndex((l) => l === currentLeaf);
		let nextIndex: number;
		if (currentIndex < 0) {
			nextIndex = 0;
		} else {
			nextIndex = (currentIndex + offset + leaves.length) % leaves.length;
		}
		this.app.workspace.revealLeaf(leaves[nextIndex]);
		if (leaves[nextIndex].view instanceof ClaudeSessionView) {
			(leaves[nextIndex].view as ClaudeSessionView).focusTerminal();
		}
	}

	private async openNewSessionWithPicker(): Promise<void> {
		const cliProfiles = this.sessionManager.getCliProfiles();
		if (cliProfiles.length === 0) {
			new Notice('No session targets available. Configure at least one CLI profile.');
			return;
		}

		const selected = await this.pickSessionTarget(cliProfiles);
		if (!selected) {
			return;
		}
		if (this.settings.enableDebugLogging) {
			console.debug('[TerminalAgentTabs] Choose Target selected:', selected.id, selected.displayName);
		}

		await this.openNewSession({ cliId: selected.id });
	}

	private async pickSessionTarget(targets: CliProfile[]): Promise<CliProfile | null> {
		return new Promise((resolve) => {
			const modal = new SessionTargetSuggestModal(this.app, targets, resolve);
			modal.open();
		});
	}

	getActiveClaudeSessionView(): ClaudeSessionView | null {
		const leaf = this.app.workspace.activeLeaf;
		if (leaf?.view instanceof ClaudeSessionView) {
			return leaf.view;
		}
		return null;
	}

	sendSelection(editor: Editor) {
		const selection = editor.getSelection();
		if (!selection) {
			return;
		}

		const session = this.sessionManager.getActiveSession();
		if (!session || !session.process) {
			new Notice('No active coding session');
			return;
		}

		let text = selection;

		if (this.settings.includeNotePathInSelectionSend) {
			const file = this.app.workspace.getActiveFile();
			if (file) {
				text = `File: ${file.path}\n\n${text}`;
			}
		}

		if (this.settings.wrapSelectionInCodeBlock) {
			text = '```\n' + text + '\n```';
		}

		this.sessionManager.writeToSession(session.sessionId, text);
	}
}

class SessionTargetSuggestModal extends FuzzySuggestModal<CliProfile> {
	private targets: CliProfile[];
	private resolver: (value: CliProfile | null) => void;
	private resolved: boolean = false;

	constructor(app: App, targets: CliProfile[], resolver: (value: CliProfile | null) => void) {
		super(app);
		this.targets = targets;
		this.resolver = resolver;
		this.setPlaceholder('Select session target');
	}

	getItems(): CliProfile[] {
		return this.targets;
	}

	getItemText(item: CliProfile): string {
		if (item.id === SPECIAL_CLI_ID_DEFAULT_SHELL) {
			return 'Default Shell';
		}
		return `${item.displayName} (${item.id})`;
	}

	onChooseItem(item: CliProfile): void {
		this.resolve(item);
	}

	onClose(): void {
		super.onClose();
		window.setTimeout(() => {
			if (!this.resolved) {
				this.resolve(null);
			}
		}, 0);
	}

	private resolve(value: CliProfile | null): void {
		if (this.resolved) return;
		this.resolved = true;
		this.resolver(value);
	}
}
