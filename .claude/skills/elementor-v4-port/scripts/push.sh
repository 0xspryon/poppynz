#!/usr/bin/env bash
# Upload a zip of Elementor JSON files to the site's Novamira sandbox.
# Usage: push.sh <zip-file> [upload_token] [site-url]
# Get the token first with the MCP ability novamira/create-upload-link:
#   {"path":"wp-content/novamira-sandbox/<name>.zip","overwrite":true}
# Prefer exporting NOVAMIRA_UPLOAD_TOKEN and omitting the second argument so the token does not
# land in shell history; the positional argument still works if you pass it explicitly.
set -euo pipefail
ZIP="$1"; TOKEN="${2:-${NOVAMIRA_UPLOAD_TOKEN:?upload token}}"; SITE="${3:-https://staging.poppynz.com}"
curl -s -X PUT -H "X-Novamira-Upload-Token: $TOKEN" --data-binary @"$ZIP" "$SITE/wp-json/novamira/v1/upload"
echo
