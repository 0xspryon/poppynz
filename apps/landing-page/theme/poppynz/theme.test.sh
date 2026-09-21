#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if command -v php >/dev/null; then php -l functions.php; else echo "php not available locally; functions.php is linted on the server"; fi
grep -q '^Template: hello-elementor$' style.css
grep -q '@keyframes float' assets/anim.css
grep -q 'prefers-reduced-motion' assets/anim.css
node --check assets/faq.js
echo "theme: ok"
