#!/bin/bash
# Publish a prepared release to the PUBLIC repo (hirose30/terminal-agent-tabs).
# See doc/issues/008-release-audit-flow.md and RELEASING.md.
#
# This is the PUBLISH step only — it does NOT bump the version. The version bump
# + CHANGELOG happen earlier on a release/<ver> branch via prepare-release.sh and
# are merged to main via PR. By the time you run this on main, manifest.version
# must already equal <ver>.
#
# What it does:
#   1. Sanity: on main, clean tree, manifest.version == <ver>
#   2. Runs scripts/audit-release.sh — ABORTS if the audit fails
#   3. git tag <ver>
#   4. Pushes main + tag to origin (private) and public
#   5. Creates a GitHub release on the public repo with the 3 built artifacts
#
# Requirements: gh CLI authenticated for hirose30/terminal-agent-tabs.
# Usage: ./scripts/release.sh <X.Y.Z>

set -euo pipefail
cd "$(dirname "$0")/.."

NEW_VERSION="${1:-}"
if [[ -z "${NEW_VERSION}" ]]; then
	echo "Usage: $0 <version>  (the version already bumped on main by prepare-release.sh)" >&2
	exit 1
fi
if ! [[ "${NEW_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
	echo "Error: version must be semver X.Y.Z (got: ${NEW_VERSION})" >&2
	exit 1
fi

# Sanity: on main, clean tree
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "${BRANCH}" != "main" ]]; then
	echo "Error: must publish from main branch (currently on ${BRANCH})" >&2
	exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
	echo "Error: working tree not clean" >&2
	git status --short
	exit 1
fi

# Version must already be bumped (by prepare-release.sh, merged via PR).
MANIFEST_VERSION=$(node -p "require('./manifest.json').version")
if [[ "${MANIFEST_VERSION}" != "${NEW_VERSION}" ]]; then
	echo "Error: manifest.json version is ${MANIFEST_VERSION}, expected ${NEW_VERSION}." >&2
	echo "  Bump it first on a release branch: ./scripts/prepare-release.sh ${NEW_VERSION}" >&2
	exit 1
fi
if git rev-parse "${NEW_VERSION}" >/dev/null 2>&1; then
	echo "Error: tag ${NEW_VERSION} already exists." >&2
	exit 1
fi

# 1. Audit gate — must pass before anything is pushed.
echo "Running release audit..."
if ! ./scripts/audit-release.sh; then
	echo "" >&2
	echo "Error: release audit FAILED — nothing pushed. Fix the issues above and retry." >&2
	exit 1
fi

# 2. Tag (HEAD already carries the bumped version, merged via the release PR).
git tag "${NEW_VERSION}"

# 3. Push to both remotes.
echo "Pushing to origin..."
git push origin main "${NEW_VERSION}"
echo "Pushing to public..."
git push public main "${NEW_VERSION}"

# 4. Create GitHub release on the public repo.
# Note: pty-helper.py and hook-relay.py are NOT attached. They are bundled into
# main.js by esbuild and extracted by EmbeddedResources at plugin load, so the
# release ships the same three files the Obsidian community installer deploys.
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
