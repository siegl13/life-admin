#!/usr/bin/env bash

set -euo pipefail

# ---------------------------------------------------------------------------
# push-test-image.sh
#
# Builds the current committed source and pushes an immutable test image
# to the PRIVATE GHCR package:
#
#   ghcr.io/siegl13/life-admin-dev:git-<short-sha>
#
# This is NOT a release script. It does not create tags, versions, or
# push to the official ghcr.io/siegl13/life-admin package.
#
# Prerequisites:
#   - Docker with buildx installed
#   - GHCR authentication already configured (docker login ghcr.io)
#   - Clean Git working tree (or set ALLOW_DIRTY=1)
# ---------------------------------------------------------------------------

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

readonly IMAGE_PRIVATE="ghcr.io/siegl13/life-admin-dev"

: "${PLATFORMS:=linux/amd64,linux/arm64}"

# --- tool checks -----------------------------------------------------------

for cmd in git docker; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf 'Error: %s not found.\n' "$cmd" >&2
    exit 1
  fi
done

if ! docker buildx version >/dev/null 2>&1; then
  printf 'Error: docker buildx is not available.\n' >&2
  exit 1
fi

# --- git safety ------------------------------------------------------------

if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" && -z "${ALLOW_DIRTY:-}" ]]; then
  printf 'Warning: Git working tree is not clean. Image will reflect the last commit, not uncommitted changes.\n' >&2
  printf 'Set ALLOW_DIRTY=1 to skip this check.\n' >&2
  exit 1
fi

GIT_SHA_FULL="$(git -C "$REPO_ROOT" rev-parse HEAD)"
readonly GIT_SHA_FULL

GIT_SHA_SHORT="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)"
readonly GIT_SHA_SHORT

readonly TAG_PRIVATE="${IMAGE_PRIVATE}:git-${GIT_SHA_SHORT}"

# --- build and push --------------------------------------------------------

printf '\nBuilding private test image\n'
printf '  Package:   %s\n' "$IMAGE_PRIVATE"
printf '  Tag:       %s\n' "$TAG_PRIVATE"
printf '  Platforms: %s\n' "$PLATFORMS"
printf '  Context:   %s\n' "$REPO_ROOT"
printf '  Commit:    %s\n' "$GIT_SHA_FULL"
printf '\n'

if docker buildx build \
  --platform "$PLATFORMS" \
  --build-arg "APP_REVISION=${GIT_SHA_FULL}" \
  --tag "$TAG_PRIVATE" \
  --push \
  "$REPO_ROOT"; then
  printf '\nPushed successfully:\n'
  printf '  %s\n' "$TAG_PRIVATE"
else
  status=$?
  printf '\nError: Build or push failed (exit code %d).\n' "$status" >&2
  exit "$status"
fi
