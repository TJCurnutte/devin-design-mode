#!/bin/sh
# Package the extension for the Chrome Web Store.
# Run from the repo root: sh package.sh

set -e

VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
OUT="devin-design-mode-${VERSION}.zip"

rm -f "$OUT"

zip -r "$OUT" \
  manifest.json \
  content.js \
  background.js \
  popup.html \
  popup.js \
  options.html \
  options.js \
  styles.css \
  icon16.png \
  icon48.png \
  icon128.png \
  -x "*.DS_Store"

echo "Packaged: $OUT"