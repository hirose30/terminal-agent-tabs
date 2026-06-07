import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodexSessionCapture } from '../CodexSessionCapture';

const tmpHomes: string[] = [];

afterEach(() => {
	for (const home of tmpHomes.splice(0)) {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

function makeHome(): string {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tat-codex-capture-'));
	tmpHomes.push(home);
	return home;
}

function dayDir(home: string, timestampMs: number): string {
	const date = new Date(timestampMs);
	return path.join(
		home,
		'.codex',
		'sessions',
		String(date.getFullYear()),
		String(date.getMonth() + 1).padStart(2, '0'),
		String(date.getDate()).padStart(2, '0')
	);
}

function writeRollout(home: string, id: string, cwd: string, timestampMs: number, padding: string = ''): void {
	const dir = dayDir(home, timestampMs);
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `rollout-${id}.jsonl`);
	const timestamp = new Date(timestampMs).toISOString();
	const line = JSON.stringify({
		type: 'session_meta',
		timestamp,
		payload: { id, cwd, timestamp, padding }
	});
	fs.writeFileSync(file, `${line}\n{"type":"event"}\n`);
	const date = new Date(timestampMs);
	fs.utimesSync(file, date, date);
}

describe('CodexSessionCapture', () => {
	it('ignores rollout ids present in the pre-spawn baseline', () => {
		const home = makeHome();
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tat-cwd-'));
		const sinceMs = new Date(2026, 0, 2, 10, 0, 0).getTime();
		writeRollout(home, 'existing', cwd, sinceMs + 100);
		const capture = new CodexSessionCapture({ homeDir: home, now: () => sinceMs + 300 });

		const baseline = capture.snapshotRolloutIds(capture.resolveRealCwd(cwd), sinceMs);
		writeRollout(home, 'created-by-spawn', cwd, sinceMs + 200);

		expect(capture.findNewRolloutId(capture.resolveRealCwd(cwd), sinceMs, baseline, new Set())).toBe('created-by-spawn');
		fs.rmSync(cwd, { recursive: true, force: true });
	});

	it('skips rollout ids already claimed by another live session', () => {
		const home = makeHome();
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tat-cwd-'));
		const sinceMs = new Date(2026, 0, 2, 10, 0, 0).getTime();
		writeRollout(home, 'first', cwd, sinceMs + 100);
		writeRollout(home, 'second', cwd, sinceMs + 200);
		const capture = new CodexSessionCapture({ homeDir: home, now: () => sinceMs + 300 });

		expect(capture.findNewRolloutId(
			capture.resolveRealCwd(cwd),
			sinceMs,
			new Set(),
			new Set(['first'])
		)).toBe('second');
		fs.rmSync(cwd, { recursive: true, force: true });
	});

	it('searches day directories derived from sinceMs through now across month boundaries', () => {
		const home = makeHome();
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tat-cwd-'));
		const sinceMs = new Date(2026, 0, 31, 23, 59, 59).getTime();
		const laterMs = sinceMs + 2000;
		writeRollout(home, 'next-month', cwd, laterMs);
		const capture = new CodexSessionCapture({ homeDir: home, now: () => laterMs });

		expect(capture.findNewRolloutId(capture.resolveRealCwd(cwd), sinceMs, new Set(), new Set())).toBe('next-month');
		fs.rmSync(cwd, { recursive: true, force: true });
	});

	it('reads a session_meta line beyond the old 256KB boundary', () => {
		const home = makeHome();
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tat-cwd-'));
		const sinceMs = new Date(2026, 0, 2, 10, 0, 0).getTime();
		writeRollout(home, 'large-meta', cwd, sinceMs + 100, 'x'.repeat(300_000));
		const capture = new CodexSessionCapture({ homeDir: home, now: () => sinceMs + 200 });

		expect(capture.findNewRolloutId(capture.resolveRealCwd(cwd), sinceMs, new Set(), new Set())).toBe('large-meta');
		fs.rmSync(cwd, { recursive: true, force: true });
	});
});
