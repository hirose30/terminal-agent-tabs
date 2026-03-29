import { ItemView, WorkspaceLeaf, Menu, Modal, App, Notice, ViewStateResult } from 'obsidian';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import type ClaudeCodeTabsPlugin from './main';
import type { StartMode, TabLaunchConfig } from './types';
import { OscParser } from './OscParser';
import { buildTerminalTheme, increaseFontSize, decreaseFontSize } from './TerminalTheme';

/** Electron module shape exposed via window.require('electron') in Obsidian desktop */
interface ElectronModule {
	clipboard?: { writeText(text: string): void };
}
interface ElectronRequireWindow extends Window {
	require?: (module: 'electron') => ElectronModule;
}

/** xterm private parser API (not part of public types) */
interface TerminalWithParser extends Terminal {
	parser?: {
		registerOscHandler(id: number, cb: (data: string) => boolean): { dispose(): void };
	};
}

/** WorkspaceLeaf private DOM properties not exposed in public types */
interface LeafWithTabHeader extends WorkspaceLeaf {
	tabHeaderEl?: HTMLElement;
	updateHeader?(): void;
}


export const VIEW_TYPE_CLAUDE_SESSION = 'claude-session-view';

export class ClaudeSessionView extends ItemView {
	plugin: ClaudeCodeTabsPlugin;
	sessionId: string;
	terminal: Terminal | null = null;
	fitAddon: FitAddon | null = null;
	headerText: string = 'Coding Session';
	private terminalContainer: HTMLElement | null = null;
	private statusContainer: HTMLElement | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private isExited: boolean = false;
	private oscParser: OscParser = new OscParser();
	private debugEnabled: boolean = false;
	private tabLaunchConfig: TabLaunchConfig | null = null;
	private supportsResume: boolean = false;
	private initialLaunchConfigFromState: Partial<TabLaunchConfig> | null = null;
	private osc52Disposer: { dispose: () => void } | null = null;
	private unsubscribeNotifications: (() => void) | null = null;
	private badgeEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ClaudeCodeTabsPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.sessionId = crypto.randomUUID();
	}

	getViewType(): string {
		return VIEW_TYPE_CLAUDE_SESSION;
	}

	getDisplayText(): string {
		return this.headerText;
	}

	getIcon(): string {
		return 'terminal';
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const stateObj = state as Record<string, unknown> | null | undefined;
		const launchConfig = stateObj?.initialLaunchConfig;
		if (launchConfig && typeof launchConfig === 'object') {
			this.initialLaunchConfigFromState = launchConfig as Partial<TabLaunchConfig>;
		} else {
			const legacyCliId = stateObj?.initialTargetCliId;
			this.initialLaunchConfigFromState =
				typeof legacyCliId === 'string' && legacyCliId.trim()
					? { cliId: legacyCliId }
					: null;
		}
		await super.setState(state, result);
	}

	private getInitialLaunchConfigFromLeafState(): Partial<TabLaunchConfig> | null {
		try {
			const state = this.leaf.getViewState().state;
			const launchConfig = state?.initialLaunchConfig;
			if (launchConfig && typeof launchConfig === 'object') {
				return launchConfig as Partial<TabLaunchConfig>;
			}
			const legacyCliId = state?.initialTargetCliId;
			return typeof legacyCliId === 'string' && legacyCliId.trim()
				? { cliId: legacyCliId }
				: null;
		} catch {
			return null;
		}
	}

	onPaneMenu(menu: Menu, source: string): void {
		super.onPaneMenu(menu, source);

		menu.addSeparator();

		menu.addItem((item) => {
			item.setTitle('Reset font size')
				.setIcon('reset')
				.onClick(() => this.resetFontSize());
		});

		menu.addItem((item) => {
			item.setTitle('Force resume restart')
				.setIcon('refresh-cw')
				.setDisabled(this.isExited || !this.supportsResume)
				.onClick(() => this.showForceResumeConfirmDialog());
		});
	}

	async onOpen(): Promise<void> {
		const pendingLaunchConfig = this.plugin.consumePendingLaunchConfig();
		const initialLaunchConfig =
			pendingLaunchConfig ||
			this.initialLaunchConfigFromState ||
			this.getInitialLaunchConfigFromLeafState();
		this.tabLaunchConfig = {
			...this.plugin.sessionManager.getDefaultLaunchConfig(),
			...(initialLaunchConfig || {})
		};

		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('claude-session-container');

		this.terminalContainer = container.createDiv({ cls: 'claude-terminal' });

		this.statusContainer = container.createDiv({ cls: 'claude-session-status is-hidden' });

		this.debugEnabled = this.isDebugEnabled();
		this.terminal = new Terminal({
			fontFamily: this.plugin.settings.terminalFontFamily,
			fontSize: this.plugin.settings.defaultFontSize,
			lineHeight: 1.0,
			letterSpacing: 0,
			customGlyphs: this.plugin.settings.terminalCustomGlyphs,
			rescaleOverlappingGlyphs: !this.plugin.settings.terminalCustomGlyphs,
			scrollback: 1000,
			cursorBlink: true,
			allowProposedApi: true,
			cancelEvents: true,
			macOptionIsMeta: true,
			theme: buildTerminalTheme(this.plugin.settings.terminalThemeName)
		});

		this.fitAddon = new FitAddon();
		this.terminal.loadAddon(this.fitAddon);

		try {
			const unicodeAddon = new Unicode11Addon();
			this.terminal.loadAddon(unicodeAddon);
			this.terminal.unicode.activeVersion = '11';
		} catch (e) {
			console.debug('[TerminalAgentTabs] Unicode11 addon could not be loaded:', e);
		}

		this.terminal.open(this.terminalContainer);
		this.registerOsc52ClipboardSync();
		this.loadWebglRenderer();

		this.fitAddon.fit();

		this.terminal.onTitleChange((title: string) => {
			this.updateHeaderText(title);
		});

		this.terminal.onData((data: string) => {
			this.plugin.sessionManager.writeToSession(this.sessionId, data);
		});

		this.terminal.onResize(({ cols, rows }) => {
			this.plugin.sessionManager.resizeSession(this.sessionId, cols, rows);
		});

		this.resizeObserver = new ResizeObserver(() => {
			if (this.fitAddon && this.terminal && !this.isExited) {
				this.fitAddon.fit();
			}
		});
		this.resizeObserver.observe(this.terminalContainer);

		this.addAction('minus', 'Decrease font size', () => this.decreaseFontSize());
		this.addAction('plus', 'Increase font size', () => this.increaseFontSize());

		this.unsubscribeNotifications = this.plugin.notificationStore.onChange(() => {
			this.updateTabBadge();
		});

		// Re-apply terminal theme when Obsidian theme changes
		this.registerEvent(
			this.app.workspace.on('css-change', () => {
				this.applyTerminalTheme();
			})
		);

		this.updateDefaultHeaderFromConfig();

		this.startSession('new');

		// Focus terminal after session starts so user can type immediately
		if (this.terminal) {
			this.terminal.focus();
		}
	}

	async onClose(): Promise<void> {
		if (this.unsubscribeNotifications) {
			this.unsubscribeNotifications();
			this.unsubscribeNotifications = null;
		}

		if (this.badgeEl) {
			this.badgeEl.remove();
			this.badgeEl = null;
		}

		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}

		if (this.osc52Disposer) {
			this.osc52Disposer.dispose();
			this.osc52Disposer = null;
		}

		if (this.terminal) {
			this.terminal.dispose();
			this.terminal = null;
		}

		this.plugin.outputMonitor.removeSession(this.sessionId);
		await this.plugin.sessionManager.terminateSession(this.sessionId);
	}

	private loadWebglRenderer(): void {
		if (!this.terminal) return;
		try {
			const webglAddon = new WebglAddon();
			webglAddon.onContextLoss(() => {
				// Fall back to canvas renderer if WebGL context is lost
				webglAddon.dispose();
			});
			this.terminal.loadAddon(webglAddon);
		} catch (e) {
			console.debug('[TerminalAgentTabs] WebGL renderer not available, using canvas fallback:', e);
		}
	}

	focusTerminal(): void {
		if (this.terminal) {
			this.terminal.focus();
		}
	}

	onResize(): void {
		if (this.fitAddon && this.terminal && !this.isExited) {
			this.fitAddon.fit();
		}
	}

	private handleProcessExit(exitCode: number): void {
		this.isExited = true;

		if (this.terminalContainer) {
			this.terminalContainer.addClass('is-hidden');
		}

		if (this.statusContainer) {
			this.statusContainer.removeClass('is-hidden');
			this.statusContainer.empty();

			if (exitCode === 0) {
				this.statusContainer.createDiv({ text: 'Session ended normally.', cls: 'claude-session-status-message' });
			} else {
				this.statusContainer.addClass('error');
				this.statusContainer.createDiv({ text: `Session exited with code ${exitCode}`, cls: 'claude-session-status-message' });
			}

			const buttonContainer = this.statusContainer.createDiv({ cls: 'claude-session-button-container' });

			const newSessionBtn = buttonContainer.createEl('button', { text: 'New session', cls: 'claude-session-btn' });
			newSessionBtn.onclick = () => { this.restartSession('new'); };

			const resumeBtn = buttonContainer.createEl('button', { text: 'Resume session...', cls: 'claude-session-btn claude-session-btn-primary' });
			resumeBtn.disabled = !this.supportsResume;
			resumeBtn.onclick = () => {
				if (!this.supportsResume) return;
				this.restartSession('continue');
			};

			const closeBtn = buttonContainer.createEl('button', { text: 'Close tab', cls: 'claude-session-btn' });
			closeBtn.onclick = () => this.leaf.detach();
		}
	}

	private showError(message: string, showNewSessionOption: boolean = false): void {
		this.isExited = true;

		if (this.terminalContainer) {
			this.terminalContainer.addClass('is-hidden');
		}

		if (this.statusContainer) {
			this.statusContainer.removeClass('is-hidden');
			this.statusContainer.addClass('error');
			this.statusContainer.empty();
			this.statusContainer.createDiv({ text: `Error: ${message}`, cls: 'claude-session-status-message' });
			this.statusContainer.createDiv({ text: 'Please check CLI settings.' });

			const buttonContainer = this.statusContainer.createDiv({ cls: 'claude-session-button-container' });

			if (showNewSessionOption) {
				const newSessionBtn = buttonContainer.createEl('button', { text: 'Start new session', cls: 'claude-session-btn claude-session-btn-primary' });
				newSessionBtn.onclick = () => { this.restartSession('new'); };
			}

			const closeBtn = buttonContainer.createEl('button', { text: 'Close tab', cls: 'claude-session-btn' });
			closeBtn.onclick = () => this.leaf.detach();
		}
	}

	private updateHeaderText(title: string): void {
		this.headerText = title || this.headerText || 'Coding Session';
		(this.leaf as LeafWithTabHeader).updateHeader?.();
		this.plugin.sessionManager.updateSessionHeader(this.sessionId, this.headerText);
		this.updateTabBadge();
	}

	private updateTabBadge(): void {
		const notificationCount = this.plugin.notificationStore.getCountForSession(this.sessionId);

		const tabHeaderEl = (this.leaf as LeafWithTabHeader).tabHeaderEl;
		if (!tabHeaderEl) return;

		if (this.badgeEl) {
			this.badgeEl.remove();
			this.badgeEl = null;
		}

		if (notificationCount > 0) {
			this.badgeEl = document.createElement('span');
			this.badgeEl.className = 'claude-tab-badge';
			this.badgeEl.textContent = String(notificationCount);
			const innerTitle = tabHeaderEl.querySelector('.workspace-tab-header-inner-title');
			if (innerTitle) {
				innerTitle.parentElement?.appendChild(this.badgeEl);
			} else {
				tabHeaderEl.appendChild(this.badgeEl);
			}
		}
	}

	private updateDefaultHeaderFromConfig(): void {
		if (!this.tabLaunchConfig) {
			this.updateHeaderText('Coding Session');
			return;
		}
		const cliLabel = this.plugin.sessionManager.getCliDisplayName(this.tabLaunchConfig.cliId);
		this.updateHeaderText(`${cliLabel} Session`);
	}

	private restartSession(startMode: StartMode = 'new'): void {
		this.isExited = false;
		this.oscParser.reset();

		if (this.statusContainer) {
			this.statusContainer.addClass('is-hidden');
			this.statusContainer.removeClass('error');
		}

		if (this.terminalContainer) {
			this.terminalContainer.removeClass('is-hidden');
		}

		if (this.terminal) {
			this.terminal.clear();
		}

		this.startSession(startMode, {
			parseOsc: true,
			showNewSessionOptionOnError: startMode === 'continue'
		});

		if (this.terminal) {
			this.terminal.focus();
		}
	}

	increaseFontSize(): void {
		if (!this.terminal) return;
		const currentSize = this.terminal.options.fontSize || this.plugin.settings.defaultFontSize;
		this.applyFontSize(increaseFontSize(currentSize));
	}

	decreaseFontSize(): void {
		if (!this.terminal) return;
		const currentSize = this.terminal.options.fontSize || this.plugin.settings.defaultFontSize;
		this.applyFontSize(decreaseFontSize(currentSize));
	}

	private applyFontSize(size: number): void {
		if (!this.terminal) return;
		this.terminal.options.fontSize = size;
		this.plugin.sessionManager.updateSessionFontSize(this.sessionId, size);
		if (this.fitAddon) {
			this.fitAddon.fit();
		}
	}

	applyTerminalAppearanceSettings(options?: { resetFontSize?: boolean }): void {
		if (!this.terminal) return;

		const resetFontSize = options?.resetFontSize ?? false;
		const effectiveFontSize = resetFontSize
			? this.plugin.settings.defaultFontSize
			: (this.terminal.options.fontSize || this.plugin.settings.defaultFontSize);

		this.terminal.options.fontFamily = this.plugin.settings.terminalFontFamily;
		this.terminal.options.lineHeight = 1.0;
		this.terminal.options.letterSpacing = 0;
		this.terminal.options.customGlyphs = this.plugin.settings.terminalCustomGlyphs;
		this.terminal.options.rescaleOverlappingGlyphs = !this.plugin.settings.terminalCustomGlyphs;
		this.terminal.options.fontSize = effectiveFontSize;
		this.terminal.options.theme = buildTerminalTheme(this.plugin.settings.terminalThemeName);
		this.terminal.clearTextureAtlas();
		this.plugin.sessionManager.updateSessionFontSize(this.sessionId, Number(effectiveFontSize));

		if (this.fitAddon) {
			this.fitAddon.fit();
		}
	}

	private applyTerminalTheme(): void {
		if (!this.terminal) return;
		const theme = buildTerminalTheme(this.plugin.settings.terminalThemeName);
		this.terminal.options.theme = theme;

		// Sync terminal container background with theme (dynamic value from user config)
		if (this.terminalContainer && theme.background) {
			this.terminalContainer.setCssProps({ 'background-color': theme.background });
		}
	}

	resetFontSize(): void {
		this.applyFontSize(this.plugin.settings.defaultFontSize);
	}

	private showForceResumeConfirmDialog(): void {
		const modal = new ForceResumeConfirmModal(this.app, () => {
			void this.forceResumeRestart();
		});
		modal.open();
	}

	private isDebugEnabled(): boolean {
		const envFlag = process.env?.CLAUDE_TABS_DEBUG;
		const envEnabled = envFlag === '1' || envFlag === 'true';
		return !!(this.plugin.settings.enableDebugLogging || envEnabled);
	}

	private registerOsc52ClipboardSync(): void {
		if (!this.terminal) return;

		try {
			const parser = (this.terminal as TerminalWithParser).parser;
			if (!parser?.registerOscHandler) {
				return;
			}

			this.osc52Disposer = parser.registerOscHandler(52, (data: string) => {
				if (!this.plugin.settings.enableOsc52ClipboardSync) {
					return false;
				}
				void this.handleOsc52ClipboardEvent(data);
				return true;
			});
		} catch (error) {
			if (this.debugEnabled) {
				console.debug('[TerminalAgentTabs] OSC 52 clipboard sync registration failed:', error);
			}
		}
	}

	private async handleOsc52ClipboardEvent(data: string): Promise<void> {
		try {
			const separatorIndex = data.indexOf(';');
			if (separatorIndex < 0) {
				return;
			}

			const payload = data.slice(separatorIndex + 1).trim();
			if (!payload || payload === '?') {
				return;
			}

			const text = this.decodeBase64ToUtf8(payload);
			if (text === null) {
				return;
			}

			await this.writeClipboardText(text);
		} catch (error) {
			if (this.debugEnabled) {
				console.debug('[TerminalAgentTabs] OSC 52 clipboard sync failed:', error);
			}
		}
	}

	private decodeBase64ToUtf8(value: string): string | null {
		const normalized = value.replace(/\s+/g, '');
		if (!normalized) {
			return '';
		}

		try {
			return Buffer.from(normalized, 'base64').toString('utf8');
		} catch {
			try {
				const binary = window.atob(normalized);
				const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
				return new TextDecoder().decode(bytes);
			} catch {
				return null;
			}
		}
	}

	private async writeClipboardText(text: string): Promise<void> {
		const electron = (window as ElectronRequireWindow).require?.('electron');
		if (electron?.clipboard?.writeText) {
			electron.clipboard.writeText(text);
			return;
		}

		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
		}
	}

	private async forceResumeRestart(): Promise<void> {
		if (!this.supportsResume) {
			new Notice('Resume is not configured for this CLI profile.');
			return;
		}

		this.isExited = true;

		await this.plugin.sessionManager.terminateSession(this.sessionId);

		this.isExited = false;

		if (this.statusContainer) {
			this.statusContainer.addClass('is-hidden');
			this.statusContainer.removeClass('error');
		}
		if (this.terminalContainer) {
			this.terminalContainer.removeClass('is-hidden');
		}

		if (this.terminal) {
			this.terminal.clear();
		}

		this.startSession('continue', {
			parseOsc: false,
			showNewSessionOptionOnError: true
		});
	}

	private startSession(startMode: StartMode = 'new', options?: { parseOsc?: boolean; showNewSessionOptionOnError?: boolean }): void {
		const { parseOsc = true, showNewSessionOptionOnError = false } = options || {};
		const launchConfig = this.tabLaunchConfig || this.plugin.sessionManager.getDefaultLaunchConfig();
		const canResume = this.plugin.sessionManager.isResumeSupportedForConfig(launchConfig);
		const effectiveStartMode = startMode === 'continue' && !canResume ? 'new' : startMode;

		if (startMode === 'continue' && effectiveStartMode === 'new') {
			new Notice('Resume is not configured for this CLI profile. Starting a new session.');
		}

		try {
			this.plugin.sessionManager.createSession(
				this.sessionId,
				(data: string) => {
					if (this.terminal && !this.isExited) {
						if (parseOsc) {
							const result = this.oscParser.parse(data);
							if (result.title) {
								this.updateHeaderText(result.title);
							}
						}
						this.terminal.write(data);
						// Feed output monitor for pattern detection and last-line tracking
						this.plugin.outputMonitor.feed(this.sessionId, data);
						const lastLine = this.plugin.outputMonitor.getLastLine(this.sessionId);
						if (lastLine) {
							this.plugin.sessionManager.updateSessionLastOutput(this.sessionId, lastLine);
						}
					}
				},
				(exitCode: number) => {
					this.handleProcessExit(exitCode);
				},
				effectiveStartMode,
				launchConfig
			);

			this.plugin.sessionManager.updateSessionTerminal(this.sessionId, this.terminal, this.fitAddon);
			const session = this.plugin.sessionManager.getSession(this.sessionId);
			this.supportsResume = !!session?.supportsResume;
			this.tabLaunchConfig = session?.tabLaunchConfig || launchConfig;
			this.updateDefaultHeaderFromConfig();

			if (this.terminal && this.fitAddon) {
				this.fitAddon.fit();
				this.plugin.sessionManager.resizeSession(this.sessionId, this.terminal.cols, this.terminal.rows);
			}

		} catch (error: unknown) {
			this.showError(error instanceof Error ? error.message : String(error), showNewSessionOptionOnError);
		}
	}
}

class ForceResumeConfirmModal extends Modal {
	private onConfirm: () => void;

	constructor(app: App, onConfirm: () => void) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl('h3', { text: 'Force resume restart' });
		contentEl.createEl('p', {
			text: 'This will terminate the current process and attempt to resume this tab session. Continue?'
		});

		const buttonContainer = contentEl.createDiv({ cls: 'claude-session-button-container claude-session-modal-buttons' });

		const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel', cls: 'claude-session-btn' });
		cancelBtn.onclick = () => this.close();

		const confirmBtn = buttonContainer.createEl('button', { text: 'Restart', cls: 'claude-session-btn claude-session-btn-primary' });
		confirmBtn.onclick = () => {
			this.close();
			this.onConfirm();
		};
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
