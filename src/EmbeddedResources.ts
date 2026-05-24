import * as fs from 'fs';
import * as path from 'path';
import ptyHelperSource from '../resources/pty-helper.py';
import hookRelaySource from '../resources/hook-relay.py';

interface EmbeddedFile {
	name: string;
	content: string;
	mode: number;
}

const EMBEDDED_FILES: EmbeddedFile[] = [
	{ name: 'pty-helper.py', content: ptyHelperSource, mode: 0o755 },
	{ name: 'hook-relay.py', content: hookRelaySource, mode: 0o755 }
];

/**
 * Write the bundled Python helper scripts to <pluginDir>/resources/.
 * Idempotent: if the on-disk content already matches the embedded version,
 * the file is left untouched.
 *
 * Obsidian community plugin distribution only ships main.js/manifest.json/styles.css,
 * so without this the runtime helpers would be missing on a fresh install.
 */
export function ensureEmbeddedResources(pluginDir: string): void {
	const resourcesDir = path.join(pluginDir, 'resources');
	fs.mkdirSync(resourcesDir, { recursive: true });

	for (const file of EMBEDDED_FILES) {
		const target = path.join(resourcesDir, file.name);
		writeIfDifferent(target, file.content, file.mode);
	}
}

function writeIfDifferent(target: string, content: string, mode: number): void {
	let existing: string | null = null;
	try {
		existing = fs.readFileSync(target, 'utf8');
	} catch {
		existing = null;
	}

	if (existing !== content) {
		fs.writeFileSync(target, content, { mode });
	}

	try {
		fs.chmodSync(target, mode);
	} catch {
		// chmod is best-effort; some filesystems (e.g. cloud sync) may reject it
	}
}
