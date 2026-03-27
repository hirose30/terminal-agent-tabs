import * as fs from 'fs';
import * as path from 'path';
import type { ITheme } from '@xterm/xterm';
import { listBundledThemes, loadBundledTheme } from './BundledThemes';

/** Standard Ghostty theme search paths (cross-platform). */
function getGhosttyThemeDirs(): string[] {
	const home = process.env.HOME || process.env.USERPROFILE || '';
	const dirs = [
		path.join(home, '.config', 'ghostty', 'themes'),
	];
	if (process.platform === 'darwin') {
		dirs.push('/Applications/Ghostty.app/Contents/Resources/ghostty/themes');
	}
	if (process.platform === 'linux') {
		dirs.push('/usr/share/ghostty/themes');
	}
	return dirs;
}

/**
 * Parse a Ghostty theme file into an xterm.js ITheme.
 *
 * Format:
 *   palette = N=#rrggbb   (N: 0-15, ANSI color index)
 *   background = #rrggbb
 *   foreground = #rrggbb
 *   cursor-color = #rrggbb
 *   cursor-text = #rrggbb
 *   selection-background = #rrggbb
 *   selection-foreground = #rrggbb
 */
export function parseGhosttyTheme(content: string): ITheme {
	const palette: Record<number, string> = {};
	let background = '';
	let foreground = '';
	let cursorColor = '';
	let cursorText = '';
	let selectionBg = '';
	let selectionFg = '';

	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;

		const eqIdx = line.indexOf('=');
		if (eqIdx < 0) continue;

		const key = line.slice(0, eqIdx).trim();
		const value = line.slice(eqIdx + 1).trim();

		if (key === 'palette') {
			const match = value.match(/^(\d+)\s*=\s*(#?[0-9a-fA-F]{6})$/);
			if (match) {
				const idx = parseInt(match[1], 10);
				const color = match[2].startsWith('#') ? match[2] : `#${match[2]}`;
				palette[idx] = color;
			}
		} else if (key === 'background') {
			background = value.startsWith('#') ? value : `#${value}`;
		} else if (key === 'foreground') {
			foreground = value.startsWith('#') ? value : `#${value}`;
		} else if (key === 'cursor-color') {
			cursorColor = value.startsWith('#') ? value : `#${value}`;
		} else if (key === 'cursor-text') {
			cursorText = value.startsWith('#') ? value : `#${value}`;
		} else if (key === 'selection-background') {
			selectionBg = value.startsWith('#') ? value : `#${value}`;
		} else if (key === 'selection-foreground') {
			selectionFg = value.startsWith('#') ? value : `#${value}`;
		}
	}

	return {
		background: background || '#1e1e1e',
		foreground: foreground || '#d4d4d4',
		cursor: cursorColor || foreground || '#d4d4d4',
		cursorAccent: cursorText || background || '#1e1e1e',
		selectionBackground: selectionBg || undefined,
		selectionForeground: selectionFg || undefined,
		black: palette[0] || '#000000',
		red: palette[1] || '#cc0000',
		green: palette[2] || '#4e9a06',
		yellow: palette[3] || '#c4a000',
		blue: palette[4] || '#3465a4',
		magenta: palette[5] || '#75507b',
		cyan: palette[6] || '#06989a',
		white: palette[7] || '#d3d7cf',
		brightBlack: palette[8] || '#555753',
		brightRed: palette[9] || '#ef2929',
		brightGreen: palette[10] || '#8ae234',
		brightYellow: palette[11] || '#fce94f',
		brightBlue: palette[12] || '#729fcf',
		brightMagenta: palette[13] || '#ad7fa8',
		brightCyan: palette[14] || '#34e2e2',
		brightWhite: palette[15] || '#eeeeec'
	};
}

/**
 * List all available Ghostty theme names from known directories + bundled themes.
 * Returns sorted unique names.
 */
export function listGhosttyThemes(): string[] {
	const names = new Set<string>();

	// Add bundled themes first
	for (const name of listBundledThemes()) {
		names.add(name);
	}

	// Add local Ghostty themes (may overlap with bundled)
	for (const dir of getGhosttyThemeDirs()) {
		try {
			if (!fs.existsSync(dir)) continue;
			const entries = fs.readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.isFile()) {
					names.add(entry.name);
				}
			}
		} catch {
			// ignore unreadable directories
		}
	}

	return Array.from(names).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * Load a Ghostty theme by name.
 * Checks local Ghostty directories first, then falls back to bundled themes.
 * Returns null if not found.
 */
export function loadGhosttyTheme(themeName: string): ITheme | null {
	// Try local Ghostty theme files first (user may have customized versions)
	for (const dir of getGhosttyThemeDirs()) {
		const filePath = path.join(dir, themeName);
		try {
			if (fs.existsSync(filePath)) {
				const content = fs.readFileSync(filePath, 'utf8');
				return parseGhosttyTheme(content);
			}
		} catch {
			// try next source
		}
	}

	// Fall back to bundled themes
	return loadBundledTheme(themeName);
}
