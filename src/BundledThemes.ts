/**
 * Bundled Ghostty themes for distribution without Ghostty installed.
 * These are curated popular terminal color themes from the Ghostty project.
 * Source: https://github.com/ghostty-org/ghostty (MIT License)
 */

import type { ITheme } from '@xterm/xterm';

export interface BundledThemeEntry {
	name: string;
	theme: ITheme;
}

const BUNDLED_THEMES: BundledThemeEntry[] = [
	{
		name: '3024 Day',
		theme: {
			background: '#f7f7f7', foreground: '#4a4543', cursor: '#4a4543', cursorAccent: '#f7f7f7',
			selectionBackground: '#a5a2a2', selectionForeground: '#4a4543',
			black: '#090300', red: '#db2d20', green: '#01a252', yellow: '#caba00',
			blue: '#01a0e4', magenta: '#a16a94', cyan: '#8fbece', white: '#a5a2a2',
			brightBlack: '#5c5855', brightRed: '#dbaec3', brightGreen: '#3a3432', brightYellow: '#4a4543',
			brightBlue: '#807d7c', brightMagenta: '#bcbbba', brightCyan: '#cdab53', brightWhite: '#f7f7f7'
		}
	},
	{
		name: '3024 Night',
		theme: {
			background: '#090300', foreground: '#a5a2a2', cursor: '#a5a2a2', cursorAccent: '#090300',
			selectionBackground: '#4a4543', selectionForeground: '#a5a2a2',
			black: '#090300', red: '#db2d20', green: '#01a252', yellow: '#fded02',
			blue: '#01a0e4', magenta: '#a16a94', cyan: '#b5e4f4', white: '#a5a2a2',
			brightBlack: '#5c5855', brightRed: '#e8bbd0', brightGreen: '#47413f', brightYellow: '#4a4543',
			brightBlue: '#807d7c', brightMagenta: '#d6d5d4', brightCyan: '#cdab53', brightWhite: '#f7f7f7'
		}
	},
	{
		name: 'Atom One Dark',
		theme: {
			background: '#21252b', foreground: '#abb2bf', cursor: '#abb2bf', cursorAccent: '#21252b',
			selectionBackground: '#323844', selectionForeground: '#abb2bf',
			black: '#21252b', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
			blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
			brightBlack: '#767676', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b',
			brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#abb2bf'
		}
	},
	{
		name: 'Atom One Light',
		theme: {
			background: '#f9f9f9', foreground: '#2a2c33', cursor: '#bbbbbb', cursorAccent: '#ffffff',
			selectionBackground: '#ededed', selectionForeground: '#2a2c33',
			black: '#000000', red: '#de3e35', green: '#3f953a', yellow: '#d2b67c',
			blue: '#2f5af3', magenta: '#950095', cyan: '#3f953a', white: '#bbbbbb',
			brightBlack: '#000000', brightRed: '#de3e35', brightGreen: '#3f953a', brightYellow: '#d2b67c',
			brightBlue: '#2f5af3', brightMagenta: '#a00095', brightCyan: '#3f953a', brightWhite: '#ffffff'
		}
	},
	{
		name: 'Builtin Solarized Dark',
		theme: {
			background: '#002b36', foreground: '#839496', cursor: '#839496', cursorAccent: '#073642',
			selectionBackground: '#073642', selectionForeground: '#93a1a1',
			black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
			blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
			brightBlack: '#335e69', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
			brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3'
		}
	},
	{
		name: 'Builtin Solarized Light',
		theme: {
			background: '#fdf6e3', foreground: '#657b83', cursor: '#657b83', cursorAccent: '#eee8d5',
			selectionBackground: '#eee8d5', selectionForeground: '#586e75',
			black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
			blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#bbb5a2',
			brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
			brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3'
		}
	},
	{
		name: 'Catppuccin Latte',
		theme: {
			background: '#eff1f5', foreground: '#4c4f69', cursor: '#dc8a78', cursorAccent: '#eff1f5',
			selectionBackground: '#acb0be', selectionForeground: '#4c4f69',
			black: '#5c5f77', red: '#d20f39', green: '#40a02b', yellow: '#df8e1d',
			blue: '#1e66f5', magenta: '#ea76cb', cyan: '#179299', white: '#acb0be',
			brightBlack: '#6c6f85', brightRed: '#de293e', brightGreen: '#49af3d', brightYellow: '#eea02d',
			brightBlue: '#456eff', brightMagenta: '#fe85d8', brightCyan: '#2d9fa8', brightWhite: '#bcc0cc'
		}
	},
	{
		name: 'Catppuccin Mocha',
		theme: {
			background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', cursorAccent: '#1e1e2e',
			selectionBackground: '#585b70', selectionForeground: '#cdd6f4',
			black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
			blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#a6adc8',
			brightBlack: '#585b70', brightRed: '#f37799', brightGreen: '#89d88b', brightYellow: '#ebd391',
			brightBlue: '#74a8fc', brightMagenta: '#f2aede', brightCyan: '#6bd7ca', brightWhite: '#bac2de'
		}
	},
	{
		name: 'Dayfox',
		theme: {
			background: '#f6f2ee', foreground: '#3d2b5a', cursor: '#3d2b5a', cursorAccent: '#f6f2ee',
			selectionBackground: '#e7d2be', selectionForeground: '#3d2b5a',
			black: '#352c24', red: '#a5222f', green: '#396847', yellow: '#ac5402',
			blue: '#2848a9', magenta: '#6e33ce', cyan: '#287980', white: '#bfb6ae',
			brightBlack: '#534c45', brightRed: '#b3434e', brightGreen: '#577f63', brightYellow: '#b86e28',
			brightBlue: '#4863b6', brightMagenta: '#8452d5', brightCyan: '#488d93', brightWhite: '#f4ece6'
		}
	},
	{
		name: 'Dracula',
		theme: {
			background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', cursorAccent: '#282a36',
			selectionBackground: '#44475a', selectionForeground: '#ffffff',
			black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
			blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
			brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5',
			brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff'
		}
	},
	{
		name: 'Everforest Dark Hard',
		theme: {
			background: '#1e2326', foreground: '#d3c6aa', cursor: '#e69875', cursorAccent: '#4c3743',
			selectionBackground: '#4c3743', selectionForeground: '#d3c6aa',
			black: '#7a8478', red: '#e67e80', green: '#a7c080', yellow: '#dbbc7f',
			blue: '#7fbbb3', magenta: '#d699b6', cyan: '#83c092', white: '#f2efdf',
			brightBlack: '#a6b0a0', brightRed: '#f85552', brightGreen: '#8da101', brightYellow: '#dfa000',
			brightBlue: '#3a94c5', brightMagenta: '#df69ba', brightCyan: '#35a77c', brightWhite: '#fffbef'
		}
	},
	{
		name: 'Gruvbox Dark',
		theme: {
			background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', cursorAccent: '#282828',
			selectionBackground: '#665c54', selectionForeground: '#ebdbb2',
			black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921',
			blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
			brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f',
			brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2'
		}
	},
	{
		name: 'Gruvbox Light',
		theme: {
			background: '#fbf1c7', foreground: '#3c3836', cursor: '#3c3836', cursorAccent: '#3c3836',
			selectionBackground: '#3c3836', selectionForeground: '#fbf1c7',
			black: '#fbf1c7', red: '#cc241d', green: '#98971a', yellow: '#d79921',
			blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#7c6f64',
			brightBlack: '#928374', brightRed: '#9d0006', brightGreen: '#79740e', brightYellow: '#b57614',
			brightBlue: '#076678', brightMagenta: '#8f3f71', brightCyan: '#427b58', brightWhite: '#3c3836'
		}
	},
	{
		name: 'Kanagawa Wave',
		theme: {
			background: '#1f1f28', foreground: '#dcd7ba', cursor: '#c8c093', cursorAccent: '#1d202f',
			selectionBackground: '#2d4f67', selectionForeground: '#c8c093',
			black: '#090618', red: '#c34043', green: '#76946a', yellow: '#c0a36e',
			blue: '#7e9cd8', magenta: '#957fb8', cyan: '#6a9589', white: '#c8c093',
			brightBlack: '#727169', brightRed: '#e82424', brightGreen: '#98bb6c', brightYellow: '#e6c384',
			brightBlue: '#7fb4ca', brightMagenta: '#938aa9', brightCyan: '#7aa89f', brightWhite: '#dcd7ba'
		}
	},
	{
		name: 'Nord',
		theme: {
			background: '#2e3440', foreground: '#d8dee9', cursor: '#eceff4', cursorAccent: '#282828',
			selectionBackground: '#eceff4', selectionForeground: '#4c566a',
			black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
			blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
			brightBlack: '#596377', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b',
			brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4'
		}
	},
	{
		name: 'Rose Pine',
		theme: {
			background: '#191724', foreground: '#e0def4', cursor: '#e0def4', cursorAccent: '#191724',
			selectionBackground: '#403d52', selectionForeground: '#e0def4',
			black: '#26233a', red: '#eb6f92', green: '#31748f', yellow: '#f6c177',
			blue: '#9ccfd8', magenta: '#c4a7e7', cyan: '#ebbcba', white: '#e0def4',
			brightBlack: '#6e6a86', brightRed: '#eb6f92', brightGreen: '#31748f', brightYellow: '#f6c177',
			brightBlue: '#9ccfd8', brightMagenta: '#c4a7e7', brightCyan: '#ebbcba', brightWhite: '#e0def4'
		}
	},
	{
		name: 'Rose Pine Dawn',
		theme: {
			background: '#faf4ed', foreground: '#575279', cursor: '#575279', cursorAccent: '#faf4ed',
			selectionBackground: '#dfdad9', selectionForeground: '#575279',
			black: '#f2e9e1', red: '#b4637a', green: '#286983', yellow: '#ea9d34',
			blue: '#56949f', magenta: '#907aa9', cyan: '#d7827e', white: '#575279',
			brightBlack: '#9893a5', brightRed: '#b4637a', brightGreen: '#286983', brightYellow: '#ea9d34',
			brightBlue: '#56949f', brightMagenta: '#907aa9', brightCyan: '#d7827e', brightWhite: '#575279'
		}
	},
	{
		name: 'Rose Pine Moon',
		theme: {
			background: '#232136', foreground: '#e0def4', cursor: '#e0def4', cursorAccent: '#232136',
			selectionBackground: '#44415a', selectionForeground: '#e0def4',
			black: '#393552', red: '#eb6f92', green: '#3e8fb0', yellow: '#f6c177',
			blue: '#9ccfd8', magenta: '#c4a7e7', cyan: '#ea9a97', white: '#e0def4',
			brightBlack: '#6e6a86', brightRed: '#eb6f92', brightGreen: '#3e8fb0', brightYellow: '#f6c177',
			brightBlue: '#9ccfd8', brightMagenta: '#c4a7e7', brightCyan: '#ea9a97', brightWhite: '#e0def4'
		}
	},
	{
		name: 'TokyoNight',
		theme: {
			background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5', cursorAccent: '#15161e',
			selectionBackground: '#33467c', selectionForeground: '#c0caf5',
			black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
			blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
			brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a', brightYellow: '#e0af68',
			brightBlue: '#7aa2f7', brightMagenta: '#bb9af7', brightCyan: '#7dcfff', brightWhite: '#c0caf5'
		}
	},
	{
		name: 'TokyoNight Day',
		theme: {
			background: '#e1e2e7', foreground: '#3760bf', cursor: '#3760bf', cursorAccent: '#e1e2e7',
			selectionBackground: '#99a7df', selectionForeground: '#3760bf',
			black: '#e9e9ed', red: '#f52a65', green: '#587539', yellow: '#8c6c3e',
			blue: '#2e7de9', magenta: '#9854f1', cyan: '#007197', white: '#6172b0',
			brightBlack: '#a1a6c5', brightRed: '#f52a65', brightGreen: '#587539', brightYellow: '#8c6c3e',
			brightBlue: '#2e7de9', brightMagenta: '#9854f1', brightCyan: '#007197', brightWhite: '#3760bf'
		}
	}
];

/** Get all bundled theme names, sorted. */
export function listBundledThemes(): string[] {
	return BUNDLED_THEMES.map((entry) => entry.name);
}

/** Load a bundled theme by name. Returns null if not found. */
export function loadBundledTheme(themeName: string): ITheme | null {
	const entry = BUNDLED_THEMES.find((e) => e.name === themeName);
	return entry ? { ...entry.theme } : null;
}
