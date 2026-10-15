#!/bin/bash
# Installs the Beat Markers panel for Premiere Pro and After Effects (current user, macOS).
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.krshnaprsad.beatmarkerpanel"
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC/CSXS" "$SRC/css" "$SRC/js" "$SRC/jsx" "$SRC/index.html" "$DEST/"
# Allow unsigned panels (needed for any panel that is not a signed .zxp)
for v in 9 10 11 12 13; do defaults write com.adobe.CSXS.$v PlayerDebugMode 1; done
echo "Installed to: $DEST"
echo "Now fully quit and reopen Premiere Pro / After Effects, then open Window > Extensions > Beat Markers."
