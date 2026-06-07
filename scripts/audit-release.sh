#!/bin/bash
# Pre-release audit gate for the PUBLIC release (hirose30/terminal-agent-tabs).
# See doc/issues/008-release-audit-flow.md and RELEASING.md.
#
# Read-only verification that the repo is safe to publish: runs the checks the
# Obsidian community-plugin bot + a human reviewer would, plus a scan of exactly
# which files would become public. The only side effect is a build (which writes
# the gitignored main.js); it never commits, tags, or pushes.
#
# Exit code: 0 = PASS (safe to publish), non-zero = FAIL (do not publish).
# Usage: ./scripts/audit-release.sh

set -uo pipefail
cd "$(dirname "$0")/.."

FAIL=0
ok()      { echo "  [ok]   $*"; }
warn()    { echo "  [warn] $*"; }
bad()     { echo "  [FAIL] $*"; FAIL=1; }
section() { echo; echo "== $* =="; }

section "Git state"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "  branch: ${BRANCH}"
if [[ -n "$(git status --porcelain)" ]]; then
	bad "working tree is not clean (publish requires a clean tree)"
	git status --short | sed 's/^/       /'
else
	ok "working tree clean"
fi

section "Lint (eslint-plugin-obsidianmd — Obsidian review-bot check)"
if npx eslint src/ >/tmp/audit-eslint.log 2>&1; then
	ok "eslint clean"
else
	bad "eslint reported errors:"
	sed 's/^/       /' /tmp/audit-eslint.log
fi

section "Unit tests"
if npm test >/tmp/audit-test.log 2>&1; then
	ok "$(grep -Eo 'Tests +[0-9]+ passed[^)]*' /tmp/audit-test.log | tail -1 || echo 'tests pass')"
else
	bad "tests failed:"
	tail -20 /tmp/audit-test.log | sed 's/^/       /'
fi

section "Build + the 3 published files"
if npm run build >/tmp/audit-build.log 2>&1; then
	for f in main.js manifest.json styles.css; do
		if [[ -s "${f}" ]]; then ok "${f} present ($(wc -c < "${f}" | tr -d ' ') bytes)"; else bad "missing or empty: ${f}"; fi
	done
	for helper in pty-helper hook-relay; do
		if grep -q "${helper}" main.js; then ok "embedded ${helper}.py in main.js"; else bad "main.js is missing embedded ${helper}.py"; fi
	done
else
	bad "build failed:"
	tail -20 /tmp/audit-build.log | sed 's/^/       /'
fi

section "Version consistency"
MV=$(node -p "require('./manifest.json').version" 2>/dev/null || echo "")
PV=$(node -p "require('./package.json').version" 2>/dev/null || echo "")
MIN=$(node -p "require('./manifest.json').minAppVersion" 2>/dev/null || echo "")
echo "  manifest=${MV} package=${PV} minAppVersion=${MIN}"
if [[ -n "${MV}" && "${MV}" == "${PV}" ]]; then ok "manifest version == package version"; else bad "manifest (${MV}) != package (${PV})"; fi
if [[ -n "${MV}" ]] && node -e "process.exit(require('./versions.json')['${MV}']?0:1)" 2>/dev/null; then
	ok "versions.json maps ${MV} -> minAppVersion"
else
	bad "versions.json has no entry for ${MV}"
fi

section "CHANGELOG"
if [[ -n "${MV}" ]] && grep -q "${MV}" CHANGELOG.md 2>/dev/null; then
	ok "CHANGELOG.md has an entry mentioning ${MV}"
else
	bad "CHANGELOG.md has no entry for ${MV}"
fi

section "Files that would be published (tracked in this branch)"
git ls-files | sed 's/^/     /'
PRIV=$(git ls-files | grep -E '^(doc|docs|\.specify|\.claude|\.codex|specs)/|^AGENTS\.md$|^scripts/install-v2\.sh$' || true)
if [[ -n "${PRIV}" ]]; then
	bad "private/dev files are tracked (should be gitignored):"
	echo "${PRIV}" | sed 's/^/       /'
else
	ok "no private/dev-category files tracked"
fi

section "Secret / sensitive scan (tracked files)"
HITS=$(git grep -nIiE 'BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|aws_secret|password[[:space:]]*[:=][[:space:]]*[^[:space:]]' \
	-- . ':!package-lock.json' ':!*.test.*' ':!scripts/audit-release.sh' 2>/dev/null || true)
if [[ -n "${HITS}" ]]; then
	bad "potential secrets in tracked files — review:"
	echo "${HITS}" | sed 's/^/       /'
else
	ok "no high-signal secrets found"
fi
SOFT=$(git grep -nIiE '/Users/[A-Za-z0-9._-]+/|@fout\.jp|takamasa\.hirose' -- src/ scripts/ ':!*.test.*' ':!scripts/audit-release.sh' 2>/dev/null || true)
if [[ -n "${SOFT}" ]]; then
	warn "absolute home paths / personal identifiers in tracked source (review; not blocking):"
	echo "${SOFT}" | sed 's/^/       /'
fi

section "Dependency changes since last release tag"
LAST=$(git tag --sort=-v:refname | head -1)
if [[ -n "${LAST}" ]]; then
	echo "  vs ${LAST}:"
	CHG=$(git diff "${LAST}"..HEAD -- package.json 2>/dev/null | grep -E '^[+-][[:space:]]*"[^"]+"[[:space:]]*:[[:space:]]*"\^?[~0-9]' || true)
	if [[ -n "${CHG}" ]]; then echo "${CHG}" | sed 's/^/     /'; else echo "     (no dependency line changes)"; fi
else
	echo "  (no prior release tag)"
fi

echo
if [[ "${FAIL}" -ne 0 ]]; then
	echo "AUDIT: FAIL — not safe to publish. Fix the items marked [FAIL] above."
	exit 1
fi
echo "AUDIT: PASS — safe to publish ${MV}."
