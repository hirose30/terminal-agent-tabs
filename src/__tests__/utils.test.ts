import { describe, it, expect } from 'vitest';
import { normalizeCliId, stripPrivateModeSequences } from '../utils';

describe('normalizeCliId', () => {
	it('lowercases and replaces invalid chars with dashes', () => {
		expect(normalizeCliId('Claude Code')).toBe('claude-code');
	});

	it('collapses repeated dashes and trims', () => {
		expect(normalizeCliId('  My__CLI!!  ')).toBe('my__cli-');
	});

	it('falls back to "cli" when empty', () => {
		expect(normalizeCliId('   ')).toBe('cli');
	});
});

describe('stripPrivateModeSequences', () => {
	it('removes alt-screen enter/leave', () => {
		expect(stripPrivateModeSequences('\x1b[?1049hX\x1b[?1049l')).toBe('X');
	});

	it('removes cursor visibility, mouse, and bracketed-paste toggles', () => {
		const input = '\x1b[?25l\x1b[?1000h\x1b[?1002h\x1b[?2004hhello\x1b[?25h';
		expect(stripPrivateModeSequences(input)).toBe('hello');
	});

	it('preserves visible text, SGR colors, and cursor moves', () => {
		const input = '\x1b[2J\x1b[H\x1b[38;5;174mClaude\x1b[39m\nline2';
		// CSI without "?" (SGR, erase, cursor home) is kept; only "?…h/l" is stripped
		expect(stripPrivateModeSequences(input)).toBe(input);
	});

	it('handles a realistic alt-screen TUI dump (claude-like) → only modes removed', () => {
		const dump = '\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[2J\x1b[HClaude Code';
		expect(stripPrivateModeSequences(dump)).toBe('\x1b[2J\x1b[HClaude Code');
	});

	it('is a no-op on plain text', () => {
		expect(stripPrivateModeSequences('just text')).toBe('just text');
	});
});
