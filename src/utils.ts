/**
 * Shared utility functions.
 */

/** Normalize a CLI profile ID to lowercase alphanumeric with dashes/underscores. */
export function normalizeCliId(value: string): string {
	const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-');
	return normalized || 'cli';
}

/**
 * Strip terminal private-mode toggles (CSI ? … h/l) from a string — e.g. alt-screen
 * (`?1049h`), cursor visibility (`?25l`), mouse tracking (`?1000h`), bracketed paste
 * (`?2004h`). Used to sanitize persisted scrollback before repainting it on restore so a
 * replayed dump can never leave the terminal stuck in a broken mode (Phase 4 hardening).
 * Visible content (text, colors/SGR, cursor moves) is preserved.
 */
export function stripPrivateModeSequences(value: string): string {
	// eslint-disable-next-line no-control-regex -- matching the ESC control byte is required
	return value.replace(/\x1b\[\?[0-9;]*[hl]/g, '');
}
