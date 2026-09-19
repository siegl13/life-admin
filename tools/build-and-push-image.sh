#!/usr/bin/env bash

set -euo pipefail

readonly IMAGE="ghcr.io/siegl13/life-admin"
readonly PLATFORMS="linux/amd64,linux/arm64"
readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  printf 'Verwendung: %s <version>\n' "$(basename "$0")"
  printf 'Beispiel:   %s 0.1.0\n' "$(basename "$0")"
}

if [[ $# -ne 1 ]]; then
  usage >&2
  exit 2
fi

readonly VERSION="$1"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf 'Fehler: "%s" ist keine gueltige Versionsnummer fuer einen Image-Tag.\n' "$VERSION" >&2
  exit 2
fi

for command_name in git node npm docker; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Fehler: %s wurde nicht gefunden.\n' "$command_name" >&2
    exit 1
  fi
done

readonly PACKAGE_VERSION="$(node -p "require('$REPO_ROOT/package.json').version")"
if [[ "$VERSION" != "$PACKAGE_VERSION" ]]; then
  printf 'Fehler: Version %s stimmt nicht mit package.json (%s) ueberein.\n' \
    "$VERSION" "$PACKAGE_VERSION" >&2
  exit 1
fi

if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
  printf 'Fehler: Der Git-Arbeitsbaum ist nicht sauber. Bitte alle Build-Inhalte zuerst committen.\n' >&2
  exit 1
fi

GIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)"
readonly GIT_SHA
readonly GIT_SHA_FULL="$(git -C "$REPO_ROOT" rev-parse HEAD)"
readonly RELEASE_TAG="v${VERSION}"

if [[ "$(git -C "$REPO_ROOT" rev-list -n 1 "$RELEASE_TAG" 2>/dev/null || true)" != "$GIT_SHA_FULL" ]]; then
  printf 'Fehler: HEAD muss mit dem lokalen Release-Tag %s markiert sein.\n' "$RELEASE_TAG" >&2
  exit 1
fi

if ! REMOTE_TAG_REFS="$(
  git -C "$REPO_ROOT" ls-remote --exit-code --tags origin \
    "refs/tags/${RELEASE_TAG}" "refs/tags/${RELEASE_TAG}^{}" 2>/dev/null
)"; then
  printf 'Fehler: Release-Tag %s ist noch nicht auf origin veroeffentlicht.\n' "$RELEASE_TAG" >&2
  exit 1
fi

remote_tag_commit=""
while read -r object_id ref_name; do
  if [[ "$ref_name" == *'^{}' || -z "$remote_tag_commit" ]]; then
    remote_tag_commit="$object_id"
  fi
done <<<"$REMOTE_TAG_REFS"

if [[ "$remote_tag_commit" != "$GIT_SHA_FULL" ]]; then
  printf 'Fehler: Der Tag %s auf origin zeigt nicht auf HEAD.\n' "$RELEASE_TAG" >&2
  exit 1
fi

if ! docker buildx version >/dev/null 2>&1; then
  printf 'Fehler: docker buildx ist nicht verfuegbar.\n' >&2
  exit 1
fi

readonly TAG="${IMAGE}:${VERSION}"
readonly TAG_GIT_SHA="${IMAGE}:git-${GIT_SHA}"
readonly TAG_LATEST="${IMAGE}:latest"

printf 'Baue Life-Admin-Image\n'
printf '  Version:   %s\n' "$TAG"
printf '  Git-Stand: %s\n' "$TAG_GIT_SHA"
printf '  Plattformen: %s\n' "$PLATFORMS"
printf '  Kontext:   %s\n' "$REPO_ROOT"
printf '\nVerifikation gestartet ...\n\n'

npm --prefix "$REPO_ROOT" run verify
npm --prefix "$REPO_ROOT" run test:e2e

printf '\nBuild und Push gestartet ...\n\n'

if docker buildx build \
  --platform "$PLATFORMS" \
  --tag "$TAG" \
  --tag "$TAG_GIT_SHA" \
  --tag "$TAG_LATEST" \
  --push \
  "$REPO_ROOT"; then
  printf '\nErfolgreich gebaut und gepusht:\n'
  printf '  %s\n' "$TAG"
  printf '  %s\n' "$TAG_GIT_SHA"
  printf '  %s\n' "$TAG_LATEST"
else
  status=$?
  printf '\nFehler: Build oder Push ist fehlgeschlagen (Exit-Code %d).\n' "$status" >&2
  exit "$status"
fi
