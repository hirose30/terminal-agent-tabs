/**
 * OSC (Operating System Command) Escape Sequence Parser
 *
 * Parses OSC sequences from terminal data stream to extract title/status information.
 *
 * Common OSC sequences:
 * - OSC 0: Set Icon Name and Window Title: \x1b]0;title\x07 or \x1b]0;title\x1b\\
 * - OSC 1: Set Icon Name: \x1b]1;icon\x07
 * - OSC 2: Set Window Title: \x1b]2;title\x07
 * - OSC 7: Report current working directory: \x1b]7;file://host/path\x07 (Phase 3 live cwd)
 */

import type { AgentActivityState } from './types';

export interface TitleActivity {
	/** Activity encoded in the title prefix, or null when no prefix was recognized. */
	state: Exclude<AgentActivityState, 'unknown'> | null;
	/** Title with the activity prefix and following whitespace removed. */
	cleanTitle: string;
}

/**
 * Extract the agent activity encoded in an OSC window title.
 *
 * Claude Code prefixes its titles with a spinner glyph while a turn is in
 * progress and with U+2733 when waiting (idle or showing a prompt):
 * - Braille pattern (U+2800..U+28FF) + whitespace -> working
 * - U+2733 (optionally with U+FE0F) + whitespace -> idle
 * - anything else -> state null, title returned as-is (other CLIs set plain
 *   titles; those must not flip the state)
 */
export function parseTitleActivity(title: string): TitleActivity {
	const working = title.match(/^[\u2800-\u28FF]\s+(.*)$/);
	if (working) {
		return { state: 'working', cleanTitle: working[1] };
	}
	const idle = title.match(/^\u2733\uFE0F?\s+(.*)$/);
	if (idle) {
		return { state: 'idle', cleanTitle: idle[1] };
	}
	return { state: null, cleanTitle: title };
}

export interface OscParseResult {
	/** Extracted title (if any) */
	title: string | null;
	/** Current working directory reported via OSC 7 (if any) */
	cwd: string | null;
	/** Data with OSC sequences preserved (for terminal display) */
	data: string;
}

export class OscParser {
	private buffer: string = '';
	private currentTitle: string | null = null;
	private currentCwd: string | null = null;

	/**
	 * Parse data for OSC sequences and extract title
	 * @param data Raw terminal data
	 * @returns Parse result with extracted title and original data
	 */
	parse(data: string): OscParseResult {
		// Combine with any leftover buffer from previous parse
		const combined = this.buffer + data;
		this.buffer = '';

		let title: string | null = null;
		let cwd: string | null = null;

		// OSC sequence pattern:
		// \x1b] followed by number, semicolon, text, and terminated by BEL (\x07) or ST (\x1b\\)
		// Pattern matches: ESC ] <number> ; <text> <terminator>
		// Extended to match OSC 0-9 (includes OSC 9 for notifications)
		// eslint-disable-next-line no-control-regex -- OSC sequences require control character literals (\x1b ESC, \x07 BEL)
		const oscPattern = /\x1b\](\d+);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;

		let match;
		while ((match = oscPattern.exec(combined)) !== null) {
			const oscType = match[1];
			const oscValue = match[2];

			// OSC 0: Set both icon name and window title
			// OSC 1: Set icon name only (we'll use it as title too)
			// OSC 2: Set window title
			// OSC 9: Notification (may contain status info)
			if (oscType === '0' || oscType === '1' || oscType === '2' || oscType === '9') {
				title = oscValue;
				this.currentTitle = oscValue;
			} else if (oscType === '7') {
				// OSC 7: shell reports its current directory as a file:// URI.
				const parsed = this.parseOsc7Path(oscValue);
				if (parsed) {
					cwd = parsed;
					this.currentCwd = parsed;
				}
			}
		}

		// Check for incomplete OSC sequence at the end
		// If we have an ESC ] but no terminator, buffer it for next parse
		// eslint-disable-next-line no-control-regex -- OSC sequences require control character literals (\x1b ESC, \x07 BEL)
		const incompleteOscMatch = combined.match(/\x1b\]\d+;[^\x07\x1b]*$/);
		if (incompleteOscMatch) {
			this.buffer = incompleteOscMatch[0];
		}

		return {
			title,
			cwd,
			data  // Return original data unchanged for terminal display
		};
	}

	/**
	 * Parse an OSC 7 payload (`file://host/path`, or a bare absolute path) into a
	 * filesystem path. Returns null when it cannot be interpreted.
	 */
	private parseOsc7Path(value: string): string | null {
		const v = value.trim();
		if (!v) return null;
		const fileUri = v.match(/^file:\/\/[^/]*(\/.*)$/i);
		const raw = fileUri ? fileUri[1] : (v.startsWith('/') ? v : null);
		if (!raw) return null;
		try {
			return decodeURIComponent(raw);
		} catch {
			return raw;
		}
	}

	/**
	 * Get the current (last parsed) title
	 */
	getCurrentTitle(): string | null {
		return this.currentTitle;
	}

	/**
	 * Get the current (last parsed) working directory from OSC 7
	 */
	getCurrentCwd(): string | null {
		return this.currentCwd;
	}

	/**
	 * Reset the parser state
	 */
	reset(): void {
		this.buffer = '';
		this.currentTitle = null;
		this.currentCwd = null;
	}
}
