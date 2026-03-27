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

### Manual Installation

1. Clone or download this repository
2. Run `npm install && npm run build`
3. Copy `main.js`, `manifest.json`, `styles.css`, and the `resources/` folder to your vault's plugin directory:
   ```
   <vault>/.obsidian/plugins/terminal-agent-tabs/
   ```
4. Restart Obsidian and enable the plugin in Settings > Community Plugins

## Commands

| Command | Description |
|---------|-------------|
| New Session Tab | Open a new session with the default CLI |
| New Session Tab (Choose Target) | Open a new session after selecting a CLI profile |
| Send Selection to Current Session | Send selected text to the active session |
| Toggle Session Sidebar | Show/hide the session sidebar |
| Focus Active Session | Jump to the last active session tab |
| Focus Next / Previous Session | Cycle through session tabs |
| Split Session (Horizontal / Vertical) | Split the current session view |
| Increase / Decrease / Reset Font Size | Adjust font size in the current tab |

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
