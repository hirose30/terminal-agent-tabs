#!/bin/bash
# Prepare a release on a dedicated release/<ver> branch.
# See doc/issues/008-release-audit-flow.md and RELEASING.md.
#
# What it does (writes only — no commit/tag/push):
#   1. Validates semver and that you are NOT on main
#   2. Bumps version in manifest.json, package.json, versions.json
#   3. Inserts a CHANGELOG.md stub entry for the new version
#
# After running: finalize CHANGELOG.md, run ./scripts/audit-release.sh, then
# commit and open a PR (release/<ver> -> main). Publishing happens later via
# ./scripts/release.sh <ver> on main.
#
# Usage: ./scripts/release-flow/prepare-release.sh <X.Y.Z>  (or scripts/prepare-release.sh)

set -euo pipefail
cd "$(dirname "$0")/.."

NEW_VERSION="${1:-}"
if [[ -z "${NEW_VERSION}" ]]; then
	echo "Usage: $0 <new-version>" >&2
	exit 1
fi
if ! [[ "${NEW_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
	echo "Error: version must be semver X.Y.Z (got: ${NEW_VERSION})" >&2
	exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "${BRANCH}" == "main" ]]; then
	echo "Error: prepare a release on a dedicated branch, not main." >&2
	echo "  git checkout -b release/${NEW_VERSION}" >&2
	exit 1
fi

CURRENT_VERSION=$(node -p "require('./manifest.json').version")
MIN_APP_VERSION=$(node -p "require('./manifest.json').minAppVersion")
echo "Bumping ${CURRENT_VERSION} -> ${NEW_VERSION} (minAppVersion=${MIN_APP_VERSION}) on ${BRANCH}"

# 1. manifest.json
node -e "
const fs = require('fs');
const m = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
m.version = '${NEW_VERSION}';
fs.writeFileSync('manifest.json', JSON.stringify(m, null, '\t') + '\n');
"

# 2. package.json
node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
p.version = '${NEW_VERSION}';
fs.writeFileSync('package.json', JSON.stringify(p, null, '\t') + '\n');
"

# 3. versions.json
node -e "
const fs = require('fs');
const v = JSON.parse(fs.readFileSync('versions.json', 'utf8'));
v['${NEW_VERSION}'] = '${MIN_APP_VERSION}';
fs.writeFileSync('versions.json', JSON.stringify(v, null, '\t') + '\n');
"

# 4. CHANGELOG.md stub (insert after the first heading line if not already present)
if awk -v ver="${NEW_VERSION}" '$1 == "##" && $2 == ver { found = 1 } END { exit found ? 0 : 1 }' CHANGELOG.md 2>/dev/null; then
	echo "CHANGELOG.md already mentions ${NEW_VERSION}; leaving it untouched."
else
	TODAY=$(date +%Y-%m-%d)
	node -e "
const fs = require('fs');
const path = 'CHANGELOG.md';
const body = fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '# Changelog\n';
const lines = body.split('\n');
const stub = ['## ${NEW_VERSION} - ${TODAY}', '', '- TODO: describe changes for ${NEW_VERSION}', ''];
// Insert after the first top-level heading, else prepend.
let idx = lines.findIndex((l) => /^#\s/.test(l));
if (idx < 0) { lines.unshift('# Changelog', ''); idx = 0; }
lines.splice(idx + 1, 0, '', ...stub);
fs.writeFileSync(path, lines.join('\n'));
"
	echo "Inserted CHANGELOG.md stub for ${NEW_VERSION} — please fill it in."
fi

echo ""
echo "Done. Next:"
echo "  1. Edit CHANGELOG.md (replace the TODO for ${NEW_VERSION})."
echo "  2. ./scripts/audit-release.sh   # must PASS"
echo "  3. git add -A && git commit -m \"chore: prepare release ${NEW_VERSION}\""
echo "  4. Open a PR: ${BRANCH} -> main, review, merge."
echo "  5. On main: ./scripts/release.sh ${NEW_VERSION}   # re-audits, then publishes."
