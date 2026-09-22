#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if command -v php >/dev/null; then php -l functions.php; else echo "php not available locally; functions.php is linted on the server"; fi
grep -q '^Template: hello-elementor$' style.css
grep -q '@keyframes float' assets/anim.css
grep -q 'prefers-reduced-motion' assets/anim.css
node --check assets/faq.js
# The blog templates (spec section 8) and their stylesheet.
for f in home.php single.php inc/blog.php; do
  if command -v php >/dev/null; then php -l "$f"; fi
done
for f in home.php single.php; do
  grep -q 'class="pz-blog"' "$f" || { echo "$f: missing the .pz-blog wrapper" >&2; exit 1; }
  grep -q 'get_header();' "$f" || { echo "$f: must render the HFE header" >&2; exit 1; }
done
grep -q '\.pz-blog' assets/blog.css
grep -q 'poppynz_is_blog_template' functions.php
grep -q 'blog.css' functions.php
grep -q 'line-awesome' functions.php
test -f assets/bell.svg
echo "theme: ok"
