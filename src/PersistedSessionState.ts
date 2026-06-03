/**
 * Per-tab session metadata persisted into Obsidian's workspace.json via the
 * view's getState()/setState().
 *
 * Phase 1 (Tier0) stores the launch working directory so a tab can be relaunched
 * in the same directory after an Obsidian restart. The shape is intentionally
 * forward-compatible: anything missing, malformed, or from an unsupported version
 * parses to `null`, letting callers fall back to default behavior (a new session
 * in the vault directory) without throwing — i.e. graceful degradation.
 *
 * This module is pure (no Obsidian API) so it can be unit-tested directly.
 */

import type { TabLaunchConfig } from './types';

export const PERSISTED_SESSION_STATE_VERSION = 1;

/**
 * A resumeKey is used both as a CLI session id and as a scrollback filename, so it must be a
 * strict filename-safe token (our generated values are UUIDs). Rejects path-traversal / unsafe text.
 */
export function isSafeResumeKey(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export interface PersistedSessionState {
	v: typeof PERSISTED_SESSION_STATE_VERSION;
	cliId: string;
	cwd: string;
	additionalArgs: string[];
	/** Tier1 resume key (e.g. Claude's --session-id uuid). Absent for strategies that don't need one. */
	resumeKey?: string;
}

/** Build a serializable persisted-state object from the live launch config + cwd. */
export function buildPersistedSessionState(
	launchConfig: Pick<TabLaunchConfig, 'cliId' | 'additionalArgs'>,
	cwd: string,
	resumeKey?: string
): PersistedSessionState {
	const state: PersistedSessionState = {
		v: PERSISTED_SESSION_STATE_VERSION,
		cliId: launchConfig.cliId,
		cwd,
		additionalArgs: Array.isArray(launchConfig.additionalArgs)
			? launchConfig.additionalArgs.filter((a): a is string => typeof a === 'string')
			: []
	};
	const trimmedKey = resumeKey?.trim();
	if (isSafeResumeKey(trimmedKey)) {
		state.resumeKey = trimmedKey;
	}
	return state;
}

/**
 * Parse a raw persisted-state blob (from workspace.json) into a validated
 * PersistedSessionState, or `null` when it is absent / malformed / an unsupported
 * version / missing required fields. Never throws.
 */
export function parsePersistedSessionState(raw: unknown): PersistedSessionState | null {
	if (!raw || typeof raw !== 'object') return null;
	const obj = raw as Record<string, unknown>;

	// Only the current version is understood. Older/newer/garbage → graceful null.
	if (obj.v !== PERSISTED_SESSION_STATE_VERSION) return null;

	const cwd = typeof obj.cwd === 'string' ? obj.cwd.trim() : '';
	if (!cwd) return null;

	const cliId = typeof obj.cliId === 'string' ? obj.cliId.trim() : '';
	if (!cliId) return null;

	const additionalArgs = Array.isArray(obj.additionalArgs)
		? obj.additionalArgs.filter((a): a is string => typeof a === 'string')
		: [];

	const result: PersistedSessionState = { v: PERSISTED_SESSION_STATE_VERSION, cliId, cwd, additionalArgs };
	const rk = typeof obj.resumeKey === 'string' ? obj.resumeKey.trim() : '';
	if (isSafeResumeKey(rk)) {
		result.resumeKey = rk;
	}
	return result;
}
