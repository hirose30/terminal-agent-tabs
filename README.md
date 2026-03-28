# Terminal Agent Tabs for Obsidian

An Obsidian plugin that lets you run multiple agent CLI sessions (Claude Code, Codex, Gemini CLI, etc.) as tabs within Obsidian.

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

### From GitHub Release (recommended)

1. Go to the [latest release](https://github.com/hirose30/terminal-agent-tabs/releases/latest)
2. Download `main.js`, `manifest.json`, `styles.css`
3. Create a folder at `<vault>/.obsidian/plugins/terminal-agent-tabs/`
4. Copy the downloaded files and the `resources/` folder into it
5. Restart Obsidian and enable the plugin in Settings > Community Plugins

### From Source

1. Clone this repository
2. Run `npm install && npm run build`
3. Copy `main.js`, `manifest.json`, `styles.css`, and the `resources/` folder to:
   ```
   <vault>/.obsidian/plugins/terminal-agent-tabs/
   ```
4. Restart Obsidian and enable the plugin in Settings > Community Plugins

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
