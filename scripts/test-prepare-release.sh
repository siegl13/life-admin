#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

REMOTE="$TEMP_DIR/remote.git"
TEST_REPO="$TEMP_DIR/repo"
VERSION="0.1.0-beta.2"
RELEASE_BRANCH="release/${VERSION}"

mkdir -p "$TEST_REPO/scripts"
cp "$REPO_ROOT/scripts/prepare-release.sh" "$TEST_REPO/scripts/prepare-release.sh"
chmod +x "$TEST_REPO/scripts/prepare-release.sh"

git init --bare --initial-branch=main "$REMOTE" >/dev/null
git init --initial-branch=main "$TEST_REPO" >/dev/null
git -C "$TEST_REPO" config user.name "Release Preparation Test"
git -C "$TEST_REPO" config user.email "release-preparation-test@example.invalid"

printf '{"name":"life-admin","version":"0.1.0-beta.1"}\n' > "$TEST_REPO/package.json"
printf '{"name":"life-admin","version":"0.1.0-beta.1","lockfileVersion":3,"packages":{"":{"version":"0.1.0-beta.1"}}}\n' > "$TEST_REPO/package-lock.json"
printf '# Changelog\n' > "$TEST_REPO/CHANGELOG.md"

git -C "$TEST_REPO" add package.json package-lock.json CHANGELOG.md scripts/prepare-release.sh
git -C "$TEST_REPO" commit -m "Create test repository" >/dev/null
git -C "$TEST_REPO" remote add origin "$REMOTE"
git -C "$TEST_REPO" push --quiet --set-upstream origin main
git -C "$TEST_REPO" switch -c test/work >/dev/null

if "$TEST_REPO/scripts/prepare-release.sh" 0.1 </dev/null; then
	printf 'Expected an invalid version to fail.\n' >&2
	exit 1
fi
if [[ "$(git -C "$TEST_REPO" branch --show-current)" != test/work ]]; then
	printf 'Invalid version changed the current branch.\n' >&2
	exit 1
fi

OUTPUT="$(cd "$TEST_REPO" && scripts/prepare-release.sh "$VERSION")"
printf '%s\n' "$OUTPUT"

if [[ "$(git -C "$TEST_REPO" branch --show-current)" != "$RELEASE_BRANCH" ]]; then
	printf 'The release branch was not created.\n' >&2
	exit 1
fi

PACKAGE_VERSION="$(node -p "require('${TEST_REPO}/package.json').version")"
LOCK_VERSION="$(node -p "require('${TEST_REPO}/package-lock.json').packages[''].version")"
if [[ "$PACKAGE_VERSION" != "$VERSION" || "$LOCK_VERSION" != "$VERSION" ]]; then
	printf 'The package versions were not updated consistently.\n' >&2
	exit 1
fi

if [[ -n "$(git -C "$TEST_REPO" ls-remote --heads origin "refs/heads/${RELEASE_BRANCH}")" ]]; then
	printf 'The preparation helper pushed the release branch unexpectedly.\n' >&2
	exit 1
fi
if [[ -n "$(git -C "$TEST_REPO" tag --list)" ]]; then
	printf 'The preparation helper created a tag unexpectedly.\n' >&2
	exit 1
fi

printf 'Release preparation helper tests passed.\n'
