#!/usr/bin/env bash
# Zip one artefact build together with the server scripts and the child theme for upload.
# Usage: pack.sh <build-name> [out-zip]
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)/apps/landing-page"
BUILD="${1:?build name}"; OUT="${2:-${CLAUDE_SCRATCHPAD:-/tmp}/poppynz-artefact.zip}"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
cp -r "$ROOT/json-artefacts/$BUILD/." "$STAGE/"
mkdir -p "$STAGE/server" "$STAGE/theme"
cp "$ROOT"/server/*.php "$STAGE/server/"
cp -r "$ROOT/theme/poppynz" "$STAGE/theme/"
rm -f "$OUT"; (cd "$STAGE" && zip -qr "$OUT" .)
echo "$OUT ($(du -h "$OUT" | cut -f1))"
