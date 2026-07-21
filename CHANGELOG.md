# Changelog

All notable changes to Terminal Agent Tabs are documented here.

## 1.2.0 - 2026-07-22

### Added

- **Agent activity at a glance.** Each session now shows what the agent is
  doing right now: a pulsing red dot when it is waiting for your response
  (a permission prompt or a question), a pulsing yellow dot while it is
  working, and green when idle. The dot appears in the sidebar and on the
  tab header, and the macOS dock badge now counts sessions waiting for
  your input instead of unread notifications.
- **Session list density.** A new "Session list density" setting switches
  the sidebar between a one-line compact view (default) and a normal view
  with a one-line subtitle. Full details for every session are always
  available in the hover tooltip (status, CLI, folder, age, last output,
  latest notification).

### Changed

- Session tab titles no longer include the agent's spinner/status glyph
  prefix — the state is shown by the activity dot instead.
- The sidebar subtitle now prefers the latest notification body over the
  CLI status-bar line, so it shows something meaningful while an agent is
  waiting.
- Numeric unread-count badges (tab header, dock) were replaced by the
  activity indicators above.

### Removed

- The Notifications section in the sidebar. Unread state still drives the
  per-session icons (needs-input triangle / complete check) and is cleared
  when you open the session.

## 1.1.1 - 2026-07-14

### Fixed

- **Obsidian community directory review compliance.** `minAppVersion` is now
  `1.7.2`, matching the newest Obsidian APIs the plugin actually uses
  (`Workspace.revealLeaf` as a promise, `ItemView.addAction`). The terminal
  container background is applied via `setCssStyles` instead of `setCssProps`
  with a literal property name, per the `no-static-styles-assignment` rule.

### Changed

- Bumped `eslint-plugin-obsidianmd` to `^0.4.1` so local lint matches the
  directory review bot.

## 1.1.0 - 2026-07-12

### Added

- **Session persistence.** Agent CLI sessions now survive an Obsidian reload
  or restart: reopening the vault restores each tab's working directory and
  resumes the underlying CLI session (Claude via `--resume`, Codex via
  `resume`) instead of starting fresh. Scrollback for recently closed tabs
  is kept for a couple of weeks so a restored tab isn't blank.

### Fixed

- **Agent event log no longer grows without bound.** The hook event log
  (`agent-events.jsonl`) used for notifications is now capped: it rotates
  once it reaches a configurable size (keeping a configurable number of
  backups), and pre-existing oversized logs are trimmed down automatically
  the next time the plugin loads. The high-frequency tool-use event type is
  now off by default (configurable, along with the other event types, under
  "Agent event log" in settings) since it was the main contributor to log
  growth.

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
