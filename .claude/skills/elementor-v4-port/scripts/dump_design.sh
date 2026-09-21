#!/usr/bin/env bash
# Render a static design page with headless Chrome: readable DOM dump + full-page screenshot + slices.
# Usage: dump_design.sh <Page file.html> <slug> [out-dir]
# Temporarily serves apps/landing-page/design on 127.0.0.1:8765 if nothing is listening there yet.
set -euo pipefail
DIR="$(git rev-parse --show-toplevel)/apps/landing-page/design"
FILE="$1"; SLUG="$2"; OUT="${3:-${CLAUDE_SCRATCHPAD:-${OPENCODE_SCRATCHPAD:-/tmp}}/design-$SLUG}"
mkdir -p "$OUT"
SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT
if ! curl -s -o /dev/null "http://127.0.0.1:8765/"; then
  (cd "$DIR" && exec python3 -m http.server 8765 --bind 127.0.0.1) >/dev/null 2>&1 &
  SERVER_PID=$!
  sleep 1
fi
ENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$FILE")
URL="http://127.0.0.1:8765/$ENC"
CH="google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars"
# DOM after scripts ran
timeout 60 $CH --virtual-time-budget=8000 --dump-dom "$URL" 2>/dev/null > "$OUT/$SLUG-raw.html"
python3 - "$OUT/$SLUG-raw.html" "$OUT/$SLUG-dom.txt" <<'EOF'
import re,sys
s=open(sys.argv[1]).read()
m=re.search(r'<(?:div|main)[^>]*id="site"[^>]*>(.*)</(?:div|main)>\s*<script',s,re.S)
body=m.group(1) if m else re.sub(r'<script.*?</script>','',s,flags=re.S)
body=re.sub(r'<(section|header|footer|main|nav|article|figure|h1|h2|h3|h4|p|a |div|span|ul|li|details|summary|blockquote|img|strong|em|button)',r'\n<\1',body)
open(sys.argv[2],'w').write(body); print('dom chars',len(body))
EOF
# Full page + 2250px slices (no PIL needed: re-render an offset <img>)
timeout 90 $CH --window-size=1280,16000 --virtual-time-budget=9000 --screenshot="$OUT/$SLUG-full.png" "$URL" 2>/dev/null
i=0
while [ $i -lt 8 ]; do
  off=$((i*2250))
  printf '<body style="margin:0;overflow:hidden"><img src="file://%s" style="display:block;margin-top:-%dpx"></body>' "$OUT/$SLUG-full.png" "$off" > "$OUT/slice.html"
  timeout 30 $CH --window-size=1280,2250 --screenshot="$OUT/$SLUG-$i.png" "file://$OUT/slice.html" 2>/dev/null
  # stop when a slice is (almost) blank
  if [ "$(stat -c %s "$OUT/$SLUG-$i.png")" -lt 40000 ]; then rm -f "$OUT/$SLUG-$i.png"; break; fi
  i=$((i+1))
done
rm -f "$OUT/slice.html"
echo "DOM: $OUT/$SLUG-dom.txt"; ls "$OUT" | grep -E "^$SLUG-[0-9]+\.png" | sed "s#^#slice: $OUT/#"
