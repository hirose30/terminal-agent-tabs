# Terminal Agent Tabs for Obsidian

An Obsidian plugin that lets you run multiple agent CLI sessions (Claude Code, Codex, Gemini CLI, etc.) as tabs within Obsidian.

> **Platform support**: only macOS is actively tested and supported. The plugin relies on a POSIX PTY (`os.openpty` / `fcntl`) provided by the bundled `pty-helper.py`, so **Windows is not supported** and will not work. **Linux** may work in principle since the PTY APIs exist, but it has not been verified — use at your own risk and please report results.

## Features

- **Multiple Sessions**: Run multiple CLI sessions in parallel as Obsidian tabs
- **Configurable CLI Profiles**: Add profiles for any agent CLI (Claude Code, Codex, Gemini, Grok, etc.)
- **Session Sidebar**: Overview of all sessions with status, notifications, and quick navigation
- **Per-Tab Font Size**: Adjust font size independently for each tab (Ctrl/Cmd +/-)
- **Send Selection**: Send selected text from your notes to the active session
- **Dynamic Titles**: Tab titles auto-update based on terminal output (OSC sequences)
- **Session Resume**: Resume previous sessions from termination screen or tab menu
- **Split Views**: Split session tabs horizontally or vertically
- **Hook Notifications**: Watch a JSONL event file and show notices for hook events (permissions, errors, task completion)
- **Notification Sound**: Optional audible alerts for hook events
- **Dock Badge**: macOS dock badge shows notification count
- **Ghostty Themes**: Load terminal color themes from Ghostty config
- **OSC 52 Clipboard**: Sync terminal clipboard events to system clipboard

## Requirements

- Obsidian Desktop 1.0.0+
- macOS (primary supported platform)
- At least one CLI available locally (default profile uses `claude`)

## Installation

### From the Obsidian community directory (recommended)

1. Open **Settings → Community plugins → Browse**
2. Search for **Terminal Agent Tabs** and install
3. Enable the plugin

The Python helper scripts that drive the PTY are bundled inside `main.js` and extracted automatically to `<plugin>/resources/` on first load — no manual setup is required.

> **Note on 1.0.0 and 1.0.1**: those releases shipped `pty-helper.py` and `hook-relay.py` as separate files in the GitHub release. Because the Obsidian community installer only ships `main.js` / `manifest.json` / `styles.css`, users installing through the directory ended up without these helpers and sessions never started. **1.0.2 fixes this by embedding the helpers in `main.js` and writing them to disk at startup.** If you were affected, just update to 1.0.2 — the missing files are restored automatically.

### From GitHub Release

1. Go to the [latest release](https://github.com/hirose30/terminal-agent-tabs/releases/latest)
2. Download `main.js`, `manifest.json`, `styles.css`
3. Place them in `<vault>/.obsidian/plugins/terminal-agent-tabs/`
4. Reload Obsidian and enable the plugin in Settings → Community plugins

### From Source

1. Clone this repository
2. Run `npm install && npm run build`
3. Copy `main.js`, `manifest.json`, `styles.css` to `<vault>/.obsidian/plugins/terminal-agent-tabs/`
4. Reload Obsidian and enable the plugin in Settings → Community plugins

## Commands

| Command | Description |
|---------|-------------|
| New session tab | Open a new session with the default CLI |
| New session tab (choose target) | Open a new session after selecting a CLI profile |
| Send selection to current session | Send selected text to the active session |
| Toggle session sidebar | Show/hide the session sidebar |
| Focus active session | Jump to the last active session tab |
| Focus next / previous session | Cycle through session tabs |
| Split session (horizontal / vertical) | Split the current session view |
| Increase / decrease / reset font size | Adjust font size in the current tab |

## Settings

### CLI Profiles
Configure one or more CLI profiles with custom executable paths, default arguments, and resume support.

Relative executable names (e.g. `claude`) are resolved through your login shell (`$SHELL -l -i`), so binaries installed via Homebrew, nvm, asdf, mise, npm-global, etc. are reachable even when Obsidian is launched from the macOS dock. If you prefer to skip shell resolution, enter an absolute path instead.

### Terminal Appearance
- Color theme (Ghostty themes supported)
- Font size and font family
- Custom block glyphs toggle
- OSC 52 clipboard sync

### Hook Notifications
Monitor a JSONL file for agent hook events and display notifications.

1. Enable **Agent Hook Notifications** in plugin settings
2. Optionally enable **Play notification sound**
3. Set **Hook events file path** (or leave empty for default)
4. Append JSON objects from your CLI hook script:

```json
{"event":"stop","source":"claude","message":"Task finished"}
```

### Send Selection Options
- Wrap selection in code block
- Include note file path

## Development

```bash
npm install
npm run dev    # Watch mode
npm run build  # Production build
```

## License

MIT
