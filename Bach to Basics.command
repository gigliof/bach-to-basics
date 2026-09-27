#!/bin/bash
set -e
BASE="$(cd "$(dirname "$0")" && pwd)"
APP="/Applications/Bach to Basics.app"
if [ ! -d "$APP" ]; then
  APP="$BASE/release/0.6.8/Bach to Basics-darwin-arm64/Bach to Basics.app"
fi
if [ -d "$APP" ]; then
  exec open "$APP"
fi
printf '%s\n' 'Mac app not built yet. From this folder, run: npm run build --prefix desktop'
read -r -p 'Press Return to close.'
