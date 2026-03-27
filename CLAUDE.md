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
