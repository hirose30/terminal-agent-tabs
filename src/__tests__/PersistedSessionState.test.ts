import { describe, it, expect } from 'vitest';
import {
	PERSISTED_SESSION_STATE_VERSION,
	buildPersistedSessionState,
	parsePersistedSessionState
} from '../PersistedSessionState';

describe('PersistedSessionState', () => {
	describe('buildPersistedSessionState()', () => {
		it('builds a versioned state from launch config + cwd', () => {
			const state = buildPersistedSessionState(
				{ cliId: 'claude', additionalArgs: ['--foo'] },
				'/Users/me/vault'
			);
			expect(state).toEqual({
				v: PERSISTED_SESSION_STATE_VERSION,
				cliId: 'claude',
				cwd: '/Users/me/vault',
				additionalArgs: ['--foo']
			});
		});

		it('defaults additionalArgs to [] when missing or non-array', () => {
			const state = buildPersistedSessionState(
				{ cliId: 'claude', additionalArgs: undefined as unknown as string[] },
				'/cwd'
			);
			expect(state.additionalArgs).toEqual([]);
		});

		it('round-trips through parse', () => {
			const built = buildPersistedSessionState({ cliId: 'codex', additionalArgs: [] }, '/tmp/x');
			expect(parsePersistedSessionState(built)).toEqual(built);
		});
	});

	describe('parsePersistedSessionState()', () => {
		const valid = {
			v: PERSISTED_SESSION_STATE_VERSION,
			cliId: 'claude',
			cwd: '/Users/me/project',
			additionalArgs: ['--model', 'opus']
		};

		it('accepts a valid object', () => {
			expect(parsePersistedSessionState(valid)).toEqual(valid);
		});

		it('trims cwd and cliId', () => {
			const parsed = parsePersistedSessionState({ ...valid, cwd: '  /a/b  ', cliId: ' claude ' });
			expect(parsed?.cwd).toBe('/a/b');
			expect(parsed?.cliId).toBe('claude');
		});

		it('filters non-string additionalArgs entries', () => {
			const parsed = parsePersistedSessionState({
				...valid,
				additionalArgs: ['ok', 1, null, 'fine', {}]
			});
			expect(parsed?.additionalArgs).toEqual(['ok', 'fine']);
		});

		it('defaults additionalArgs to [] when not an array', () => {
			const parsed = parsePersistedSessionState({ ...valid, additionalArgs: 'nope' });
			expect(parsed?.additionalArgs).toEqual([]);
		});

		// Graceful degradation → null (callers fall back to a new session in the vault dir)
		it.each([
			['null', null],
			['undefined', undefined],
			['a string', 'string'],
			['a number', 42],
			['an array', []],
			['empty object', {}],
			['missing version', { cliId: 'claude', cwd: '/a' }],
			['wrong version (0)', { ...valid, v: 0 }],
			['wrong version (2)', { ...valid, v: 2 }],
			['version as string', { ...valid, v: '1' }],
			['missing cwd', { v: 1, cliId: 'claude', additionalArgs: [] }],
			['empty cwd', { ...valid, cwd: '   ' }],
			['non-string cwd', { ...valid, cwd: 123 }],
			['missing cliId', { v: 1, cwd: '/a', additionalArgs: [] }],
			['empty cliId', { ...valid, cliId: '  ' }],
			['non-string cliId', { ...valid, cliId: 5 }]
		])('returns null for %s', (_label, input) => {
			expect(parsePersistedSessionState(input)).toBeNull();
		});
	});
});
