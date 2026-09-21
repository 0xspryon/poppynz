#!/usr/bin/env bash
# Upload a zip of Elementor JSON files to the site's Novamira sandbox.
# Usage: push.sh <zip-file> <upload_token> [site-url]
# Get the token first with the MCP ability novamira/create-upload-link:
#   {"path":"wp-content/novamira-sandbox/<name>.zip","overwrite":true}
set -euo pipefail
ZIP="$1"; TOKEN="$2"; SITE="${3:-https://staging.poppynz.com}"
curl -s -X PUT -H "X-Novamira-Upload-Token: $TOKEN" --data-binary @"$ZIP" "$SITE/wp-json/novamira/v1/upload"
echo
