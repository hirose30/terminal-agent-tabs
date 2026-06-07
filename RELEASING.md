# Releasing

How a release reaches users. See `doc/issues/008-release-audit-flow.md` for rationale.

## Repos

| remote   | repo                                  | role                                            |
|----------|---------------------------------------|-------------------------------------------------|
| `origin` | `hirose30/obsidian-claudecode-tabs`   | private dev repo (PRs, development)             |
| `public` | `hirose30/terminal-agent-tabs`        | **public repo** — Obsidian community + releases |

`public` is a **mirror of `main`**. Nothing extra is curated for it: `.gitignore`
keeps private/dev files (`doc/`, `docs/`, `.specify/`, `.claude/`, `.codex/`,
`specs/`, `AGENTS.md`, `scripts/install-v2.sh`) out of the tree, so the tracked
files in `main` are exactly what should be public. Only `main.js`,
`manifest.json`, and `styles.css` are attached to the GitHub release (the Python
helpers are esbuild-bundled into `main.js` and extracted at plugin load).

## The flow (staged + audited)

A release is prepared on a dedicated branch, reviewed via PR, and only published
after the audit gate passes.

```
1. git checkout -b release/<ver>
2. ./scripts/prepare-release.sh <ver>      # bump manifest/package/versions.json + CHANGELOG stub
3. edit CHANGELOG.md                        # replace the TODO for <ver>
4. ./scripts/audit-release.sh               # must print "AUDIT: PASS"
5. git add -A && git commit -m "chore: prepare release <ver>"
   open a PR: release/<ver> -> main, review, merge
6. git checkout main && git pull
7. ./scripts/release.sh <ver>               # re-audits, then tags + pushes origin/public + GH release
```

## Scripts

- **`scripts/audit-release.sh`** — read-only gate (run it anytime). Verifies clean
  tree, eslint (`eslint-plugin-obsidianmd`), `npm test`, build + the 3 published
  files, embedded `pty-helper`/`hook-relay`, version consistency
  (manifest == package, `versions.json`, `minAppVersion`), a CHANGELOG entry, the
  list of files that would be published, a secret/sensitive scan, and a
  dependency diff vs the last tag. Exit non-zero = do not publish. No side effects
  beyond a build.
- **`scripts/prepare-release.sh <ver>`** — run on a `release/<ver>` branch. Bumps
  the version files and inserts a CHANGELOG stub. Never commits/pushes.
- **`scripts/release.sh <ver>`** — the **publish** step, run on `main`. Requires a
  clean tree and `manifest.version == <ver>` (already bumped + merged), runs the
  audit (aborts on failure), tags, pushes to `origin` and `public`, and creates
  the GitHub release with `main.js` / `manifest.json` / `styles.css`.

## Notes

- `release.sh` will refuse to run if the audit fails, the tree is dirty, you are
  not on `main`, the tag exists, or `manifest.version` doesn't match the argument.
- An untracked directory (e.g. `.codex/`) makes the tree dirty and blocks the
  audit — keep such agent-local dirs gitignored.
