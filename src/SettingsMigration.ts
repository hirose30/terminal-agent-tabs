/**
 * Settings migration logic for legacy data formats.
 * Handles conversion from old settings shapes (pre-v0.3) to current CliProfile format.
 */

import type { CliProfile, ResumeStrategy } from './types';
import { normalizeCliId } from './utils';

export interface LegacySettingsShape {
	claudeExecutablePath?: string;
	cliProfiles?: unknown;
	defaultCliKind?: string;
	defaultCliId?: string;
	defaultFontSize?: number;
	terminalFontFamily?: string;
	terminalCustomGlyphs?: boolean;
	enableOsc52ClipboardSync?: boolean;
	enableShellCwdTracking?: boolean;
	enableHookNotifications?: boolean;
	enableHookNotificationSound?: boolean;
	hookEventsFilePath?: string;
	hookEventsPollIntervalMs?: number;
	hookLogNotificationEnabled?: boolean;
	hookLogStopEnabled?: boolean;
	hookLogPreToolUseEnabled?: boolean;
	hookLogMaxSizeMb?: number;
	hookLogMaxGenerations?: number;
	wrapSelectionInCodeBlock?: boolean;
	includeNotePathInSelectionSend?: boolean;
	enableDebugLogging?: boolean;
	terminalThemeName?: string;
	/** Raw persisted density; legacy 'detailed' is migrated in loadSettings. */
	sessionListDensity?: string;
}

function dedupeProfiles(profiles: CliProfile[]): CliProfile[] {
	const deduped = new Map<string, CliProfile>();
	for (const profile of profiles) {
		if (!deduped.has(profile.id)) {
			deduped.set(profile.id, profile);
		}
	}
	return Array.from(deduped.values());
}

function ensureClaudeProfile(profiles: CliProfile[], legacyClaudePath?: string): CliProfile[] {
	const baseProfiles = dedupeProfiles(profiles);
	const normalizedLegacyClaudePath = legacyClaudePath?.trim();
	const hasClaude = baseProfiles.some((profile) => profile.id === 'claude');
	if (hasClaude) {
		return baseProfiles;
	}
	return [
		{
			id: 'claude',
			displayName: 'Claude',
			executablePath: normalizedLegacyClaudePath || 'claude',
			defaultArgs: [],
			supportsResume: true,
			resumeArgs: ['--resume']
		},
		...baseProfiles
	];
}

function parseStringArray(arr: unknown): string[] {
	if (!Array.isArray(arr)) return [];
	return arr.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
}

/** Preserve an explicit, valid resumeStrategy across migration (optional/backward-compatible). */
function parseResumeStrategy(value: unknown): ResumeStrategy | undefined {
	return value === 'assign-id' || value === 'continue-latest' || value === 'none' ? value : undefined;
}

function migrateFromArray(raw: unknown[], loaded: LegacySettingsShape): CliProfile[] | null {
	const normalized = raw
		.map((entry, index): CliProfile | null => {
			if (!entry || typeof entry !== 'object') return null;
			const obj = entry as Record<string, unknown>;
			const displayName = typeof obj.displayName === 'string' ? obj.displayName.trim() : '';
			const baseId =
				typeof obj.id === 'string' && obj.id.trim()
					? obj.id
					: displayName || `cli-${index + 1}`;
			const id = normalizeCliId(baseId);
			const executablePath =
				typeof obj.executablePath === 'string' && obj.executablePath.trim()
					? obj.executablePath.trim()
					: id;
			const resumeStrategy = parseResumeStrategy(obj.resumeStrategy);
			return {
				id,
				displayName: displayName || id,
				executablePath,
				defaultArgs: parseStringArray(obj.defaultArgs),
				supportsResume: Boolean(obj.supportsResume),
				resumeArgs: parseStringArray(obj.resumeArgs),
				...(resumeStrategy ? { resumeStrategy } : {})
			};
		})
		.filter((v): v is CliProfile => !!v);

	const deduped = new Map<string, CliProfile>();
	for (const profile of normalized) {
		let candidateId = profile.id;
		let suffix = 2;
		while (deduped.has(candidateId)) {
			candidateId = `${profile.id}-${suffix}`;
			suffix += 1;
		}
		deduped.set(candidateId, { ...profile, id: candidateId });
	}

	if (deduped.size > 0) {
		return ensureClaudeProfile(Array.from(deduped.values()), loaded.claudeExecutablePath);
	}
	return null;
}

function migrateFromObject(raw: Record<string, unknown>, loaded: LegacySettingsShape): CliProfile[] | null {
	const converted: CliProfile[] = [];
	for (const [key, value] of Object.entries(raw)) {
		if (!value || typeof value !== 'object') continue;
		const profile = value as Record<string, unknown>;
		const normalizedKey = normalizeCliId(key);
		const rawExecutablePath =
			typeof profile.executablePath === 'string' && profile.executablePath.trim()
				? profile.executablePath.trim()
				: normalizedKey;
		const legacyClaudePath = loaded.claudeExecutablePath?.trim();
		const shouldMapCodexToClaude =
			!loaded.defaultCliId &&
			loaded.defaultCliKind === 'codex' &&
			normalizedKey === 'codex' &&
			(legacyClaudePath
				? rawExecutablePath === legacyClaudePath
				: rawExecutablePath === 'claude');
		const id = shouldMapCodexToClaude ? 'claude' : normalizedKey;
		const executablePath = shouldMapCodexToClaude
			? (legacyClaudePath || 'claude')
			: rawExecutablePath;
		converted.push({
			id,
			displayName:
				id === 'claude'
					? 'Claude'
					: id.charAt(0).toUpperCase() + id.slice(1),
			executablePath,
			defaultArgs: parseStringArray(profile.defaultArgs),
			supportsResume: Boolean(profile.supportsResume),
			resumeArgs: parseStringArray(profile.resumeArgs),
			...(parseResumeStrategy(profile.resumeStrategy) ? { resumeStrategy: parseResumeStrategy(profile.resumeStrategy) } : {})
		});
	}
	if (converted.length > 0) {
		return ensureClaudeProfile(converted, loaded.claudeExecutablePath);
	}
	return null;
}

/**
 * Migrate CLI profiles from any legacy format to the current CliProfile[] format.
 */
export function migrateCliProfiles(loaded: LegacySettingsShape): CliProfile[] {
	const raw = loaded.cliProfiles;

	if (Array.isArray(raw)) {
		const result = migrateFromArray(raw, loaded);
		if (result) return result;
	}

	if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
		const result = migrateFromObject(raw as Record<string, unknown>, loaded);
		if (result) return result;
	}

	const legacyClaudePath = loaded.claudeExecutablePath?.trim() || 'claude';
	return ensureClaudeProfile([
		{
			id: 'claude',
			displayName: 'Claude',
			executablePath: legacyClaudePath,
			defaultArgs: [],
			supportsResume: true,
			resumeArgs: ['--resume']
		}
	], legacyClaudePath);
}
