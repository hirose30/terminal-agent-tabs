import { describe, it, expect } from 'vitest';
import { migrateCliProfiles } from '../SettingsMigration';

describe('migrateCliProfiles — resumeStrategy preservation', () => {
	it('preserves an explicit resumeStrategy from an array profile', () => {
		const profiles = migrateCliProfiles({
			cliProfiles: [
				{ id: 'claude', displayName: 'Claude', executablePath: 'claude', defaultArgs: [], supportsResume: true, resumeArgs: ['--resume'], resumeStrategy: 'assign-id' }
			]
		});
		const claude = profiles.find((p) => p.id === 'claude');
		expect(claude?.resumeStrategy).toBe('assign-id');
	});

	it('preserves an explicit "none" strategy (opt-out for a claude-looking exe)', () => {
		const profiles = migrateCliProfiles({
			cliProfiles: [
				{ id: 'claude', displayName: 'Claude', executablePath: 'claude', defaultArgs: [], supportsResume: true, resumeArgs: [], resumeStrategy: 'none' }
			]
		});
		expect(profiles.find((p) => p.id === 'claude')?.resumeStrategy).toBe('none');
	});

	it('leaves resumeStrategy undefined when absent (inferred later)', () => {
		const profiles = migrateCliProfiles({
			cliProfiles: [
				{ id: 'codex', displayName: 'codex', executablePath: 'codex', defaultArgs: [], supportsResume: true, resumeArgs: [] }
			]
		});
		expect(profiles.find((p) => p.id === 'codex')?.resumeStrategy).toBeUndefined();
	});

	it('ignores an invalid resumeStrategy value', () => {
		const profiles = migrateCliProfiles({
			cliProfiles: [
				{ id: 'codex', displayName: 'codex', executablePath: 'codex', defaultArgs: [], supportsResume: true, resumeArgs: [], resumeStrategy: 'bogus' }
			]
		});
		expect(profiles.find((p) => p.id === 'codex')?.resumeStrategy).toBeUndefined();
	});
});
