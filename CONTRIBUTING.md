# Contributing to Terminal Agent Tabs

Thanks for your interest in improving Terminal Agent Tabs. This is a small personal project, so the process is intentionally lightweight.

## Reporting bugs and requesting features

Please open an issue at https://github.com/hirose30/terminal-agent-tabs/issues.

When reporting a bug, include:

- Obsidian version and platform (macOS version, etc.)
- Plugin version
- Steps to reproduce
- Expected vs. actual behavior
- Relevant terminal output or console errors (open Obsidian's developer console with `Cmd+Option+I`)

## Development setup

```bash
git clone https://github.com/hirose30/terminal-agent-tabs.git
cd terminal-agent-tabs
npm install
npm run dev       # Watch mode
npm run build     # Production build
npm test          # Run unit tests
```

To test changes against your vault, copy or symlink `main.js`, `manifest.json`, `styles.css`, and the `resources/` folder into `<vault>/.obsidian/plugins/terminal-agent-tabs/`, then reload Obsidian.

## Pull requests

- Create a feature branch from `main`.
- Run `npm test` and `npx eslint src/` before pushing.
- Keep changes focused; one PR per logical change.
- Update documentation (README, CLAUDE.md) when behavior changes.

## Code style

- TypeScript strict mode is enabled.
- The project follows the Obsidian community plugin ESLint rules — run `npx eslint src/` and fix all errors before submitting.
- Pure logic modules live in `src/` with companion tests in `src/__tests__/`; Obsidian-API-dependent code (Views, Plugin, SessionManager) is exercised via manual UAT.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
