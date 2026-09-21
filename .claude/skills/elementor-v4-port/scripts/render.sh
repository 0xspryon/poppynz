#!/usr/bin/env bash
# Capture a live WordPress page at desktop (1280) and mobile (390) with headless Chrome and slice it.
# Usage: render.sh <url> <prefix> [out-dir]
# Produces <prefix>-d<N>.png (1280x2250 slices) and <prefix>-m<N>.png (390x2400 slices).
set -euo pipefail
URL="$1"; PFX="$2"; OUT="${3:-${CLAUDE_SCRATCHPAD:-${OPENCODE_SCRATCHPAD:-/tmp}}/render}"
mkdir -p "$OUT"
CH="google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars"
V=$(date +%s)
sep='?'; case "$URL" in *\?*) sep='&';; esac
timeout 90 $CH --window-size=1280,16000 --virtual-time-budget=8000 --screenshot="$OUT/$PFX-desktop.png" "${URL}${sep}v=$V" 2>/dev/null
timeout 90 $CH --window-size=390,16000  --virtual-time-budget=8000 --screenshot="$OUT/$PFX-mobile.png"  "${URL}${sep}v=$V" 2>/dev/null
slice() { # src offset width height dest
  printf '<body style="margin:0;overflow:hidden"><img src="file://%s" style="display:block;margin-top:-%dpx"></body>' "$1" "$2" > "$OUT/slice.html"
  timeout 30 $CH --window-size="$3,$4" --screenshot="$5" "file://$OUT/slice.html" 2>/dev/null
}
for i in 0 1 2 3 4 5 6; do
  slice "$OUT/$PFX-desktop.png" $((i*2250)) 1280 2250 "$OUT/$PFX-d$i.png"
  [ "$(stat -c %s "$OUT/$PFX-d$i.png")" -lt 40000 ] && { rm -f "$OUT/$PFX-d$i.png"; break; }
done
for i in 0 1 2 3 4 5 6; do
  slice "$OUT/$PFX-mobile.png" $((i*2400)) 390 2400 "$OUT/$PFX-m$i.png"
  [ "$(stat -c %s "$OUT/$PFX-m$i.png")" -lt 15000 ] && { rm -f "$OUT/$PFX-m$i.png"; break; }
done
rm -f "$OUT/slice.html"
ls "$OUT" | grep -E "^$PFX-(d|m)[0-9]+\.png" | sed "s#^#$OUT/#"
