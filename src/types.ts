import type { ChildProcess } from 'child_process';
import type { Writable } from 'stream';
import type { WriteStream } from 'fs';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

export type SessionStatus = 'running' | 'exited' | 'error';

export type StartMode = 'new' | 'continue';

/**
 * Tier1 logical-resume strategy for a CLI profile (Phase 2).
 * - 'assign-id': assign a deterministic --session-id on launch, resume it by id (Claude).
 * - 'continue-latest': resume the most recent session scoped to the cwd (Codex).
 * - 'none': no automatic resume (plain shells / unknown CLIs).
 * Optional + inferred from the executable when unset, so existing profiles keep working.
 */
export type ResumeStrategy = 'assign-id' | 'continue-latest' | 'none';

export interface CliProfile {
	id: string;
	displayName: string;
	executablePath: string;
	defaultArgs: string[];
	supportsResume: boolean;
	resumeArgs: string[];
	resumeStrategy?: ResumeStrategy;
}

export interface TabLaunchConfig {
	cliId: string;
	additionalArgs: string[];
}

export interface Session {
	sessionId: string;
	process: ChildProcess | null;
	winsizePipe: Writable | null;
	terminal: Terminal | null;
	fitAddon: FitAddon | null;
	fontSize: number;
	headerText: string;
	status: SessionStatus;
	exitCode: number | null;
	createdAt: Date;
	cliId: string;
	supportsResume: boolean;
	/** Working directory the session was spawned in (Phase 1: persisted for cwd restore). */
	launchCwd: string;
	/** Tier1 (Codex) captured session id for this live session; persisted for `codex resume <id>`. */
	codexSessionId?: string;
	tabLaunchConfig?: TabLaunchConfig;
	lastOutputLine?: string;
	debugLogPath?: string;
	debugStream?: WriteStream | null;
}

export interface ClaudeCodeTabsSettings {
	defaultFontSize: number;
	terminalFontFamily: string;
	terminalCustomGlyphs: boolean;
	enableOsc52ClipboardSync: boolean;
	/** Inject OSC 7 cwd reporting into spawned zsh shells so restore tracks the live directory. */
	enableShellCwdTracking: boolean;
	enableHookNotifications: boolean;
	enableHookNotificationSound: boolean;
	hookEventsFilePath: string;
	hookEventsPollIntervalMs: number;
	/** Inject the Notification hook (permission/idle prompts) into launched Claude Code sessions. */
	hookLogNotificationEnabled: boolean;
	/** Inject the Stop hook (turn completion) into launched Claude Code sessions. */
	hookLogStopEnabled: boolean;
	/** Inject the PreToolUse hook. High-frequency; off by default to limit log growth. */
	hookLogPreToolUseEnabled: boolean;
	/** Rotate agent-events.jsonl once it reaches this size. */
	hookLogMaxSizeMb: number;
	/** Rotated generations to retain (agent-events.jsonl.1 .. .N) before the oldest is deleted. */
	hookLogMaxGenerations: number;
	wrapSelectionInCodeBlock: boolean;
	includeNotePathInSelectionSend: boolean;
	enableDebugLogging: boolean;
	defaultCliId: string;
	terminalThemeName: string;
	cliProfiles: CliProfile[];
}

export type NotificationType = 'action_needed' | 'needs_input' | 'task_complete' | 'agent_event';

export interface AgentNotification {
	id: string;
	sessionId: string;
	type: NotificationType;
	title: string;
	body: string;
	source: string;
	timestamp: Date;
}

export const DEFAULT_TERMINAL_FONT_FAMILY = 'Menlo, Monaco, "Courier New", monospace';

export const DEFAULT_SETTINGS: ClaudeCodeTabsSettings = {
	defaultFontSize: 14,
	terminalFontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
	terminalCustomGlyphs: true,
	enableOsc52ClipboardSync: true,
	enableShellCwdTracking: true,
	enableHookNotifications: false,
	enableHookNotificationSound: false,
	hookEventsFilePath: '',
	hookEventsPollIntervalMs: 1500,
	hookLogNotificationEnabled: true,
	hookLogStopEnabled: true,
	hookLogPreToolUseEnabled: false,
	hookLogMaxSizeMb: 5,
	hookLogMaxGenerations: 2,
	wrapSelectionInCodeBlock: false,
	includeNotePathInSelectionSend: false,
	enableDebugLogging: false,
	defaultCliId: 'claude',
	terminalThemeName: '',
	cliProfiles: [
		{
			id: 'claude',
			displayName: 'Claude',
			executablePath: 'claude',
			defaultArgs: [],
			supportsResume: true,
			resumeArgs: ['--resume']
		}
	]
};
