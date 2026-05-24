# Changelog

All notable changes to Terminal Agent Tabs are documented here.

## 1.0.2 — 2026-05-24

### Fixed

- **Helper scripts are now bundled and auto-extracted.** Previous releases
  shipped `pty-helper.py` and `hook-relay.py` as separate GitHub release
  assets. The Obsidian community directory installer only deploys
  `main.js` / `manifest.json` / `styles.css`, so users installing through
  the directory ended up missing these helpers and the plugin failed to
  start any session. They are now embedded in `main.js` at build time and
  written to `<plugin>/resources/` on plugin load (idempotent — the on-disk
  copy is refreshed only when the embedded content differs). Existing users
  on 1.0.0 / 1.0.1 are healed automatically the next time they update or
  reload the plugin.
- **CLI executables are resolved through the user's login shell.** When the
  profile's executable is a relative name like `claude`, the command is now
  launched via `$SHELL -l -i -c`, mirroring how VSCode / iTerm integrated
  terminals work. This means binaries installed via Homebrew, nvm, asdf,
  mise, npm-global, cmux, etc. are reachable even when Obsidian is launched
  from the macOS dock and inherits launchd's minimal `PATH`. Previously,
  sessions ended immediately ("Session ended normally") because the
  spawn could not locate the configured executable.

### Internal

- Added `src/EmbeddedResources.ts` (resource extraction).
- Added `src/resources.d.ts` (TypeScript module declaration for embedded
  `.py` imports).
- Added `.py` text loader to `esbuild.config.mjs`.
- `scripts/release.sh` no longer attaches `pty-helper.py` / `hook-relay.py`
  to the GitHub release.

## 1.0.1 — 2026-05-19

### Internal

- Resolved all ESLint required issues for community plugin submission.
- Moved xterm CSS from inline `createElement('style')` to `styles.css`.
- Added unit tests for `OscParser`, `OutputMonitor`, `HookEventMonitor`,
  `NotificationStore`.
- Removed deprecated `activeLeaf` usage in favor of `getMostRecentLeaf()`
  and `getActiveViewOfType()`.

### Known issue

- Sessions never started for users installing through the community
  directory — fixed in 1.0.2.

## 1.0.0 — 2026-03-27

Initial public release.
