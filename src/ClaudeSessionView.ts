import { ItemView, WorkspaceLeaf, Menu, Modal, App, Notice, ViewStateResult } from 'obsidian';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { SerializeAddon } from '@xterm/addon-serialize';
import type ClaudeCodeTabsPlugin from './main';
import type { StartMode, TabLaunchConfig } from './types';
import { OscParser, parseTitleActivity } from './OscParser';
import { isBlockedClearingInput } from './AgentActivity';
import { buildTerminalTheme, increaseFontSize, decreaseFontSize } from './TerminalTheme';
import { buildPersistedSessionState, parsePersistedSessionState } from './PersistedSessionState';
import { stripPrivateModeSequences } from './utils';

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
	// Phase 4: scrollback serialization for repaint on restore.
	private serializeAddon: SerializeAddon | null = null;
	private scrollbackDirty: boolean = false;
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
	// cwd recovered from persisted state on restore (Phase 1). null → default (vault).
	private restoredCwd: string | null = null;
	// The cwd this tab launches sessions in; reused across in-place restarts.
	private launchCwd: string | null = null;
	// Live cwd reported by the shell via OSC 7 (Phase 3). Overrides launchCwd for persistence.
	private liveCwd: string | null = null;
	// Tier1 resume key (Phase 2): Claude's --session-id. Persisted, reused to --resume on restore.
	private resumeKey: string | null = null;
	// Tier1 (Codex): captured codex session id, persisted and reused for `codex resume <id>`.
	private codexSessionId: string | null = null;
	// Launch config captured from a pending new-tab open (consumed synchronously in onOpen).
	private pendingLaunchConfigCaptured: Partial<TabLaunchConfig> | null = null;
	private osc52Disposer: { dispose: () => void } | null = null;
	private unsubscribeSessions: (() => void) | null = null;
	private activityDotEl: HTMLElement | null = null;
	// Class currently rendered on the tab-header activity dot ('' = no dot);
	// lets the session-change subscription skip DOM work on unrelated changes.
	private activityDotCls: string = '';
	// Restore-start coordination. With deferred views, a tab activated after layout is
	// already ready fires its onLayoutReady callback synchronously — BEFORE Obsidian calls
	// setState — so the persisted cwd/resumeKey would not yet be applied. Start the initial
	// session only once BOTH the layout is ready AND setState has run, so restore values are
	// always in place first. (For startup-loaded tabs setState already precedes layout-ready.)
	private viewLayoutReady: boolean = false;
	private viewStateApplied: boolean = false;
	private initialSessionStarted: boolean = false;

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

	// Obsidian serializes getState() into workspace.json and replays it through
	// setState() after a restart. Phase 1 persists the launch cwd here (alongside
	// the legacy initialLaunchConfig, kept for backward read-compat) so the tab can
	// relaunch in the same directory. Note Obsidian's restore order is
	// onOpen -> setState, so the restored value is consumed at session-start time
	// (deferred to onLayoutReady), not synchronously in onOpen.
	getState(): Record<string, unknown> {
		const base = super.getState() || {};
		const cliId = this.tabLaunchConfig?.cliId;
		if (!cliId) return base;
		const additionalArgs = this.tabLaunchConfig?.additionalArgs ?? [];
		const session = this.plugin.sessionManager.getSession(this.sessionId);
		// Phase 3: a live cwd (OSC 7) wins over the launch cwd so restore returns to where the user is.
		const cwd = this.liveCwd ?? session?.launchCwd ?? this.launchCwd ?? this.restoredCwd ?? null;
		// The live session's captured codex id (refreshed post-launch) wins over the restored one.
		const codexSessionId =
			session?.codexSessionId ??
			this.plugin.sessionManager.getRetainedCodexSessionId(this.sessionId) ??
			this.codexSessionId ??
			undefined;
		const state: Record<string, unknown> = {
			...base,
			initialLaunchConfig: { cliId, additionalArgs }
		};
		if (cwd) {
			Object.assign(state, buildPersistedSessionState({ cliId, additionalArgs }, cwd, this.resumeKey ?? undefined, codexSessionId));
		}
		return state;
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const stateObj = state as Record<string, unknown> | null | undefined;
		this.applyStateObject(stateObj);
		if (this.isDebugEnabled()) {
			console.debug(
				'[TerminalAgentTabs] setState: restoredCwd=', this.restoredCwd,
				'cliId=', this.initialLaunchConfigFromState?.cliId,
				'resumeKey=', this.resumeKey
			);
		}
		await super.setState(state, result);

		// Persisted cwd/resumeKey are now applied; release the restore-start gate. For deferred
		// tabs this is what lets startInitialSession see the restored values (fixes the race
		// where onLayoutReady fired before setState and the tab started fresh).
		this.viewStateApplied = true;
		this.maybeStartInitialSession();
	}

	private applyStateObject(stateObj: Record<string, unknown> | null | undefined): void {
		const persisted = parsePersistedSessionState(stateObj);
		if (persisted) {
			this.initialLaunchConfigFromState = {
				cliId: persisted.cliId,
				additionalArgs: persisted.additionalArgs
			};
			this.restoredCwd = persisted.cwd;
			this.resumeKey = persisted.resumeKey ?? null;
			this.codexSessionId = persisted.codexSessionId ?? null;
		} else {
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
		}
	}

	private applyPersistedStateFromLeafState(): boolean {
		try {
			const state = this.leaf.getViewState().state as Record<string, unknown> | null | undefined;
			if (!parsePersistedSessionState(state)) return false;
			this.applyStateObject(state);
			return true;
		} catch {
			return false;
		}
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

	// eslint-disable-next-line @typescript-eslint/require-await -- Obsidian API requires Promise<void> return type
	async onOpen(): Promise<void> {
		// Consume the pending new-tab launch config NOW (it is a transient plugin-level
		// slot the next tab-open would clobber), but defer the actual session start to
		// onLayoutReady. On restore Obsidian calls onOpen BEFORE setState, so the restored
		// cwd/cliId are only available after the workspace layout has been restored.
		this.pendingLaunchConfigCaptured = this.plugin.consumePendingLaunchConfig();
		this.tabLaunchConfig = this.resolveTabLaunchConfig();

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
		this.loadSerializeAddon();

		this.fitAddon.fit();

		this.terminal.onTitleChange((title: string) => {
			this.updateHeaderText(title);
		});

		this.terminal.onData((data: string) => {
			// Enter or a lone Esc while blocked means the user answered or
			// cancelled the prompt (Esc-cancel emits no Stop hook and no
			// title change, so nothing else would clear the state). The
			// filter matters: onData also carries focus-reporting sequences
			// (\x1b[I / \x1b[O), which used to clear blocked just for
			// focusing the tab — see isBlockedClearingInput().
			if (isBlockedClearingInput(data)) {
				this.plugin.sessionManager.updateSessionActivity(this.sessionId, 'user-input');
			}
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

		// Mirror the sidebar's activity colors on the tab header itself, so
		// working/blocked is visible without opening the sidebar.
		this.unsubscribeSessions = this.plugin.sessionManager.onChange(() => {
			this.updateTabActivityDot();
		});
		this.updateTabActivityDot();

		// Re-apply terminal theme when Obsidian theme changes
		this.registerEvent(
			this.app.workspace.on('css-change', () => {
				this.applyTerminalTheme();
			})
		);

		this.updateDefaultHeaderFromConfig();

		// Phase 4: periodically persist the scrollback (debounced via a dirty flag) so a
		// crash/quit still leaves a recent screen to repaint.
		this.registerInterval(window.setInterval(() => this.autosaveScrollback(), 5000));

		// Defer session start until the workspace layout is ready AND setState has applied any
		// persisted state (see maybeStartInitialSession). At startup the order is onOpen ->
		// setState -> layout-ready; for a deferred tab activated later, layout is already ready
		// so this callback runs before setState — the flag coordination handles both.
		this.app.workspace.onLayoutReady(() => {
			this.viewLayoutReady = true;
			this.maybeStartInitialSession();
			// Safety net: a creation path that never calls setState must not leave the tab
			// blank forever. setState normally arrives within a few ms; wait a bit longer.
			if (!this.initialSessionStarted) {
				window.setTimeout(() => {
					if (this.initialSessionStarted) return;
					const appliedPersistedState = this.applyPersistedStateFromLeafState();
					if (appliedPersistedState && this.debugEnabled) {
						console.debug('[TerminalAgentTabs] Applied persisted state from leaf before safety-start.');
					}
					this.viewStateApplied = true;
					this.maybeStartInitialSession();
				}, 150);
			}
		});
	}

	/** Start the initial session once both the layout is ready and setState has applied. */
	private maybeStartInitialSession(): void {
		if (this.initialSessionStarted) return;
		if (!this.viewLayoutReady || !this.viewStateApplied) return;
		this.initialSessionStarted = true;
		this.startInitialSession();
	}

	private loadSerializeAddon(): void {
		if (!this.terminal) return;
		try {
			this.serializeAddon = new SerializeAddon();
			this.terminal.loadAddon(this.serializeAddon);
		} catch (e) {
			console.debug('[TerminalAgentTabs] Serialize addon not available:', e);
		}
	}

	private autosaveScrollback(): void {
		if (this.scrollbackDirty) this.saveScrollbackNow();
	}

	private saveScrollbackNow(): void {
		if (!this.terminal || !this.serializeAddon || !this.resumeKey) return;
		try {
			// excludeModes/excludeAltBuffer keep the dump to plain normal-buffer text:
			// replaying mode-set or alt-screen sequences can corrupt a fresh terminal.
			const content = this.serializeAddon.serialize({
				scrollback: 4000,
				excludeModes: true,
				excludeAltBuffer: true
			});
			this.plugin.sessionManager.saveScrollback(this.resumeKey, content);
			this.scrollbackDirty = false;
		} catch (e) {
			if (this.debugEnabled) {
				console.debug('[TerminalAgentTabs] scrollback serialize failed:', e);
			}
		}
	}

	private resolveTabLaunchConfig(): TabLaunchConfig {
		const initial =
			this.pendingLaunchConfigCaptured ||
			this.initialLaunchConfigFromState ||
			this.getInitialLaunchConfigFromLeafState();
		return {
			...this.plugin.sessionManager.getDefaultLaunchConfig(),
			...(initial || {})
		};
	}

	private startInitialSession(): void {
		// The tab may have been closed before the layout became ready.
		if (this.isExited || !this.terminal) return;
		// Recompute now that setState() has run on the restore path.
		this.tabLaunchConfig = this.resolveTabLaunchConfig();
		this.launchCwd = this.restoredCwd;
		this.updateDefaultHeaderFromConfig();

		// Tier1 (Phase 2): a restored tab resumes its prior conversation when possible.
		const isRestore = this.restoredCwd != null || this.resumeKey != null;
		const startMode: StartMode = isRestore && this.canResumeRestoredSession() ? 'continue' : 'new';

		// Phase 4: repaint the last screen only for sessions that won't redraw themselves.
		// A resumed agent (`claude --resume`, `codex resume`) repaints its own UI, and
		// replaying a TUI's serialized buffer can corrupt the display — so repaint on 'new' only.
		if (isRestore && startMode === 'new' && this.resumeKey && this.terminal) {
			const scrollback = this.plugin.sessionManager.loadScrollback(this.resumeKey);
			if (scrollback) {
				// Strip private-mode toggles as a safety net (in case of a pre-fix/tainted dump).
				this.terminal.write(stripPrivateModeSequences(scrollback));
			}
		}

		this.startSession(startMode, { cwd: this.launchCwd ?? undefined });
		// Focus terminal after session starts so user can type immediately
		if (this.terminal) {
			this.terminal.focus();
		}
	}

	/** Whether the restored persisted state is enough to resume (vs. start fresh). */
	private canResumeRestoredSession(): boolean {
		const config = this.tabLaunchConfig;
		if (!config) return false;
		const strategy = this.plugin.sessionManager.getResumeStrategy(config);
		if (strategy === 'assign-id') {
			return !!this.resumeKey
				&& this.plugin.sessionManager.claudeTranscriptExists(this.launchCwd ?? '', this.resumeKey);
		}
		if (strategy === 'continue-latest') {
			// Codex resumes the most recent session scoped to this cwd (best-effort).
			return !!this.launchCwd;
		}
		return false;
	}

	async onClose(): Promise<void> {
		// Phase 4: capture the final screen while the terminal is still alive (also covers quit).
		this.saveScrollbackNow();

		if (this.unsubscribeSessions) {
			this.unsubscribeSessions();
			this.unsubscribeSessions = null;
		}

		if (this.activityDotEl) {
			this.activityDotEl.remove();
			this.activityDotEl = null;
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
		// Titles reach here from both xterm's onTitleChange and the OscParser
		// path; peel the activity prefix off in one place so tab/header text
		// stays clean and the state lands on the session either way.
		const { state, cleanTitle } = parseTitleActivity(title);
		if (state) {
			this.plugin.sessionManager.updateSessionActivity(
				this.sessionId,
				state === 'working' ? 'osc-working' : 'osc-idle'
			);
		}
		const nextHeaderText = cleanTitle || this.headerText || 'Coding Session';
		// Spinner retitles only change the (already stripped) prefix; skip the
		// tab-header DOM work when the visible text is unchanged. The activity
		// dot refreshes separately via the session-manager subscription.
		if (nextHeaderText === this.headerText) return;
		this.headerText = nextHeaderText;
		(this.leaf as LeafWithTabHeader).updateHeader?.();
		this.plugin.sessionManager.updateSessionHeader(this.sessionId, this.headerText);
		// updateHeader() may rebuild the tab header DOM; re-attach the dot.
		this.activityDotCls = '';
		this.updateTabActivityDot();
	}

	/**
	 * Render the agent-activity dot on this tab's header (same semantics and
	 * colors as the sidebar dots): pulsing yellow while working, pulsing red
	 * while blocked, no dot for idle/unknown/exited so tabs stay clean.
	 */
	private updateTabActivityDot(): void {
		const activity = this.plugin.sessionManager.getSession(this.sessionId)?.agentActivity;
		const cls = activity === 'working'
			? 'status-working'
			: activity === 'blocked' ? 'status-blocked' : '';

		if (cls === this.activityDotCls && (!cls || this.activityDotEl?.isConnected)) return;
		this.activityDotCls = cls;

		if (this.activityDotEl) {
			this.activityDotEl.remove();
			this.activityDotEl = null;
		}
		if (!cls) return;

		const tabHeaderEl = (this.leaf as LeafWithTabHeader).tabHeaderEl;
		if (!tabHeaderEl) return;

		this.activityDotEl = createSpan({
			cls: `claude-tab-activity-dot ${cls}`,
			attr: { 'aria-label': cls === 'status-blocked' ? 'Waiting for input' : 'Working' }
		});
		const innerTitle = tabHeaderEl.querySelector('.workspace-tab-header-inner-title');
		if (innerTitle?.parentElement) {
			innerTitle.parentElement.insertBefore(this.activityDotEl, innerTitle);
		} else {
			tabHeaderEl.appendChild(this.activityDotEl);
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
		// The new session will re-report its cwd via OSC 7; drop the stale value.
		this.liveCwd = null;

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
			showNewSessionOptionOnError: startMode === 'continue',
			cwd: this.launchCwd ?? undefined
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
			this.terminalContainer.setCssStyles({ backgroundColor: theme.background });
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
			showNewSessionOptionOnError: true,
			cwd: this.launchCwd ?? undefined
		});
	}

	private startSession(startMode: StartMode = 'new', options?: { parseOsc?: boolean; showNewSessionOptionOnError?: boolean; cwd?: string }): void {
		const { parseOsc = true, showNewSessionOptionOnError = false, cwd } = options || {};
		const launchConfig = this.tabLaunchConfig || this.plugin.sessionManager.getDefaultLaunchConfig();
		const canResume = this.plugin.sessionManager.isResumeSupportedForConfig(launchConfig);
		const strategy = this.plugin.sessionManager.getResumeStrategy(launchConfig);
		let effectiveStartMode: StartMode = startMode === 'continue' && !canResume ? 'new' : startMode;
		// Tier1 assign-id needs a key to resume by id; without one, start a fresh conversation.
		if (strategy === 'assign-id' && effectiveStartMode === 'continue' && !this.resumeKey) {
			effectiveStartMode = 'new';
		}

		if (startMode === 'continue' && effectiveStartMode === 'new') {
			new Notice('Resume is not configured for this CLI profile. Starting a new session.');
		}

		// A new launch gets a fresh per-tab id, persisted for restore. Used as Claude's
		// --session-id (assign-id strategy) and as the scrollback key (all profiles).
		if (effectiveStartMode === 'new') {
			this.resumeKey = crypto.randomUUID();
			// A fresh codex session will be captured post-launch; drop any restored id.
			this.codexSessionId = null;
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
							if (result.cwd) {
								// Phase 3: track the shell's live cwd so restore returns to it.
								this.liveCwd = result.cwd;
							}
						}
						this.terminal.write(data);
						this.scrollbackDirty = true;
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
				launchConfig,
				cwd,
				this.resumeKey ?? undefined,
				this.codexSessionId ?? undefined,
				(capturedCodexSessionId: string) => {
					this.codexSessionId = capturedCodexSessionId;
				}
			);

			this.plugin.sessionManager.updateSessionTerminal(this.sessionId, this.terminal, this.fitAddon);
			const session = this.plugin.sessionManager.getSession(this.sessionId);
			this.supportsResume = !!session?.supportsResume;
			this.tabLaunchConfig = session?.tabLaunchConfig || launchConfig;
			// Remember the resolved cwd (vault default when none was requested) so getState()
			// persists a concrete directory and in-place restarts reuse it.
			if (session?.launchCwd) {
				this.launchCwd = session.launchCwd;
			}
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
