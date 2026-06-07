import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CodexSessionMeta {
	id: string;
	cwd: string;
	timestamp?: string;
	file: string;
	mtimeMs: number;
	size: number;
}

interface CachedMeta {
	mtimeMs: number;
	size: number;
	meta: CodexSessionMeta | null;
}

interface CodexSessionCaptureOptions {
	homeDir?: string;
	now?: () => number;
	candidateLimit?: number;
	maxMetaBytes?: number;
	debug?: (message: string, error?: unknown) => void;
}

const DEFAULT_CANDIDATE_LIMIT = 100;
const DEFAULT_MAX_META_BYTES = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const STAT_SKEW_MS = 2000;

export class CodexSessionCapture {
	private readonly homeDir: string;
	private readonly now: () => number;
	private readonly candidateLimit: number;
	private readonly maxMetaBytes: number;
	private readonly debug?: (message: string, error?: unknown) => void;
	private readonly metaCache: Map<string, CachedMeta> = new Map();

	constructor(options: CodexSessionCaptureOptions = {}) {
		this.homeDir = options.homeDir ?? os.homedir();
		this.now = options.now ?? (() => Date.now());
		this.candidateLimit = options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
		this.maxMetaBytes = options.maxMetaBytes ?? DEFAULT_MAX_META_BYTES;
		this.debug = options.debug;
	}

	resolveRealCwd(cwd: string): string {
		try { return fs.realpathSync(cwd); } catch { return cwd; }
	}

	snapshotRolloutIds(realCwd: string, sinceMs: number): Set<string> {
		return new Set(
			this.findCandidateRollouts(realCwd, sinceMs)
				.map((meta) => meta.id)
		);
	}

	findNewRolloutId(
		realCwd: string,
		sinceMs: number,
		baselineIds: ReadonlySet<string>,
		claimedIds: ReadonlySet<string>
	): string | null {
		const candidates = this.findCandidateRollouts(realCwd, sinceMs)
			.filter((meta) => !baselineIds.has(meta.id) && !claimedIds.has(meta.id))
			.sort((a, b) => this.metaTimeMs(a) - this.metaTimeMs(b));
		return candidates[0]?.id ?? null;
	}

	private sessionsRoot(): string {
		return path.join(this.homeDir, '.codex', 'sessions');
	}

	private findCandidateRollouts(realCwd: string, sinceMs: number): CodexSessionMeta[] {
		const files = this.findRecentRolloutFiles(sinceMs);
		const result: CodexSessionMeta[] = [];
		for (const file of files) {
			const meta = this.readCodexSessionMeta(file);
			if (!meta?.id || !meta.cwd) continue;
			if (this.resolveRealCwd(meta.cwd) !== realCwd) continue;
			const ts = Date.parse(meta.timestamp ?? '');
			if (!Number.isFinite(ts) || ts < sinceMs) continue;
			result.push(meta);
		}
		return result;
	}

	private findRecentRolloutFiles(sinceMs: number): string[] {
		const files: Array<{ file: string; mtimeMs: number }> = [];
		for (const dir of this.codexDayDirsForRange(sinceMs, this.now())) {
			let entries: string[];
			try { entries = fs.readdirSync(dir); } catch { continue; }
			for (const name of entries) {
				if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue;
				const file = path.join(dir, name);
				try {
					const stat = fs.statSync(file);
					if (!stat.isFile() || stat.mtimeMs < sinceMs - STAT_SKEW_MS) continue;
					files.push({ file, mtimeMs: stat.mtimeMs });
				} catch {
					// Ignore disappearing files.
				}
			}
		}
		return files
			.sort((a, b) => b.mtimeMs - a.mtimeMs)
			.slice(0, this.candidateLimit)
			.map((item) => item.file);
	}

	private codexDayDirsForRange(sinceMs: number, nowMs: number): string[] {
		const root = this.sessionsRoot();
		const start = this.startOfLocalDay(Math.min(sinceMs, nowMs));
		const end = this.startOfLocalDay(Math.max(sinceMs, nowMs));
		const result: string[] = [];
		for (let t = start; t <= end; t += DAY_MS) {
			const date = new Date(t);
			const year = String(date.getFullYear());
			const month = String(date.getMonth() + 1).padStart(2, '0');
			const day = String(date.getDate()).padStart(2, '0');
			result.push(path.join(root, year, month, day));
		}
		return result;
	}

	private startOfLocalDay(ms: number): number {
		const date = new Date(ms);
		return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
	}

	private metaTimeMs(meta: CodexSessionMeta): number {
		const parsed = Date.parse(meta.timestamp ?? '');
		return Number.isFinite(parsed) ? parsed : meta.mtimeMs;
	}

	private readCodexSessionMeta(file: string): CodexSessionMeta | null {
		let stat: fs.Stats;
		try {
			stat = fs.statSync(file);
		} catch {
			return null;
		}

		const cached = this.metaCache.get(file);
		if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
			return cached.meta;
		}

		const meta = this.readCodexSessionMetaUncached(file, stat);
		this.metaCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, meta });
		return meta;
	}

	private readCodexSessionMetaUncached(file: string, stat: fs.Stats): CodexSessionMeta | null {
		let fd: number | null = null;
		try {
			fd = fs.openSync(file, 'r');
			const limit = Math.min(Math.max(this.maxMetaBytes, 1), Math.max(stat.size, 1));
			const chunks: Buffer[] = [];
			let total = 0;
			while (total < limit) {
				const size = Math.min(65536, limit - total);
				const buf = Buffer.alloc(size);
				const bytes = fs.readSync(fd, buf, 0, size, total);
				if (bytes <= 0) break;
				chunks.push(buf.subarray(0, bytes));
				total += bytes;
				if (buf.subarray(0, bytes).includes(10)) break;
			}
			const text = Buffer.concat(chunks).toString('utf8');
			const nl = text.indexOf('\n');
			if (nl < 0 && total >= this.maxMetaBytes) {
				this.debug?.('[TerminalAgentTabs] Codex rollout meta line exceeded read limit:', file);
				return null;
			}
			const firstLine = nl >= 0 ? text.slice(0, nl) : text;
			const obj = JSON.parse(firstLine) as { type?: string; timestamp?: string; payload?: Record<string, unknown> };
			if (obj?.type !== 'session_meta' || !obj.payload) return null;
			const p = obj.payload;
			const id = typeof p.id === 'string' ? p.id : '';
			const cwd = typeof p.cwd === 'string' ? p.cwd : '';
			if (!id || !cwd) return null;
			return {
				id,
				cwd,
				timestamp: typeof p.timestamp === 'string' ? p.timestamp : obj.timestamp,
				file,
				mtimeMs: stat.mtimeMs,
				size: stat.size
			};
		} catch (error) {
			this.debug?.('[TerminalAgentTabs] Failed to parse Codex rollout meta:', error);
			return null;
		} finally {
			if (fd !== null) {
				try { fs.closeSync(fd); } catch { /* ignore */ }
			}
		}
	}
}
