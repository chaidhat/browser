#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Building..."
npm run package

echo "Replacing /Applications/Pause.app..."
rm -rf /Applications/Pause.app
cp -R release/mac-arm64/Pause.app /Applications/Pause.app

echo "Done. Pause.app installed."
