import { describe, it, expect, beforeEach } from 'vitest';
import { OscParser, parseTitleActivity } from '../OscParser';

describe('OscParser', () => {
	let parser: OscParser;

	beforeEach(() => {
		parser = new OscParser();
	});

	describe('parse()', () => {
		it('extracts title from OSC 0 with BEL terminator', () => {
			const result = parser.parse('\x1b]0;My Title\x07');
			expect(result.title).toBe('My Title');
		});

		it('extracts title from OSC 2 with BEL terminator', () => {
			const result = parser.parse('\x1b]2;Window Title\x07');
			expect(result.title).toBe('Window Title');
		});

		it('extracts title from OSC 0 with ST terminator', () => {
			const result = parser.parse('\x1b]0;My Title\x1b\\');
			expect(result.title).toBe('My Title');
		});

		it('extracts title from OSC 9 (notification)', () => {
			const result = parser.parse('\x1b]9;Notification text\x07');
			expect(result.title).toBe('Notification text');
		});

		it('returns null title when no OSC sequence present', () => {
			const result = parser.parse('Hello, world!');
			expect(result.title).toBeNull();
		});

		it('returns last title when multiple OSC sequences in one chunk', () => {
			const result = parser.parse('\x1b]0;First\x07\x1b]0;Second\x07');
			expect(result.title).toBe('Second');
		});

		it('always returns original data unchanged', () => {
			const data = '\x1b]0;Title\x07some output';
			const result = parser.parse(data);
			expect(result.data).toBe(data);
		});

		it('buffers incomplete OSC sequence and resolves on next call', () => {
			// Split sequence across two calls
			const r1 = parser.parse('\x1b]0;Spli');
			expect(r1.title).toBeNull();

			const r2 = parser.parse('t Title\x07');
			expect(r2.title).toBe('Split Title');
		});

		it('does not extract title from OSC 3 (unsupported type)', () => {
			const result = parser.parse('\x1b]3;ignored\x07');
			expect(result.title).toBeNull();
		});
	});

	describe('getCurrentTitle()', () => {
		it('returns null initially', () => {
			expect(parser.getCurrentTitle()).toBeNull();
		});

		it('returns last parsed title', () => {
			parser.parse('\x1b]0;First\x07');
			parser.parse('no osc here');
			expect(parser.getCurrentTitle()).toBe('First');
		});

		it('updates when new title is parsed', () => {
			parser.parse('\x1b]0;First\x07');
			parser.parse('\x1b]0;Second\x07');
			expect(parser.getCurrentTitle()).toBe('Second');
		});
	});

	describe('reset()', () => {
		it('clears current title', () => {
			parser.parse('\x1b]0;Title\x07');
			parser.reset();
			expect(parser.getCurrentTitle()).toBeNull();
		});

		it('clears buffer so incomplete sequence is discarded', () => {
			parser.parse('\x1b]0;Incomple');
			parser.reset();
			// After reset, the buffered partial sequence is gone
			const result = parser.parse('te\x07');
			expect(result.title).toBeNull();
		});

		it('clears current cwd', () => {
			parser.parse('\x1b]7;file://host/Users/me\x07');
			parser.reset();
			expect(parser.getCurrentCwd()).toBeNull();
		});
	});

	describe('parseTitleActivity()', () => {
		it('detects working from a braille spinner prefix (U+2802)', () => {
			expect(parseTitleActivity('⠂ Count numbers one to twelve')).toEqual({
				state: 'working',
				cleanTitle: 'Count numbers one to twelve'
			});
		});

		it('detects working at the low braille boundary (U+2800)', () => {
			expect(parseTitleActivity('⠀ Title')).toEqual({
				state: 'working',
				cleanTitle: 'Title'
			});
		});

		it('detects working at the high braille boundary (U+28FF)', () => {
			expect(parseTitleActivity('⣿ Title')).toEqual({
				state: 'working',
				cleanTitle: 'Title'
			});
		});

		it('does not detect working just outside the braille block (U+2900)', () => {
			expect(parseTitleActivity('⤀ Title')).toEqual({
				state: null,
				cleanTitle: '⤀ Title'
			});
		});

		it('detects idle from a U+2733 prefix', () => {
			expect(parseTitleActivity('✳ Claude Code')).toEqual({
				state: 'idle',
				cleanTitle: 'Claude Code'
			});
		});

		it('detects idle when U+2733 carries an emoji variation selector', () => {
			expect(parseTitleActivity('✳️ Claude Code')).toEqual({
				state: 'idle',
				cleanTitle: 'Claude Code'
			});
		});

		it('returns null state and the title unchanged when there is no prefix', () => {
			expect(parseTitleActivity('Plain shell title')).toEqual({
				state: null,
				cleanTitle: 'Plain shell title'
			});
		});

		it('returns null state for an empty title', () => {
			expect(parseTitleActivity('')).toEqual({ state: null, cleanTitle: '' });
		});

		it('does not treat a braille char without following whitespace as a prefix', () => {
			expect(parseTitleActivity('⠂Title')).toEqual({
				state: null,
				cleanTitle: '⠂Title'
			});
		});

		it('does not treat U+2733 without following whitespace as a prefix', () => {
			expect(parseTitleActivity('✳Title')).toEqual({
				state: null,
				cleanTitle: '✳Title'
			});
		});

		it('does not treat a bare prefix char with no trailing text as a match', () => {
			expect(parseTitleActivity('✳')).toEqual({ state: null, cleanTitle: '✳' });
		});
	});

	describe('OSC 7 (cwd)', () => {
		it('extracts path from file:// URI with host', () => {
			const result = parser.parse('\x1b]7;file://myhost/Users/me/project\x07');
			expect(result.cwd).toBe('/Users/me/project');
		});

		it('extracts path from file:// URI with empty host', () => {
			const result = parser.parse('\x1b]7;file:///Users/me/dir\x07');
			expect(result.cwd).toBe('/Users/me/dir');
		});

		it('decodes percent-encoded path segments', () => {
			const result = parser.parse('\x1b]7;file://host/Users/me/my%20dir\x07');
			expect(result.cwd).toBe('/Users/me/my dir');
		});

		it('accepts a bare absolute path', () => {
			const result = parser.parse('\x1b]7;/Users/me/bare\x07');
			expect(result.cwd).toBe('/Users/me/bare');
		});

		it('handles OSC 7 with ST terminator', () => {
			const result = parser.parse('\x1b]7;file://host/srv\x1b\\');
			expect(result.cwd).toBe('/srv');
		});

		it('returns null cwd for non-OSC-7 sequences', () => {
			expect(parser.parse('\x1b]0;Title\x07').cwd).toBeNull();
			expect(parser.parse('plain text').cwd).toBeNull();
		});

		it('tracks the latest cwd across calls via getCurrentCwd()', () => {
			parser.parse('\x1b]7;file://h/a\x07');
			parser.parse('\x1b]7;file://h/b\x07');
			expect(parser.getCurrentCwd()).toBe('/b');
		});

		it('buffers a split OSC 7 sequence', () => {
			expect(parser.parse('\x1b]7;file://host/Users/me/sp').cwd).toBeNull();
			expect(parser.parse('lit\x07').cwd).toBe('/Users/me/split');
		});
	});
});
