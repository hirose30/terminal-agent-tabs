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

PRIVATE_PATH_REGEX='^(doc|docs|\.specify|\.claude|\.codex|specs)(/|$)|^AGENTS\.md$|^scripts/install-v2\.sh$'
SECRET_REGEX='BEGIN [A-Z ]*PRIVATE KEY|sk-([A-Za-z0-9_-]{20,}|proj-[A-Za-z0-9_-]{20,})|github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|(AKIA|ASIA)[A-Z0-9]{16}|aws_secret|AWS_SECRET_ACCESS_KEY|password[[:space:]]*[:=][[:space:]]*[^[:space:]]'

changelog_section() {
	local version="$1"
	awk -v ver="${version}" '
		$1 == "##" && $2 == ver { found = 1; print; next }
		found && $1 == "##" { exit }
		found { print }
	' CHANGELOG.md 2>/dev/null
}

history_range() {
	local last_tag
	if git rev-parse --verify public/main >/dev/null 2>&1; then
		if git merge-base public/main HEAD >/dev/null 2>&1; then
			echo "public/main..HEAD"
		else
			warn "public/main exists but is unrelated to HEAD; scanning public/main..HEAD, but verify the public mirror manually" >&2
			echo "public/main..HEAD"
		fi
		return
	fi

	last_tag=$(git tag --sort=-v:refname | head -1)
	if [[ -n "${last_tag}" ]]; then
		warn "public/main not found; scanning ${last_tag}..HEAD instead" >&2
		echo "${last_tag}..HEAD"
	else
		warn "public/main and release tags not found; no commit-range history scan is possible" >&2
	fi
}

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
	if [[ -f resources/pty-helper.py ]] && grep -Fq "fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)" resources/pty-helper.py && grep -Fq "fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)" main.js; then
		ok "embedded pty-helper.py content sentinel in main.js"
	else
		bad "main.js is missing pty-helper.py content sentinel"
	fi
	if [[ -f resources/hook-relay.py ]] && grep -Fq "json.dumps(data)" resources/hook-relay.py && grep -Fq "json.dumps(data)" main.js; then
		ok "embedded hook-relay.py content sentinel in main.js"
	else
		bad "main.js is missing hook-relay.py content sentinel"
	fi
else
	bad "build failed:"
	tail -20 /tmp/audit-build.log | sed 's/^/       /'
fi

section "Version consistency"
MV=$(node -p "require('./manifest.json').version" 2>/dev/null || echo "")
PV=$(node -p "require('./package.json').version" 2>/dev/null || echo "")
MIN=$(node -p "require('./manifest.json').minAppVersion" 2>/dev/null || echo "")
VJSON_MIN=$(node -p "require('./versions.json')[process.argv[1]] || ''" "${MV}" 2>/dev/null || echo "")
echo "  manifest=${MV} package=${PV} minAppVersion=${MIN}"
if [[ -n "${MV}" && "${MV}" == "${PV}" ]]; then ok "manifest version == package version"; else bad "manifest (${MV}) != package (${PV})"; fi
if [[ -n "${MV}" && -n "${VJSON_MIN}" && "${VJSON_MIN}" == "${MIN}" ]]; then
	ok "versions.json maps ${MV} -> ${MIN}"
else
	bad "versions.json[${MV}] (${VJSON_MIN:-missing}) != manifest.minAppVersion (${MIN:-missing})"
fi

section "CHANGELOG"
CHANGELOG_ENTRY=$(changelog_section "${MV}")
if [[ -n "${CHANGELOG_ENTRY}" ]]; then
	ok "CHANGELOG.md has a release heading for ${MV}"
	if echo "${CHANGELOG_ENTRY}" | grep -qi 'TODO'; then
		bad "CHANGELOG.md release section for ${MV} still contains TODO"
	fi
else
	bad "CHANGELOG.md has no release heading for ${MV}"
fi

section "Files that would be published (tracked in this branch)"
git ls-files | sed 's/^/     /'
PRIV=$(git ls-files | grep -E "${PRIVATE_PATH_REGEX}" || true)
if [[ -n "${PRIV}" ]]; then
	bad "private/dev files are tracked (should be gitignored):"
	echo "${PRIV}" | sed 's/^/       /'
else
	ok "no private/dev-category files tracked"
fi

section "Commit history scan (changes that would become public)"
RANGE=$(history_range)
if [[ -n "${RANGE}" ]]; then
	echo "  range: ${RANGE}"
	HIST_PRIV=$(git log --diff-filter=A --name-only --format='' "${RANGE}" -- 2>/dev/null | sed '/^$/d' | sort -u | grep -E "${PRIVATE_PATH_REGEX}" || true)
	if [[ -n "${HIST_PRIV}" ]]; then
		bad "private/dev paths were added in ${RANGE}:"
		echo "${HIST_PRIV}" | sed 's/^/       /'
	else
		ok "no private/dev path additions in ${RANGE}"
	fi

	if command -v gitleaks >/dev/null 2>&1; then
		if gitleaks detect --source . --redact --log-opts "${RANGE}" >/tmp/audit-gitleaks.log 2>&1; then
			ok "gitleaks found no secrets in ${RANGE}"
		else
			bad "gitleaks reported potential secrets in ${RANGE}:"
			tail -40 /tmp/audit-gitleaks.log | sed 's/^/       /'
		fi
	elif command -v trufflehog >/dev/null 2>&1; then
		warn "trufflehog detected; using built-in git patch scan for deterministic local output"
	fi

	HIST_SECRETS=$(git log -p --no-ext-diff --no-color "${RANGE}" -- . ':!package-lock.json' ':!*.test.*' ':!scripts/audit-release.sh' 2>/dev/null | grep -E "${SECRET_REGEX}" || true)
	if [[ -n "${HIST_SECRETS}" ]]; then
		bad "potential secrets in commit history range ${RANGE}:"
		echo "${HIST_SECRETS}" | sed 's/^/       /'
	else
		ok "built-in patch scan found no high-signal secrets in ${RANGE}"
	fi
fi

section "Secret / sensitive scan (tracked files)"
HITS=$(git grep -nIiE "${SECRET_REGEX}" \
	-- . ':!package-lock.json' ':!*.test.*' ':!scripts/audit-release.sh' 2>/dev/null || true)
if [[ -n "${HITS}" ]]; then
	bad "potential secrets in tracked files — review:"
	echo "${HITS}" | sed 's/^/       /'
else
	ok "no high-signal secrets found"
fi
SOFT=$(git grep -nIiE '/Users/[A-Za-z0-9._-]+/|@fout\.jp|takamasa\.hirose' -- . ':!package-lock.json' ':!*.test.*' ':!scripts/audit-release.sh' 2>/dev/null || true)
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
