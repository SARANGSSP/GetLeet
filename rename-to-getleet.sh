#!/usr/bin/env bash
# rename-to-getleet.sh
#
# Applies the LeetSync -> GetLeet branding changes to an existing local
# checkout of the extension. Run this from the repo root (the folder
# containing manifest.json).
#
# Usage:
#   chmod +x rename-to-getleet.sh
#   ./rename-to-getleet.sh

set -euo pipefail

if [ ! -f "manifest.json" ]; then
  echo "Error: run this script from the repo root (manifest.json not found here)."
  exit 1
fi

# Portable in-place sed (works on both GNU sed and BSD/macOS sed)
sedi() {
  if sed --version >/dev/null 2>&1; then
    sed -i "$@"          # GNU sed
  else
    sed -i '' "$@"       # BSD/macOS sed
  fi
}

echo "Updating src/background.js..."
sedi \
  -e 's/Add README for \${question\.title} - LeetSync/Add README for ${question.title} - GetLeet/' \
  -e 's/Time: \${time} (\${timePct}%) | Memory: \${mem} (\${memPct}%) - LeetSync/Time: ${time} (${timePct}%) | Memory: ${mem} (${memPct}%) - GetLeet/' \
  -e 's/Synced automatically by \*\*LeetCode Auto-Organizer Sync\*\*/Synced automatically by **GetLeet**/' \
  -e 's/\[LeetCode Auto Sync\]/[GetLeet]/g' \
  -e 's/auto-synced by LeetCode Auto-Organizer Sync\./auto-synced by GetLeet./' \
  src/background.js

echo "Updating manifest.json..."
sedi \
  -e 's/"name": "LeetCode Auto-Organizer Sync"/"name": "GetLeet"/' \
  -e 's/"default_title": "LeetCode Auto Sync"/"default_title": "GetLeet"/' \
  manifest.json

echo "Updating popup/popup.html..."
sedi -e 's/<h1>LeetCode Auto Sync<\/h1>/<h1>GetLeet<\/h1>/' popup/popup.html

echo "Updating README.md..."
sedi -e 's/^# LeetCode Auto-Organizer Sync$/# GetLeet/' README.md

echo "Updating backend/server.js..."
sedi -e "1s|.*|// Minimal backend for the GetLeet extension's GitHub OAuth flow.|" backend/server.js

echo ""
echo "Done. Remaining references to \"LeetSync\" (expected: only the homage credit line):"
grep -rn "LeetSync" src/ popup/ manifest.json README.md backend/ 2>/dev/null || echo "  (none found)"
