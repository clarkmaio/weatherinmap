#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  setup.sh  —  Download bundled dependencies
#  Run this ONCE before loading the extension in Chrome.
# ─────────────────────────────────────────────────────────────
set -e

echo "📦 Downloading Chart.js..."
mkdir -p lib
curl -sL "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js" \
     -o lib/chart.umd.min.js

SIZE=$(wc -c < lib/chart.umd.min.js)
if [ "$SIZE" -lt 100000 ]; then
  echo "❌ Download seems too small ($SIZE bytes). Check your internet connection."
  exit 1
fi

echo "✅ Done! chart.umd.min.js downloaded ($SIZE bytes)"
echo ""
echo "Next steps:"
echo "  1. Open Chrome → chrome://extensions"
echo "  2. Enable 'Developer mode' (top-right toggle)"
echo "  3. Click 'Load unpacked' → select this folder"
echo "  4. Go to https://www.google.com/maps and click anywhere!"
