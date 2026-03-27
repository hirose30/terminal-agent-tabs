/**
 * OSC (Operating System Command) Escape Sequence Parser
 *
 * Parses OSC sequences from terminal data stream to extract title/status information.
 *
 * Common OSC sequences:
 * - OSC 0: Set Icon Name and Window Title: \x1b]0;title\x07 or \x1b]0;title\x1b\\
 * - OSC 1: Set Icon Name: \x1b]1;icon\x07
 * - OSC 2: Set Window Title: \x1b]2;title\x07
 */

export interface OscParseResult {
	/** Extracted title (if any) */
	title: string | null;
	/** Data with OSC sequences preserved (for terminal display) */
	data: string;
}

export class OscParser {
	private buffer: string = '';
	private currentTitle: string | null = null;

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

		// OSC sequence pattern:
		// \x1b] followed by number, semicolon, text, and terminated by BEL (\x07) or ST (\x1b\\)
		// Pattern matches: ESC ] <number> ; <text> <terminator>
		// Extended to match OSC 0-9 (includes OSC 9 for notifications)
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
			}
		}

		// Check for incomplete OSC sequence at the end
		// If we have an ESC ] but no terminator, buffer it for next parse
		const incompleteOscMatch = combined.match(/\x1b\]\d+;[^\x07\x1b]*$/);
		if (incompleteOscMatch) {
			this.buffer = incompleteOscMatch[0];
		}

		return {
			title,
			data  // Return original data unchanged for terminal display
		};
	}

	/**
	 * Get the current (last parsed) title
	 */
	getCurrentTitle(): string | null {
		return this.currentTitle;
	}

	/**
	 * Reset the parser state
	 */
	reset(): void {
		this.buffer = '';
		this.currentTitle = null;
	}
}
