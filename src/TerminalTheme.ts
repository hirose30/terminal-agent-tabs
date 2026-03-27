/**
 * Terminal Theme utilities for font size management and theme integration
 */

import type { ITheme } from '@xterm/xterm';
import { loadGhosttyTheme } from './GhosttyThemeLoader';

export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;
export const FONT_SIZE_STEP = 2;

/** Built-in dark fallback theme. */
const DEFAULT_DARK_THEME: ITheme = {
	background: '#1e1e1e',
	foreground: '#d4d4d4',
	cursor: '#d4d4d4',
	cursorAccent: '#1e1e1e',
	black: '#000000',
	red: '#cc0000',
	green: '#4e9a06',
	yellow: '#c4a000',
	blue: '#3465a4',
	magenta: '#75507b',
	cyan: '#06989a',
	white: '#d3d7cf',
	brightBlack: '#555753',
	brightRed: '#ef2929',
	brightGreen: '#8ae234',
	brightYellow: '#fce94f',
	brightBlue: '#729fcf',
	brightMagenta: '#ad7fa8',
	brightCyan: '#34e2e2',
	brightWhite: '#eeeeec'
};

/**
 * Build an xterm.js ITheme for the given Ghostty theme name.
 * If themeName is empty or the theme cannot be loaded, returns the default dark theme.
 */
export function buildTerminalTheme(themeName?: string): ITheme {
	if (themeName) {
		const loaded = loadGhosttyTheme(themeName);
		if (loaded) return loaded;
	}
	return { ...DEFAULT_DARK_THEME };
}

export function clampFontSize(size: number): number {
	return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, size));
}

export function increaseFontSize(currentSize: number): number {
	return clampFontSize(currentSize + FONT_SIZE_STEP);
}

export function decreaseFontSize(currentSize: number): number {
	return clampFontSize(currentSize - FONT_SIZE_STEP);
}
