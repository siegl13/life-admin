#!/usr/bin/env bash

set -euo pipefail

usage() {
	cat <<'EOF'
Usage: scripts/tag-release.sh <version> <full-commit-sha>

Validate a staged release candidate, then create and push its version tag.
The script does not build or publish an image. Pushing the tag starts the
GitHub Actions release workflow.
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

if [[ "$#" -ne 2 ]]; then
	usage >&2
	exit 2
fi

VERSION="$1"
RELEASE_SHA="$2"
TAG="v${VERSION}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
	fail "Invalid release version: ${VERSION}"
fi

if [[ ! "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
	fail 'Pass the full 40-character lowercase commit SHA.'
fi

for command in git node docker; do
	if ! command -v "$command" >/dev/null 2>&1; then
		fail "Required command not found: ${command}"
	fi
done

if ! docker buildx version >/dev/null 2>&1; then
	fail 'Docker buildx is not available.'
fi

if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
	fail 'Working tree is not clean. Run the release from a clean checkout.'
fi

if ! git -C "$REPO_ROOT" cat-file -e "${RELEASE_SHA}^{commit}" 2>/dev/null; then
	fail "Commit not found locally: ${RELEASE_SHA}"
fi

if ! git -C "$REPO_ROOT" fetch origin main; then
	fail 'Could not fetch origin/main.'
fi

MAIN_SHA="$(git -C "$REPO_ROOT" rev-parse FETCH_HEAD)"
if ! git -C "$REPO_ROOT" merge-base --is-ancestor "$RELEASE_SHA" "$MAIN_SHA"; then
	fail 'Release commit is not reachable from the latest origin/main.'
fi

PACKAGE_VERSION="$(
	git -C "$REPO_ROOT" show "${RELEASE_SHA}:package.json" |
		node -e 'const fs = require("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync(0, "utf8")).version);'
)"
if [[ "$PACKAGE_VERSION" != "$VERSION" ]]; then
	fail "Tag version ${VERSION} does not match package.json version ${PACKAGE_VERSION}."
fi

LOCK_VERSION="$(
	git -C "$REPO_ROOT" show "${RELEASE_SHA}:package-lock.json" |
		node -e 'const fs = require("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync(0, "utf8")).packages[""].version);'
)"
if [[ "$LOCK_VERSION" != "$VERSION" ]]; then
	fail "Tag version ${VERSION} does not match package-lock.json version ${LOCK_VERSION}."
fi

if ! git -C "$REPO_ROOT" grep -F -q "## [${VERSION}]" "$RELEASE_SHA" -- CHANGELOG.md; then
	fail "CHANGELOG.md has no section for ${VERSION}."
fi

if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/tags/${TAG}"; then
	LOCAL_TAG_SHA="$(git -C "$REPO_ROOT" rev-parse "${TAG}^{commit}")"
	if [[ "$LOCAL_TAG_SHA" != "$RELEASE_SHA" ]]; then
		fail "Local tag ${TAG} already points to a different commit."
	fi
	LOCAL_TAG_EXISTS=true
else
	LOCAL_TAG_EXISTS=false
fi

if ! REMOTE_TAG="$(git -C "$REPO_ROOT" ls-remote --tags origin "refs/tags/${TAG}")"; then
	fail "Could not check whether ${TAG} already exists on origin."
fi
if [[ -n "$REMOTE_TAG" ]]; then
	fail "Remote tag ${TAG} already exists. Release tags are immutable."
fi

CANDIDATE_REF="ghcr.io/siegl13/life-admin-dev:git-${RELEASE_SHA:0:12}"
printf 'Checking staged candidate: %s\n' "$CANDIDATE_REF"
if ! docker buildx imagetools inspect "$CANDIDATE_REF" >/dev/null; then
	fail 'The candidate image is unavailable. Confirm GHCR access and the exact staged candidate.'
fi

printf '\nRelease version: %s\n' "$VERSION"
printf 'Release commit:  %s\n' "$RELEASE_SHA"
printf 'Candidate image: %s\n' "$CANDIDATE_REF"
printf '\nConfirm that this exact candidate passed staging acceptance.\n'
printf 'Type %s to create and push the release tag: ' "$TAG"
read -r CONFIRMATION
if [[ "$CONFIRMATION" != "$TAG" ]]; then
	fail 'Confirmation did not match. No tag was pushed.'
fi

if [[ "$LOCAL_TAG_EXISTS" == false ]]; then
	git -C "$REPO_ROOT" tag "$TAG" "$RELEASE_SHA"
fi

git -C "$REPO_ROOT" push origin "refs/tags/${TAG}"
printf '\nPushed %s. Check the Release workflow in GitHub Actions.\n' "$TAG"
