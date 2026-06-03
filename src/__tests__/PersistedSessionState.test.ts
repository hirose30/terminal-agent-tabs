import { describe, it, expect } from 'vitest';
import {
	PERSISTED_SESSION_STATE_VERSION,
	buildPersistedSessionState,
	parsePersistedSessionState,
	isSafeResumeKey
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

		it('includes resumeKey when provided', () => {
			const built = buildPersistedSessionState({ cliId: 'claude', additionalArgs: [] }, '/c', 'uuid-123');
			expect(built.resumeKey).toBe('uuid-123');
			expect(parsePersistedSessionState(built)).toEqual(built);
		});

		it('omits resumeKey when blank or absent', () => {
			expect(buildPersistedSessionState({ cliId: 'claude', additionalArgs: [] }, '/c', '   ').resumeKey).toBeUndefined();
			expect(buildPersistedSessionState({ cliId: 'claude', additionalArgs: [] }, '/c').resumeKey).toBeUndefined();
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

		it('parses resumeKey when present and trims it', () => {
			const parsed = parsePersistedSessionState({ ...valid, resumeKey: '  abc-1  ' });
			expect(parsed?.resumeKey).toBe('abc-1');
		});

		it('omits resumeKey when blank or non-string', () => {
			expect(parsePersistedSessionState({ ...valid, resumeKey: '   ' })?.resumeKey).toBeUndefined();
			expect(parsePersistedSessionState({ ...valid, resumeKey: 42 })?.resumeKey).toBeUndefined();
			expect(parsePersistedSessionState(valid)?.resumeKey).toBeUndefined();
		});

		it('rejects an unsafe (path-traversal) resumeKey', () => {
			expect(parsePersistedSessionState({ ...valid, resumeKey: '../../etc/passwd' })?.resumeKey).toBeUndefined();
			expect(parsePersistedSessionState({ ...valid, resumeKey: 'a/b' })?.resumeKey).toBeUndefined();
			expect(parsePersistedSessionState({ ...valid, resumeKey: 'a.txt' })?.resumeKey).toBeUndefined();
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

	describe('isSafeResumeKey', () => {
		it('accepts uuids and safe tokens', () => {
			expect(isSafeResumeKey('70be7d2a-1b13-4864-a4d6-1dae2b1c562e')).toBe(true);
			expect(isSafeResumeKey('abc_123-XYZ')).toBe(true);
		});
		it('rejects traversal, slashes, dots, empty, and over-long', () => {
			expect(isSafeResumeKey('../evil')).toBe(false);
			expect(isSafeResumeKey('a/b')).toBe(false);
			expect(isSafeResumeKey('a.b')).toBe(false);
			expect(isSafeResumeKey('')).toBe(false);
			expect(isSafeResumeKey(42)).toBe(false);
			expect(isSafeResumeKey('x'.repeat(129))).toBe(false);
		});
	});
});
