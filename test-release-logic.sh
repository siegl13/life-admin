#!/usr/bin/env bash

set -euo pipefail

# Tests for release workflow tag validation logic.
# Run with: ./test-release-logic.sh

PASS=0
FAIL=0

pass() {
  PASS=$((PASS + 1))
  echo "  PASS: $1"
}

fail() {
  FAIL=$((FAIL + 1))
  echo "  FAIL: $1"
}

validate_tag() {
  local tag="$1"
  if [[ ! "$tag" =~ ^v([0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?)$ ]]; then
    return 1
  fi
  return 0
}

extract_version() {
  local tag="$1"
  if [[ "$tag" =~ ^v([0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?)$ ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

is_prerelease() {
  local version="$1"
  if [[ "$version" =~ - ]]; then
    return 0
  fi
  return 1
}

echo "=== Tag format validation ==="

validate_tag "v0.1.0" && pass "stable version" || fail "stable version"
validate_tag "v1.0.0" && pass "v1.0.0" || fail "v1.0.0"
validate_tag "v0.1.0-beta.1" && pass "prerelease" || fail "prerelease"
validate_tag "v0.1.0-beta" && pass "simple prerelease" || fail "simple prerelease"
validate_tag "v1.2.3-alpha.1" && pass "alpha prerelease" || fail "alpha prerelease"
validate_tag "v1.2.3-rc.1" && pass "rc prerelease" || fail "rc prerelease"
validate_tag "v0.1.0-beta.1.2" && pass "multi-dot prerelease" || fail "multi-dot prerelease"

! validate_tag "v1.0" && pass "reject incomplete version" || fail "reject incomplete version"
! validate_tag "1.0.0" && pass "reject missing v prefix" || fail "reject missing v prefix"
! validate_tag "v1.0.0-beta.1.0-beta.2" && pass "reject malformed prerelease" || fail "reject malformed prerelease"
! validate_tag "v1.0.0-beta 1" && pass "reject space in prerelease" || fail "reject space in prerelease"
! validate_tag "vabc" && pass "reject non-numeric" || fail "reject non-numeric"

echo ""
echo "=== Version extraction ==="

[ "$(extract_version "v0.1.0")" = "0.1.0" ] && pass "extract 0.1.0" || fail "extract 0.1.0"
[ "$(extract_version "v1.0.0")" = "1.0.0" ] && pass "extract 1.0.0" || fail "extract 1.0.0"
[ "$(extract_version "v0.1.0-beta.1")" = "0.1.0-beta.1" ] && pass "extract prerelease" || fail "extract prerelease"

echo ""
echo "=== Prerelease detection ==="

is_prerelease "0.1.0-beta.1" && pass "detect prerelease" || fail "detect prerelease"
is_prerelease "1.0.0-alpha" && pass "detect alpha" || fail "detect alpha"
is_prerelease "0.1.0-rc.1" && pass "detect rc" || fail "detect rc"

! is_prerelease "0.1.0" && pass "stable is not prerelease" || fail "stable is not prerelease"
! is_prerelease "1.0.0" && pass "1.0.0 is not prerelease" || fail "1.0.0 is not prerelease"

echo ""
echo "=== Package.json version matching ==="

# Simulate package.json version extraction
PKG_VERSION="0.1.0-beta.1"
TAG_VERSION="0.1.0-beta.1"
[ "$TAG_VERSION" = "$PKG_VERSION" ] && pass "matching versions" || fail "matching versions"

PKG_VERSION="0.1.0"
TAG_VERSION="0.1.0-beta.1"
[ "$TAG_VERSION" != "$PKG_VERSION" ] && pass "mismatch detected" || fail "mismatch detected"

echo ""
echo "=== Image naming conventions ==="

OWNER="siegl13"
SHA_SHORT="abc123def456"
CANDIDATE_REF="ghcr.io/${OWNER}/life-admin-dev:git-${SHA_SHORT}"
OFFICIAL_REF="ghcr.io/${OWNER}/life-admin:0.1.0-beta.1"
OFFICIAL_SHA_REF="ghcr.io/${OWNER}/life-admin:git-${SHA_SHORT}"

[[ "$CANDIDATE_REF" == *"life-admin-dev:"* ]] && pass "candidate uses -dev package" || fail "candidate uses -dev package"
[[ "$CANDIDATE_REF" == *"git-${SHA_SHORT}"* ]] && pass "candidate uses git-SHA tag" || fail "candidate uses git-SHA tag"
[[ "$OFFICIAL_REF" == *"life-admin:"* ]] && pass "official uses base package" || fail "official uses base package"
[[ "$OFFICIAL_REF" == *"-dev:"* ]] && fail "official does not use -dev" || pass "official does not use -dev"

echo ""
echo "=== Summary ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
