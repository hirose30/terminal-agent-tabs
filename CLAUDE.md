# Terminal Agent Tabs - Development Guidelines

## Tech Stack
- TypeScript 5.x (ES2018 target)
- Obsidian API
- @xterm/xterm, @xterm/addon-fit, @xterm/addon-webgl, @xterm/addon-unicode11

## Commands
```bash
npm run build   # Production build
npm run dev     # Watch mode
```

## Project Structure
```
src/
├── main.ts              # Plugin entry, commands, lifecycle
├── ClaudeSessionView.ts # Terminal tab view (xterm.js)
├── SessionManager.ts    # Session lifecycle & PTY management
├── SessionSidebarView.ts # Sidebar with sessions & notifications
├── NotificationStore.ts # In-memory notification state
├── HookEventMonitor.ts  # JSONL hook event polling & classification
├── OutputMonitor.ts     # Terminal output pattern detection
├── DockBadge.ts         # macOS dock badge
├── OscParser.ts         # OSC escape sequence parser
├── TerminalTheme.ts     # Theme interface
├── BundledThemes.ts     # Built-in dark theme
├── GhosttyThemeLoader.ts # Ghostty theme loader
├── settings.ts          # Settings tab UI
├── SettingsMigration.ts # Legacy settings migration
├── types.ts             # Interfaces & defaults
└── utils.ts             # Utilities
resources/
└── pty-helper.py        # Python PTY helper
```

## Development Flow
- Never push directly to main. Always create a branch and merge via pull request.

## ESLint (Obsidian Community Plugin Validation)

The Obsidian PR bot (`ObsidianReviewBot`) runs `eslint-plugin-obsidianmd` against the source before human review. **Always run ESLint locally and fix all errors before pushing.**

```bash
npx eslint src/        # Check all source files
npx eslint src/ --fix  # Auto-fix where possible (few rules support this)
```

The local config (`eslint.config.mjs`) uses the same plugin version (`eslint-plugin-obsidianmd@0.1.9`) and has browser/Node globals configured to match the bot's environment.

### Key rules to watch

| Rule | What to do |
|------|-----------|
| `obsidianmd/no-forbidden-elements` | Never `document.createElement('style')` — put CSS in `styles.css` |
| `obsidianmd/no-static-styles-assignment` | Never `el.style.foo = ...` — use CSS classes or `el.setCssProps({...})` |
| `obsidianmd/ui/sentence-case` | All UI strings must be sentence case (`'New session'` not `'New Session'`). Unknown acronyms (OSC, PTY, JSONL) are lowercased — reword to avoid them |
| `obsidianmd/settings-tab/no-problematic-settings-headings` | Heading text must not contain the words "settings" or "options" |
| `@typescript-eslint/no-floating-promises` | Add `void` before fire-and-forget async calls (e.g. `void this.app.workspace.revealLeaf(leaf)`) |
| `@typescript-eslint/no-misused-promises` | `onunload()` in Plugin must be `onunload(): void`, not `async onunload()` |
| `@typescript-eslint/no-unnecessary-type-assertion` | Remove casts after `instanceof` checks |
