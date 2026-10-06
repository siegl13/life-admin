#!/usr/bin/env bash

set -euo pipefail

usage() {
	cat <<'EOF'
Usage: scripts/prepare-release.sh <version>

Update local main, create release/<version>, and update package.json and
package-lock.json. The script does not edit the changelog, commit, push, or
open a pull request.
EOF
}

fail() {
	printf 'Error: %s\n' "$1" >&2
	exit 1
}

if [[ "${1:-}" == "--help" ]]; then
	usage
	exit 0
fi

if [[ "$#" -ne 1 ]]; then
	usage >&2
	exit 2
fi

VERSION="$1"
RELEASE_BRANCH="release/${VERSION}"
TAG="v${VERSION}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
	fail "Invalid release version: ${VERSION}"
fi

for command in git npm; do
	if ! command -v "$command" >/dev/null 2>&1; then
		fail "Required command not found: ${command}"
	fi
done

if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
	fail 'Working tree is not clean. Commit or move local changes before preparing a release.'
fi

if ! git -C "$REPO_ROOT" show-ref --verify --quiet refs/heads/main; then
	fail 'Local main branch is missing. Create it from origin/main first.'
fi

if [[ "$PWD" != "$REPO_ROOT" ]]; then
	fail "Run this script from the repository root: ${REPO_ROOT}"
fi

if ! git -C "$REPO_ROOT" fetch origin main:refs/remotes/origin/main; then
	fail 'Could not fetch origin/main.'
fi

if ! git -C "$REPO_ROOT" switch main; then
	fail 'Could not switch to main. Check whether it is already checked out in another worktree.'
fi

if ! git -C "$REPO_ROOT" pull --ff-only origin main; then
	fail 'Could not fast-forward local main to origin/main.'
fi

LOCAL_MAIN_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
REMOTE_MAIN_SHA="$(git -C "$REPO_ROOT" rev-parse refs/remotes/origin/main)"
if [[ "$LOCAL_MAIN_SHA" != "$REMOTE_MAIN_SHA" ]]; then
	fail 'Local main has commits that are not on origin/main. Resolve this before preparing a release.'
fi

if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/${RELEASE_BRANCH}"; then
	fail "Local release branch already exists: ${RELEASE_BRANCH}"
fi

if ! REMOTE_BRANCH="$(git -C "$REPO_ROOT" ls-remote --heads origin "refs/heads/${RELEASE_BRANCH}")"; then
	fail "Could not check whether ${RELEASE_BRANCH} already exists on origin."
fi
if [[ -n "$REMOTE_BRANCH" ]]; then
	fail "Remote release branch already exists: ${RELEASE_BRANCH}"
fi

if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/tags/${TAG}"; then
	fail "Local release tag already exists: ${TAG}"
fi

if ! REMOTE_TAG="$(git -C "$REPO_ROOT" ls-remote --tags origin "refs/tags/${TAG}")"; then
	fail "Could not check whether ${TAG} already exists on origin."
fi
if [[ -n "$REMOTE_TAG" ]]; then
	fail "Remote release tag already exists: ${TAG}"
fi

CURRENT_VERSION="$(node -p "require('${REPO_ROOT}/package.json').version")"
if [[ "$CURRENT_VERSION" == "$VERSION" ]]; then
	fail "Version ${VERSION} is already set in package.json."
fi

git -C "$REPO_ROOT" switch -c "$RELEASE_BRANCH"
npm --prefix "$REPO_ROOT" version "$VERSION" --no-git-tag-version

PACKAGE_VERSION="$(node -p "require('${REPO_ROOT}/package.json').version")"
LOCK_VERSION="$(node -p "require('${REPO_ROOT}/package-lock.json').packages[''].version")"
if [[ "$PACKAGE_VERSION" != "$VERSION" || "$LOCK_VERSION" != "$VERSION" ]]; then
	fail 'npm version did not update package.json and package-lock.json consistently.'
fi

printf '\nRelease branch ready: %s\n' "$RELEASE_BRANCH"
printf 'Version: %s\n' "$VERSION"
printf 'Changelog: %s/CHANGELOG.md\n' "$REPO_ROOT"
printf '\nNext steps:\n'
printf '1. Add a dated %s section to CHANGELOG.md with user-facing changes.\n' "$VERSION"
printf '2. Run: npm run verify && npm run test:e2e\n'
printf '3. Review: git diff --check && git status --short\n'
printf '4. Commit: git add package.json package-lock.json CHANGELOG.md && git commit -m "Prepare release %s"\n' "$TAG"
printf '5. Push: git push --set-upstream origin %s\n' "$RELEASE_BRANCH"
printf '6. Open a PR: gh pr create --base main --title "Prepare release %s"\n' "$TAG"
printf '7. Merge only after CI and review pass.\n'
printf 'Do not tag or deploy until the post-merge candidate is accepted on staging.\n'
