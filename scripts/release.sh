#!/bin/bash
# One-shot release script.
# Usage: ./scripts/release.sh <new-version>
#   e.g. ./scripts/release.sh 1.0.1
#
# What it does:
#   1. Bumps version in manifest.json, package.json, versions.json
#   2. Runs npm run build
#   3. git commit + tag
#   4. Pushes main + tag to origin (private) and public
#   5. Creates a GitHub release on the public repo with build artifacts attached
#
# Requirements: gh CLI authenticated for hirose30/terminal-agent-tabs.

set -euo pipefail

NEW_VERSION="${1:-}"
if [[ -z "${NEW_VERSION}" ]]; then
	echo "Usage: $0 <new-version>" >&2
	exit 1
fi

if ! [[ "${NEW_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
	echo "Error: version must be semver X.Y.Z (got: ${NEW_VERSION})" >&2
	exit 1
fi

cd "$(dirname "$0")/.."

# Sanity: clean working tree, on main branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "${BRANCH}" != "main" ]]; then
	echo "Error: must release from main branch (currently on ${BRANCH})" >&2
	exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
	echo "Error: working tree not clean" >&2
	git status --short
	exit 1
fi

CURRENT_VERSION=$(node -p "require('./manifest.json').version")
MIN_APP_VERSION=$(node -p "require('./manifest.json').minAppVersion")
echo "Bumping ${CURRENT_VERSION} -> ${NEW_VERSION} (minAppVersion=${MIN_APP_VERSION})"

# 1. Update manifest.json
node -e "
const fs = require('fs');
const m = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
m.version = '${NEW_VERSION}';
fs.writeFileSync('manifest.json', JSON.stringify(m, null, '\t') + '\n');
"

# 2. Update package.json
node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
p.version = '${NEW_VERSION}';
fs.writeFileSync('package.json', JSON.stringify(p, null, '\t') + '\n');
"

# 3. Update versions.json
node -e "
const fs = require('fs');
const v = JSON.parse(fs.readFileSync('versions.json', 'utf8'));
v['${NEW_VERSION}'] = '${MIN_APP_VERSION}';
fs.writeFileSync('versions.json', JSON.stringify(v, null, '\t') + '\n');
"

# 4. Build
echo "Building..."
npm run build

# 5. Verify build outputs exist
for f in main.js manifest.json styles.css; do
	if [[ ! -f "${f}" ]]; then
		echo "Error: missing release asset: ${f}" >&2
		exit 1
	fi
done

# 6. Commit & tag
git add manifest.json package.json versions.json
git commit -m "chore: release ${NEW_VERSION}"
git tag "${NEW_VERSION}"

# 7. Push to both remotes
echo "Pushing to origin..."
git push origin main "${NEW_VERSION}"
echo "Pushing to public..."
git push public main "${NEW_VERSION}"

# 8. Create GitHub release on public repo
# Note: pty-helper.py and hook-relay.py are NOT attached. They are bundled
# into main.js by esbuild and extracted by EmbeddedResources at plugin load,
# so the release ships the same three files the Obsidian community installer
# would deploy.
echo "Creating GitHub release..."
gh release create "${NEW_VERSION}" \
	--repo hirose30/terminal-agent-tabs \
	--title "${NEW_VERSION}" \
	--notes "See CHANGELOG.md for details." \
	main.js \
	manifest.json \
	styles.css

echo ""
echo "Done! Release ${NEW_VERSION} published."
echo "  https://github.com/hirose30/terminal-agent-tabs/releases/tag/${NEW_VERSION}"
