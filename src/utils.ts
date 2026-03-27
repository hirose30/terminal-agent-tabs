/**
 * Shared utility functions.
 */

/** Normalize a CLI profile ID to lowercase alphanumeric with dashes/underscores. */
export function normalizeCliId(value: string): string {
	const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-');
	return normalized || 'cli';
}
