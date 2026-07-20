import { spawn, ChildProcess } from 'child_process';
import { Writable } from 'stream';
import { StringDecoder } from 'string_decoder';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileSystemAdapter } from 'obsidian';
import type ClaudeCodeTabsPlugin from './main';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { CodexSessionCapture } from './CodexSessionCapture';
import { nextAgentActivity } from './AgentActivity';
import type { AgentActivityEvent } from './AgentActivity';
import type {
	Session,
	StartMode,
	TabLaunchConfig,
	CliProfile,
	ResumeStrategy
} from './types';
import { isSafeResumeKey } from './PersistedSessionState';
import { buildHookSettingsPayload } from './HookLogMaintenance';

export const SPECIAL_CLI_ID_DEFAULT_SHELL = '__default_shell__';

/** Phase 4: cap persisted scrollback to keep plugin-dir files small. */
const SCROLLBACK_MAX_CHARS = 400_000;
const DROPPED_SESSION_METADATA_TTL_MS = 5 * 60 * 1000;

export type SessionChangeCallback = () => void;

/**
 * POSIX shell single-quote a string so it survives being passed via `sh -c`.
 * Wraps in single quotes; any embedded single quotes are split out and escaped.
 */
function shellQuote(arg: string): string {
	if (arg === '') return "''";
	if (/^[A-Za-z0-9_\-.,:/=@%+]+$/.test(arg)) return arg;
	return "'" + arg.replace(/'/g, "'\\''") + "'";
}

export class SessionManager {
	private plugin: ClaudeCodeTabsPlugin;
	private sessions: Map<string, Session> = new Map();
	private lastActiveSessionId: string | null = null;
	private vaultPath: string;
	private pluginDir: string;
	private changeListeners: Set<SessionChangeCallback> = new Set();
	private codexCapture: CodexSessionCapture;
	private codexSessionClaims: Map<string, string> = new Map();
	private droppedSessionMetadata: Map<string, { codexSessionId: string; expiresAt: number }> = new Map();

	constructor(plugin: ClaudeCodeTabsPlugin) {
		this.plugin = plugin;
		const adapter = this.plugin.app.vault.adapter;
		this.vaultPath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
		this.pluginDir = this.resolvePluginDir();
		this.codexCapture = new CodexSessionCapture({
			debug: (message, error) => {
				if (this.isDebugEnabled()) console.debug(message, error);
			}
		});
		this.writeShellIntegration();
	}

	getPluginDir(): string {
		return this.pluginDir;
	}

	private shellIntegrationDir(): string {
		return path.join(this.pluginDir, 'shell-integration');
	}

	/**
	 * Phase 3 enabler: a self-contained ZDOTDIR whose rc files source the user's real zsh
	 * config (via $TAT_REAL_ZDOTDIR, falling back to $HOME so config always loads) and then add
	 * an OSC 7 precmd so the shell reports its live cwd. Activated by setting ZDOTDIR to this dir
	 * (see getSpawnEnv). Written idempotently on load; harmless when ZDOTDIR isn't pointed here.
	 */
	private writeShellIntegration(): void {
		try {
			const dir = this.shellIntegrationDir();
			fs.mkdirSync(dir, { recursive: true });
			// CRITICAL: source the user's real rc with ZDOTDIR pointed at THEIR dir, so frameworks
			// that read $ZDOTDIR (zimfw uses $ZDOTDIR/.zim, prezto, etc.) locate their data
			// correctly. Only point ZDOTDIR back here to load the *next* integration file.
			const real = '${TAT_REAL_ZDOTDIR:-$HOME}';
			const chain = (file: string) => [
				'_tat_mine="$ZDOTDIR"',
				`export ZDOTDIR="${real}"`,
				`[ -f "$ZDOTDIR/${file}" ] && source "$ZDOTDIR/${file}"`,
				// capture any ZDOTDIR the user's rc set, then return to the integration dir.
				'export TAT_REAL_ZDOTDIR="$ZDOTDIR"',
				'ZDOTDIR="$_tat_mine"',
				'unset _tat_mine',
				''
			].join('\n');
			fs.writeFileSync(path.join(dir, '.zshenv'), chain('.zshenv'), { mode: 0o600 });
			fs.writeFileSync(path.join(dir, '.zprofile'), chain('.zprofile'), { mode: 0o600 });
			const zshrc = [
				// .zshrc is the last interactive init file: keep ZDOTDIR at the real dir while
				// sourcing AND afterwards, so the user's framework + subshells + .zlogin use their
				// own config dir (and are never re-injected).
				`export ZDOTDIR="${real}"`,
				`[ -f "$ZDOTDIR/.zshrc" ] && source "$ZDOTDIR/.zshrc"`,
				'# Report the live working directory via OSC 7 for session persistence.',
				`_tat_osc7_cwd() { printf '\\033]7;file://%s%s\\007' "\${HOST}" "\${PWD}"; }`,
				'autoload -Uz add-zsh-hook 2>/dev/null && add-zsh-hook precmd _tat_osc7_cwd || precmd_functions+=(_tat_osc7_cwd)',
				''
			].join('\n');
			fs.writeFileSync(path.join(dir, '.zshrc'), zshrc, { mode: 0o600 });
		} catch (e) {
			console.debug('[TerminalAgentTabs] Failed to write shell integration:', e);
		}
	}

	private scrollbackDir(): string {
		return path.join(this.pluginDir, 'scrollback');
	}

	/** Phase 4: persist a tab's serialized terminal buffer (keyed by a stable per-tab id). Best-effort. */
	saveScrollback(key: string, content: string): void {
		if (!isSafeResumeKey(key) || !content) return;
		try {
			const dir = this.scrollbackDir();
			fs.mkdirSync(dir, { recursive: true });
			// Keep the tail when over the cap — the most recent screen matters most.
			const capped = content.length > SCROLLBACK_MAX_CHARS
				? content.slice(content.length - SCROLLBACK_MAX_CHARS)
				: content;
			fs.writeFileSync(path.join(dir, `${key}.txt`), capped, { mode: 0o600 });
		} catch (e) {
			console.debug('[TerminalAgentTabs] Failed to save scrollback:', e);
		}
	}

	/** Load a tab's persisted scrollback for repaint, or null if none. */
	loadScrollback(key: string): string | null {
		if (!isSafeResumeKey(key)) return null;
		try {
			const file = path.join(this.scrollbackDir(), `${key}.txt`);
			if (!fs.existsSync(file)) return null;
			return fs.readFileSync(file, 'utf8');
		} catch {
			return null;
		}
	}

	/**
	 * Prune scrollback files older than maxAgeMs (orphans from closed tabs). Recently
	 * saved files (e.g. from the last quit) keep a fresh mtime and survive for restore.
	 */
	pruneScrollback(maxAgeMs: number): void {
		try {
			const dir = this.scrollbackDir();
			if (!fs.existsSync(dir)) return;
			const now = Date.now();
			for (const name of fs.readdirSync(dir)) {
				if (!name.endsWith('.txt')) continue;
				const file = path.join(dir, name);
				try {
					if (now - fs.statSync(file).mtimeMs > maxAgeMs) fs.unlinkSync(file);
				} catch { /* ignore individual file errors */ }
			}
		} catch { /* ignore */ }
	}

	private getPtyHelperPath(): string {
		return path.join(this.pluginDir, 'resources', 'pty-helper.py');
	}

	private resolvePluginDir(): string {
		const configDir = this.plugin.app.vault.configDir;
		const candidates = [
			path.join(this.vaultPath, configDir, 'plugins', this.plugin.manifest.id),
			path.join(this.vaultPath, configDir, 'plugins', 'obsidian-claude-code-tabs')
		];

		for (const dir of candidates) {
			try {
				if (fs.existsSync(dir)) return dir;
			} catch {
				// ignore fs errors and try next candidate
			}
		}

		return candidates[0];
	}

	private buildPathEnv(envPath: string): string {
		const sep = process.platform === 'win32' ? ';' : ':';
		const existing = envPath.split(sep).filter(Boolean);
		const additional = process.platform === 'win32'
			? []
			: ['/opt/homebrew/bin', '/usr/local/bin'];
		const missing = additional.filter((p) => !existing.includes(p));
		return [...missing, ...existing].join(sep);
	}

	private getSpawnEnv(): NodeJS.ProcessEnv {
		const envPath = process.env.PATH || '';
		const env: NodeJS.ProcessEnv = {
			...process.env,
			PATH: this.buildPathEnv(envPath),
			TERM: 'xterm-256color',
			CLICOLOR: this.isDebugEnabled() ? '0' : process.env.CLICOLOR
		};
		// Phase 3: point zsh at the integration ZDOTDIR so it reports cwd via OSC 7.
		// Only for zsh (other shells ignore ZDOTDIR); the integration sources the user's
		// real config so this never breaks their shell, just adds cwd reporting.
		const shell = process.env.SHELL || '';
		if (this.plugin.settings.enableShellCwdTracking && shell.endsWith('zsh')) {
			env.TAT_REAL_ZDOTDIR = process.env.ZDOTDIR || os.homedir();
			env.ZDOTDIR = this.shellIntegrationDir();
		}
		return env;
	}

	/** Register a listener for session state changes. Returns an unsubscribe function. */
	onChange(callback: SessionChangeCallback): () => void {
		this.changeListeners.add(callback);
		return () => { this.changeListeners.delete(callback); };
	}

	private notifyChange(): void {
		for (const cb of this.changeListeners) {
			try { cb(); } catch { /* ignore listener errors */ }
		}
	}

	private dropSession(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (session?.codexSessionId) {
			this.droppedSessionMetadata.set(sessionId, {
				codexSessionId: session.codexSessionId,
				expiresAt: Date.now() + DROPPED_SESSION_METADATA_TTL_MS
			});
		}
		for (const [codexSessionId, ownerSessionId] of this.codexSessionClaims) {
			if (ownerSessionId === sessionId) this.codexSessionClaims.delete(codexSessionId);
		}
		this.sessions.delete(sessionId);
		if (this.lastActiveSessionId === sessionId) {
			this.lastActiveSessionId = null;
		}
	}

	private isDebugEnabled(): boolean {
		const envFlag = process.env.CLAUDE_TABS_DEBUG;
		const envEnabled = envFlag === '1' || envFlag === 'true';
		return !!(this.plugin.settings.enableDebugLogging || envEnabled);
	}

	private prepareDebugLog(sessionId: string): { logPath: string; stream: fs.WriteStream } | null {
		try {
			if (!this.isDebugEnabled()) return null;
			const debugDir = path.join(this.pluginDir, 'debug');
			fs.mkdirSync(debugDir, { recursive: true });
			const logPath = path.join(debugDir, `${sessionId}.log`);
			const stream = fs.createWriteStream(logPath, { flags: 'w', mode: 0o600 });
			return { logPath, stream };
		} catch (e) {
			console.debug('[TerminalAgentTabs] Failed to prepare debug log:', e);
			return null;
		}
	}

	private resolveLaunchConfig(launchConfig?: Partial<TabLaunchConfig>): TabLaunchConfig {
		const defaultCliId = this.plugin.settings.defaultCliId || this.plugin.settings.cliProfiles[0]?.id || 'claude';
		return {
			cliId: launchConfig?.cliId ?? defaultCliId,
			additionalArgs: launchConfig?.additionalArgs ?? []
		};
	}

	getDefaultLaunchConfig(): TabLaunchConfig {
		return this.resolveLaunchConfig();
	}

	getCliProfiles(): CliProfile[] {
		return [
			...this.plugin.settings.cliProfiles,
			{
				id: SPECIAL_CLI_ID_DEFAULT_SHELL,
				displayName: 'Default Shell',
				executablePath: process.env.SHELL || '/bin/sh',
				defaultArgs: [],
				supportsResume: false,
				resumeArgs: []
			}
		];
	}

	getCliDisplayName(cliId: string): string {
		const profile = this.getCliProfiles().find((item) => item.id === cliId);
		return profile?.displayName || cliId;
	}

	private resolveCliProfile(cliId: string): CliProfile {
		const profile = this.getCliProfiles().find((item) => item.id === cliId);
		if (profile) return profile;
		const fallback = this.plugin.settings.cliProfiles[0];
		if (fallback) return fallback;
		throw new Error('No CLI profile is configured. Add one in plugin settings.');
	}

	/**
	 * Resolve a profile's Tier1 resume strategy. Explicit `resumeStrategy` wins;
	 * otherwise infer from the executable so existing claude/codex profiles work
	 * without reconfiguration. Everything else → 'none'.
	 */
	private resolveResumeStrategy(profile: CliProfile): ResumeStrategy {
		if (profile.resumeStrategy) return profile.resumeStrategy;
		const exe = profile.executablePath.toLowerCase();
		if (exe === 'claude' || exe.endsWith('/claude') || profile.id === 'claude') return 'assign-id';
		if (exe === 'codex' || exe.endsWith('/codex') || profile.id === 'codex') return 'continue-latest';
		return 'none';
	}

	getResumeStrategy(launchConfig: TabLaunchConfig): ResumeStrategy {
		return this.resolveResumeStrategy(this.resolveCliProfile(launchConfig.cliId));
	}

	/**
	 * Whether a Claude transcript exists for (cwd, sessionId), used to decide if an
	 * `assign-id` tab can be resumed. Read-only check against ~/.claude/projects.
	 * Claude encodes the cwd by realpath-ing it and replacing '/' and '.' with '-'.
	 */
	claudeTranscriptExists(cwd: string, sessionId: string): boolean {
		if (!cwd || !sessionId) return false;
		try {
			let real = cwd;
			try { real = fs.realpathSync(cwd); } catch { /* fall back to the raw path */ }
			const encoded = real.replace(/[/.]/g, '-');
			const transcript = path.join(os.homedir(), '.claude', 'projects', encoded, `${sessionId}.jsonl`);
			return fs.existsSync(transcript);
		} catch {
			return false;
		}
	}

	/**
	 * Tier1 (Codex) B3 fix. Codex picks its own session id, so after launching a codex tab we
	 * watch ~/.codex/sessions for the rollout this spawn created (cwd match, created at/after
	 * the spawn time) and record its id on the session. getState() then persists it so restore
	 * can `codex resume <id>` instead of `--last`. Best-effort: any failure leaves the prior id
	 * intact and restore falls back to `--last` (no regression). Re-runs on resume too, so a
	 * fork-on-resume id is picked up; an append-on-resume keeps the existing id.
	 */
	private async captureCodexSessionId(
		session: Session,
		cwd: string,
		sinceMs: number,
		baselineIds: ReadonlySet<string>,
		onCaptured?: (codexSessionId: string) => void
	): Promise<void> {
		const realCwd = this.codexCapture.resolveRealCwd(cwd);
		const deadlineMs = Date.now() + 15000;
		while (Date.now() < deadlineMs) {
			// Stop if the tab/session went away (closed before the rollout appeared).
			if (this.sessions.get(session.sessionId) !== session) return;
			const id = this.codexCapture.findNewRolloutId(
				realCwd,
				sinceMs,
				baselineIds,
				this.getClaimedCodexSessionIds(session.sessionId)
			);
			if (id) {
				if (id !== session.codexSessionId) {
					if (session.codexSessionId) this.codexSessionClaims.delete(session.codexSessionId);
					session.codexSessionId = id;
					this.codexSessionClaims.set(id, session.sessionId);
					onCaptured?.(id);
					try { this.plugin.app.workspace.requestSaveLayout(); } catch { /* ignore */ }
					this.notifyChange();
				}
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}

	private getClaimedCodexSessionIds(currentSessionId: string): Set<string> {
		this.pruneDroppedSessionMetadata();
		const ids = new Set<string>();
		for (const session of this.sessions.values()) {
			if (session.sessionId !== currentSessionId && session.codexSessionId) {
				ids.add(session.codexSessionId);
			}
		}
		for (const [codexSessionId, ownerSessionId] of this.codexSessionClaims) {
			if (ownerSessionId !== currentSessionId) ids.add(codexSessionId);
		}
		for (const [sessionId, metadata] of this.droppedSessionMetadata) {
			if (sessionId !== currentSessionId) ids.add(metadata.codexSessionId);
		}
		return ids;
	}

	private pruneDroppedSessionMetadata(): void {
		const now = Date.now();
		for (const [sessionId, metadata] of this.droppedSessionMetadata) {
			if (metadata.expiresAt <= now) this.droppedSessionMetadata.delete(sessionId);
		}
	}

	private buildLaunchCommand(profile: CliProfile, startMode: StartMode, additionalArgs: string[], resumeKey?: string, codexSessionId?: string) {
		const strategy = this.resolveResumeStrategy(profile);
		const legacyCanResume = profile.supportsResume && profile.resumeArgs.length > 0;
		const canResume = strategy === 'assign-id' || strategy === 'continue-latest' || legacyCanResume;

		const hookArgs = this.buildHookArgs(profile);
		const base = [...hookArgs, ...profile.defaultArgs];

		let coreArgs: string[];
		if (strategy === 'assign-id' && resumeKey) {
			// Tier1 (Claude): deterministic per-tab id — assign on new, resume by id on restore.
			coreArgs = startMode === 'continue'
				? [...base, '--resume', resumeKey]
				: [...base, '--session-id', resumeKey];
		} else if (strategy === 'continue-latest' && startMode === 'continue') {
			// Tier1 (Codex): resume this tab's exact prior session by id when we captured one,
			// so two codex tabs in the same cwd don't both grab `--last` (which would collapse
			// them onto the same most-recent session). Fall back to `--last` when no id is known.
			// Global/default args must precede the `resume` subcommand (hookArgs is empty for codex).
			coreArgs = codexSessionId
				? [...base, 'resume', codexSessionId]
				: [...base, 'resume', '--last'];
		} else if (startMode === 'continue' && legacyCanResume) {
			// Legacy interactive resume (e.g. picker) for profiles without a Tier1 strategy.
			coreArgs = [...base, ...profile.resumeArgs];
		} else {
			coreArgs = [...base];
		}

		const args = [...coreArgs, ...additionalArgs];

		// GUI-launched Obsidian inherits launchd's minimal PATH and never loads
		// the user's shell rc files (.zprofile/.zshrc/.bashrc). When the user
		// configures a relative executable name (the default for `claude`),
		// resolving it requires the same PATH their interactive terminal sees.
		// Wrap the launch in a login + interactive shell so binaries installed
		// via brew, nvm, asdf, mise, npm-global, cmux, etc. are reachable.
		// This is what VSCode / iTerm integrated terminals do.
		if (!path.isAbsolute(profile.executablePath)) {
			const userShell = process.env.SHELL || '/bin/zsh';
			const quoted = [profile.executablePath, ...args].map(shellQuote).join(' ');
			return {
				executablePath: userShell,
				args: ['-l', '-i', '-c', `exec ${quoted}`],
				supportsResume: canResume
			};
		}

		return {
			executablePath: profile.executablePath,
			args,
			supportsResume: canResume
		};
	}

	/**
	 * Check if a CLI profile supports Claude Code's --settings hook injection.
	 * Returns true for profiles whose executable looks like Claude Code.
	 */
	private supportsClaudeHooks(profile: CliProfile): boolean {
		const exe = profile.executablePath.toLowerCase();
		return exe === 'claude' || exe.endsWith('/claude') || profile.id === 'claude';
	}

	/**
	 * Build --settings args to auto-inject hooks for Claude Code profiles.
	 * This enables notifications without manual hook configuration.
	 */
	private buildHookArgs(profile: CliProfile): string[] {
		if (!this.supportsClaudeHooks(profile)) return [];

		const eventsFilePath = this.plugin.getEffectiveHookEventsFilePath();
		const relayPath = path.join(this.pluginDir, 'resources', 'hook-relay.py');

		try {
			if (!fs.existsSync(relayPath)) return [];
		} catch {
			return [];
		}

		const makeCmd = (hookType: string) =>
			`python3 "${relayPath}" ${hookType} "${eventsFilePath}"`;

		const { hookLogNotificationEnabled, hookLogStopEnabled, hookLogPreToolUseEnabled } = this.plugin.settings;
		const payload = buildHookSettingsPayload(
			{
				notification: hookLogNotificationEnabled,
				stop: hookLogStopEnabled,
				preToolUse: hookLogPreToolUseEnabled
			},
			makeCmd
		);
		if (!payload) return [];

		return ['--settings', JSON.stringify(payload)];
	}

	isResumeSupportedForConfig(launchConfig: TabLaunchConfig): boolean {
		const profile = this.resolveCliProfile(launchConfig.cliId);
		const strategy = this.resolveResumeStrategy(profile);
		if (strategy === 'assign-id' || strategy === 'continue-latest') return true;
		return profile.supportsResume && profile.resumeArgs.length > 0;
	}

	createSession(
		sessionId: string,
		onData: (data: string) => void,
		onExit: (exitCode: number) => void,
		startMode: StartMode = 'new',
		launchConfig?: Partial<TabLaunchConfig>,
		cwd?: string,
		resumeKey?: string,
		codexSessionId?: string,
		onCodexSessionIdCaptured?: (codexSessionId: string) => void
	): Session {
		const resolvedLaunchConfig = this.resolveLaunchConfig(launchConfig);
		// Phase 1 (Tier0): launch in the persisted/requested cwd, defaulting to the vault.
		// Graceful: if the persisted cwd no longer exists, fall back to the vault so spawn
		// can't throw on a stale/deleted directory.
		const requestedCwd = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : this.vaultPath;
		let launchCwd = requestedCwd;
		try {
			if (!fs.existsSync(requestedCwd)) launchCwd = this.vaultPath;
		} catch {
			launchCwd = this.vaultPath;
		}
		const profile = this.resolveCliProfile(resolvedLaunchConfig.cliId);
		const captureCodexSession = this.resolveResumeStrategy(profile) === 'continue-latest';
		const codexCaptureStartMs = Date.now();
		const codexBaselineIds = captureCodexSession
			? this.codexCapture.snapshotRolloutIds(
				this.codexCapture.resolveRealCwd(launchCwd),
				codexCaptureStartMs - 2000
			)
			: new Set<string>();
		const launchCommand = this.buildLaunchCommand(
			profile,
			startMode,
			resolvedLaunchConfig.additionalArgs,
			resumeKey,
			codexSessionId
		);

		const commandPath = launchCommand.executablePath;
		const commandArgs = launchCommand.args;

		const helperPath = this.getPtyHelperPath();
		const debugTarget = this.prepareDebugLog(sessionId);

		let childProcess: ChildProcess;
		let winsizePipe: Writable | null = null;
		const stdoutDecoder = new StringDecoder('utf8');
		const stderrDecoder = new StringDecoder('utf8');
		const defaultHeader = `${profile.displayName} Session`;

		try {
			childProcess = spawn('python3', [helperPath, commandPath, ...commandArgs], {
				cwd: launchCwd,
				stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
				env: this.getSpawnEnv()
			});

			if (childProcess.stdio && childProcess.stdio[3]) {
				winsizePipe = childProcess.stdio[3] as Writable;
			}
		} catch (error: unknown) {
			const session: Session = {
				sessionId,
				process: null,
				winsizePipe: null,
				terminal: null,
				fitAddon: null,
				fontSize: this.plugin.settings.defaultFontSize,
				headerText: defaultHeader,
				status: 'error',
				agentActivity: 'unknown',
				agentActivityChangedAt: null,
				exitCode: null,
				createdAt: new Date(),
				cliId: profile.id,
				supportsResume: launchCommand.supportsResume,
				launchCwd,
				resumeKey,
				tabLaunchConfig: resolvedLaunchConfig
			};
			this.sessions.set(sessionId, session);
			throw new Error(`Failed to spawn ${profile.displayName}: ${error instanceof Error ? error.message : String(error)}`);
		}

		const session: Session = {
			sessionId,
			process: childProcess,
			winsizePipe,
			terminal: null,
			fitAddon: null,
			fontSize: this.plugin.settings.defaultFontSize,
			headerText: defaultHeader,
			status: 'running',
			agentActivity: 'unknown',
			agentActivityChangedAt: null,
			exitCode: null,
			createdAt: new Date(),
			cliId: profile.id,
			supportsResume: launchCommand.supportsResume,
			launchCwd,
			// Seed with the restored id (if any); the post-launch capture below refreshes it.
			codexSessionId,
			resumeKey,
			tabLaunchConfig: resolvedLaunchConfig,
			debugLogPath: debugTarget?.logPath,
			debugStream: debugTarget?.stream ?? null
		};

		this.sessions.set(sessionId, session);
		this.lastActiveSessionId = sessionId;
		this.notifyChange();

		// Tier1 (Codex) B3 fix: codex assigns its own session id, so capture the id this spawn
		// just created and store it on the session for restore-by-id. Best-effort, async.
		if (captureCodexSession) {
			void this.captureCodexSessionId(
				session,
				launchCwd,
				codexCaptureStartMs,
				codexBaselineIds,
				onCodexSessionIdCaptured
			).catch((error) => {
				if (this.isDebugEnabled()) {
					console.debug('[TerminalAgentTabs] Codex session id capture failed:', error);
				}
			});
		}

		if (childProcess.stdout) {
			childProcess.stdout.on('data', (data: Buffer) => {
				const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
				if (session.debugStream) {
					session.debugStream.write(`\n[${new Date().toISOString()}] STDOUT ${chunk.length} bytes\n`);
					session.debugStream.write(chunk);
					session.debugStream.write('\n');
				}
				const decoded = stdoutDecoder.write(chunk);
				if (decoded) onData(decoded);
			});
		}

		if (childProcess.stderr) {
			childProcess.stderr.on('data', (data: Buffer) => {
				const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
				if (session.debugStream) {
					session.debugStream.write(`\n[${new Date().toISOString()}] STDERR ${chunk.length} bytes\n`);
					session.debugStream.write(chunk);
					session.debugStream.write('\n');
				}
				const decoded = stderrDecoder.write(chunk);
				if (decoded) onData(decoded);
			});
		}

		childProcess.on('exit', (code: number | null) => {
			session.status = 'exited';
			session.agentActivity = 'unknown';
			session.exitCode = code ?? 0;
			if (session.debugStream) {
				try {
					session.debugStream.write(`\n[${new Date().toISOString()}] EXIT code=${session.exitCode}\n`);
					session.debugStream.end();
				} catch {
					// ignore
				}
			}
			this.dropSession(sessionId);
			this.notifyChange();
			onExit(code ?? 0);
		});

		childProcess.on('error', (error: Error) => {
			session.status = 'error';
			session.agentActivity = 'unknown';
			session.exitCode = 1;
			if (session.debugStream) {
				try {
					session.debugStream.write(`\n[${new Date().toISOString()}] ERROR ${error.message}\n`);
					session.debugStream.end();
				} catch {
					// ignore
				}
			}
			this.dropSession(sessionId);
			this.notifyChange();
			onData(`\r\nError: ${error.message}\r\n`);
			onExit(1);
		});

		if (childProcess.stdin) {
			childProcess.stdin.on('close', () => {
				if (session.status === 'running') {
					session.status = 'exited';
					// This path keeps the session in the map (no dropSession),
					// so a stale working/blocked would otherwise survive exit.
					session.agentActivity = 'unknown';
					onExit(0);
				}
			});
		}

		return session;
	}

	async terminateSession(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session?.process) {
			this.dropSession(sessionId);
			return;
		}

		if (session.debugStream) {
			try {
				session.debugStream.end();
			} catch {
				// ignore
			}
		}

		return new Promise<void>((resolve) => {
			const proc = session.process!;

			const killTimeout = setTimeout(() => {
				try {
					proc.kill('SIGKILL');
				} catch {
					// Process may already be dead
				}
				this.dropSession(sessionId);
				resolve();
			}, 5000);

			proc.on('exit', () => {
				clearTimeout(killTimeout);
				this.dropSession(sessionId);
				resolve();
			});

			try {
				proc.kill('SIGTERM');
			} catch {
				clearTimeout(killTimeout);
				this.dropSession(sessionId);
				resolve();
			}
		});
	}

	async terminateAllSessions(): Promise<void> {
		const promises = Array.from(this.sessions.values()).map((session) =>
			this.terminateSession(session.sessionId)
		);
		await Promise.all(promises);
	}

	getSession(sessionId: string): Session | undefined {
		return this.sessions.get(sessionId);
	}

	getRetainedCodexSessionId(sessionId: string): string | undefined {
		this.pruneDroppedSessionMetadata();
		return this.droppedSessionMetadata.get(sessionId)?.codexSessionId;
	}

	getAllSessions(): Session[] {
		return Array.from(this.sessions.values());
	}

	getLastActiveSessionId(): string | null {
		return this.lastActiveSessionId;
	}

	getActiveSession(): Session | undefined {
		if (!this.lastActiveSessionId) return undefined;
		const session = this.sessions.get(this.lastActiveSessionId);
		if (!session) return undefined;
		const isRunning = session.status === 'running' && !!session.process && !session.process.killed;
		return isRunning ? session : undefined;
	}

	/**
	 * Resolve the plugin-side session id for an agent-reported session id
	 * (Claude Code's session_id from a hook payload). Deterministic because
	 * assign-id launches pass the tab's resumeKey as --session-id. Returns
	 * null when no live session matches (e.g. a --resume launch forked to a
	 * new agent session id, or the hook came from a session TAT doesn't own).
	 */
	findSessionIdByAgentSessionId(agentSessionId: string): string | null {
		if (!agentSessionId) return null;
		for (const session of this.sessions.values()) {
			if (session.resumeKey === agentSessionId) {
				return session.sessionId;
			}
		}
		return null;
	}

	/**
	 * Resolve the best session ID to associate with a notification.
	 * If only one running session exists, use it. Otherwise use the last active.
	 */
	resolveNotificationSessionId(): string {
		const running = Array.from(this.sessions.values()).filter(
			(s) => s.status === 'running' && !!s.process && !s.process.killed
		);
		if (running.length === 1) {
			return running[0].sessionId;
		}
		if (this.lastActiveSessionId && this.sessions.has(this.lastActiveSessionId)) {
			return this.lastActiveSessionId;
		}
		if (running.length > 0) {
			return running[0].sessionId;
		}
		return '';
	}

	setActiveSession(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (session && session.status === 'running') {
			this.lastActiveSessionId = sessionId;
		}
	}

	resizeSession(sessionId: string, cols: number, rows: number): void {
		const session = this.sessions.get(sessionId);
		if (session?.winsizePipe) {
			const buffer = Buffer.alloc(8);
			buffer.writeUInt16LE(rows, 0);
			buffer.writeUInt16LE(cols, 2);
			buffer.writeUInt16LE(0, 4);
			buffer.writeUInt16LE(0, 6);
			try {
				session.winsizePipe.write(buffer);
			} catch {
				// Pipe may be closed
			}
		}
	}

	writeToSession(sessionId: string, data: string): void {
		const session = this.sessions.get(sessionId);
		if (session?.process?.stdin) {
			try {
				session.process.stdin.write(data);
			} catch {
				// stdin may be closed
			}
		}
	}

	updateSessionTerminal(sessionId: string, terminal: Terminal | null, fitAddon: FitAddon | null): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.terminal = terminal;
			session.fitAddon = fitAddon;
		}
	}

	/**
	 * Apply an observed activity event (OSC title prefix or hook) through the
	 * transition rules in AgentActivity.ts. No-ops when the state does not
	 * change: while working, the spinner retitles at high frequency and must
	 * not trigger a sidebar re-render per frame.
	 */
	updateSessionActivity(sessionId: string, event: AgentActivityEvent): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		const next = nextAgentActivity(session.agentActivity, event);
		if (session.agentActivity !== next) {
			session.agentActivity = next;
			session.agentActivityChangedAt = new Date();
			this.notifyChange();
		}
	}

	updateSessionHeader(sessionId: string, headerText: string): void {
		const session = this.sessions.get(sessionId);
		if (session && session.headerText !== headerText) {
			session.headerText = headerText;
			this.notifyChange();
		}
	}

	private lastOutputNotifyTimer: ReturnType<typeof setTimeout> | null = null;

	updateSessionLastOutput(sessionId: string, line: string): void {
		const session = this.sessions.get(sessionId);
		if (session && session.lastOutputLine !== line) {
			session.lastOutputLine = line;
			// Throttle notifyChange for last-output updates to avoid sidebar flicker
			if (!this.lastOutputNotifyTimer) {
				this.lastOutputNotifyTimer = setTimeout(() => {
					this.lastOutputNotifyTimer = null;
					this.notifyChange();
				}, 500);
			}
		}
	}

	updateSessionFontSize(sessionId: string, fontSize: number): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.fontSize = fontSize;
		}
	}
}
