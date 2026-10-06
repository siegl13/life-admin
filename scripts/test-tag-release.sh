#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

REMOTE="$TEMP_DIR/remote.git"
TEST_REPO="$TEMP_DIR/repo"
FAKE_BIN="$TEMP_DIR/bin"
VERSION="0.1.0-beta.2"
TAG="v${VERSION}"

mkdir -p "$TEST_REPO/scripts" "$FAKE_BIN"
cp "$REPO_ROOT/scripts/tag-release.sh" "$TEST_REPO/scripts/tag-release.sh"
chmod +x "$TEST_REPO/scripts/tag-release.sh"

git init --bare --initial-branch=main "$REMOTE" >/dev/null
git init --initial-branch=main "$TEST_REPO" >/dev/null
git -C "$TEST_REPO" config user.name "Release Helper Test"
git -C "$TEST_REPO" config user.email "release-helper-test@example.invalid"

printf '{"name":"life-admin","version":"%s","type":"module"}\n' "$VERSION" > "$TEST_REPO/package.json"
printf '{"name":"life-admin","lockfileVersion":3,"packages":{"":{"version":"%s"}}}\n' "$VERSION" > "$TEST_REPO/package-lock.json"
printf '# Changelog\n\n## [%s] - 2026-10-04\n' "$VERSION" > "$TEST_REPO/CHANGELOG.md"

git -C "$TEST_REPO" add package.json package-lock.json CHANGELOG.md scripts/tag-release.sh
git -C "$TEST_REPO" commit -m "Prepare test release" >/dev/null
git -C "$TEST_REPO" remote add origin "$REMOTE"
git -C "$TEST_REPO" push --quiet --set-upstream origin main

RELEASE_SHA="$(git -C "$TEST_REPO" rev-parse HEAD)"
CANDIDATE_REF="ghcr.io/siegl13/life-admin-dev:git-${RELEASE_SHA:0:12}"

cat > "$FAKE_BIN/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$*" == "buildx version" ]]; then
	exit 0
fi

if [[ "$1" == "buildx" && "$2" == "imagetools" && "$3" == "inspect" && "$4" == "${EXPECTED_CANDIDATE:-}" ]]; then
	exit 0
fi

printf 'Unexpected docker command: %s\n' "$*" >&2
exit 1
EOF
chmod +x "$FAKE_BIN/docker"

if EXPECTED_CANDIDATE="$CANDIDATE_REF" PATH="$FAKE_BIN:$PATH" \
	"$TEST_REPO/scripts/tag-release.sh" 0.1.0-beta.3 "$RELEASE_SHA" </dev/null; then
	printf 'Expected a version mismatch to fail.\n' >&2
	exit 1
fi

if printf 'no\n' | EXPECTED_CANDIDATE="$CANDIDATE_REF" PATH="$FAKE_BIN:$PATH" \
	"$TEST_REPO/scripts/tag-release.sh" "$VERSION" "$RELEASE_SHA"; then
	printf 'Expected a mismatched confirmation to fail.\n' >&2
	exit 1
fi

if git -C "$TEST_REPO" show-ref --verify --quiet "refs/tags/${TAG}"; then
	printf 'A tag was created without exact confirmation.\n' >&2
	exit 1
fi

printf '%s\n' "$TAG" | EXPECTED_CANDIDATE="$CANDIDATE_REF" PATH="$FAKE_BIN:$PATH" \
	"$TEST_REPO/scripts/tag-release.sh" "$VERSION" "$RELEASE_SHA"

LOCAL_TAG_SHA="$(git -C "$TEST_REPO" rev-parse "${TAG}^{commit}")"
REMOTE_TAG_SHA="$(git --git-dir="$REMOTE" rev-parse "refs/tags/${TAG}^{commit}")"
if [[ "$LOCAL_TAG_SHA" != "$RELEASE_SHA" || "$REMOTE_TAG_SHA" != "$RELEASE_SHA" ]]; then
	printf 'The release tag did not point to the accepted commit.\n' >&2
	exit 1
fi

if printf '%s\n' "$TAG" | EXPECTED_CANDIDATE="$CANDIDATE_REF" PATH="$FAKE_BIN:$PATH" \
	"$TEST_REPO/scripts/tag-release.sh" "$VERSION" "$RELEASE_SHA"; then
	printf 'Expected an existing remote tag to be rejected.\n' >&2
	exit 1
fi

if [[ "$(git --git-dir="$REMOTE" rev-parse "refs/tags/${TAG}^{commit}")" != "$RELEASE_SHA" ]]; then
	printf 'The existing remote tag changed unexpectedly.\n' >&2
	exit 1
fi

printf 'Release tag helper tests passed.\n'
