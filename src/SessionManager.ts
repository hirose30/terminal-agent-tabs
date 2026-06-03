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
import type {
	Session,
	StartMode,
	TabLaunchConfig,
	CliProfile,
	ResumeStrategy
} from './types';

export const SPECIAL_CLI_ID_DEFAULT_SHELL = '__default_shell__';

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

	constructor(plugin: ClaudeCodeTabsPlugin) {
		this.plugin = plugin;
		const adapter = this.plugin.app.vault.adapter;
		this.vaultPath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
		this.pluginDir = this.resolvePluginDir();
	}

	getPluginDir(): string {
		return this.pluginDir;
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
		return {
			...process.env,
			PATH: this.buildPathEnv(envPath),
			TERM: 'xterm-256color',
			CLICOLOR: this.isDebugEnabled() ? '0' : process.env.CLICOLOR
		};
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

	private buildLaunchCommand(profile: CliProfile, startMode: StartMode, additionalArgs: string[], resumeKey?: string) {
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
			// Tier1 (Codex): resume the most recent session scoped to the cwd. Subcommand goes first.
			coreArgs = ['resume', '--last', ...base];
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

		const settings = {
			hooks: {
				Notification: [{
					matcher: '',
					hooks: [{ type: 'command', command: makeCmd('notification'), timeout: 10 }]
				}],
				Stop: [{
					matcher: '',
					hooks: [{ type: 'command', command: makeCmd('stop'), timeout: 10 }]
				}],
				PreToolUse: [{
					matcher: '',
					hooks: [{ type: 'command', command: makeCmd('pre-tool-use'), timeout: 5 }]
				}]
			}
		};

		return ['--settings', JSON.stringify(settings)];
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
		resumeKey?: string
	): Session {
		const resolvedLaunchConfig = this.resolveLaunchConfig(launchConfig);
		// Phase 1 (Tier0): launch in the persisted/requested cwd, defaulting to the vault.
		const launchCwd = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : this.vaultPath;
		const profile = this.resolveCliProfile(resolvedLaunchConfig.cliId);
		const launchCommand = this.buildLaunchCommand(
			profile,
			startMode,
			resolvedLaunchConfig.additionalArgs,
			resumeKey
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
				exitCode: null,
				createdAt: new Date(),
				cliId: profile.id,
				supportsResume: launchCommand.supportsResume,
				launchCwd,
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
			exitCode: null,
			createdAt: new Date(),
			cliId: profile.id,
			supportsResume: launchCommand.supportsResume,
			launchCwd,
			tabLaunchConfig: resolvedLaunchConfig,
			debugLogPath: debugTarget?.logPath,
			debugStream: debugTarget?.stream ?? null
		};

		this.sessions.set(sessionId, session);
		this.lastActiveSessionId = sessionId;
		this.notifyChange();

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
