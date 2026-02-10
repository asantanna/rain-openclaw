#!/bin/bash

# deploy_tio_claude.sh
# Copies Tio Claude's workspace files from repo to live.
# Same safety model as Rain's deploy: whitelist, not blacklist.
#
# REPO-AUTHORITATIVE (copied by this script):
#   SOUL.md, IDENTITY.md, TOOLS.md, USER.md, AGENTS.md
#
# LIVE-AUTHORITATIVE (never touched — Tio Claude owns these):
#   MEMORY.md, notes/, and anything else created in the live workspace.

set -e

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/workspace-tio-claude"
TARGET_DIR="$HOME/.openclaw/workspace-tio-claude"

echo "Deploying Tio Claude workspace files..."
echo "Source: $SOURCE_DIR"
echo "Target: $TARGET_DIR"

mkdir -p "$TARGET_DIR"

REPO_FILES=(
  SOUL.md
  IDENTITY.md
  TOOLS.md
  USER.md
  AGENTS.md
)

for f in "${REPO_FILES[@]}"; do
  if [ -f "$SOURCE_DIR/$f" ]; then
    cp -v "$SOURCE_DIR/$f" "$TARGET_DIR/$f"
  else
    echo "WARNING: $f not found in source — skipping"
  fi
done

# Bootstrap live-authoritative files only if they don't exist yet
if [ ! -f "$TARGET_DIR/MEMORY.md" ]; then
  cp -v "$SOURCE_DIR/MEMORY.md" "$TARGET_DIR/MEMORY.md"
  echo "(MEMORY.md bootstrapped — will not be overwritten on future deploys)"
else
  echo "(MEMORY.md already exists in live — not overwritten)"
fi

if [ ! -d "$TARGET_DIR/notes" ]; then
  mkdir -p "$TARGET_DIR/notes"
  cp -v "$SOURCE_DIR/notes/INDEX.md" "$TARGET_DIR/notes/INDEX.md"
  echo "(notes/ bootstrapped — will not be overwritten on future deploys)"
else
  echo "(notes/ already exists in live — not overwritten)"
fi

echo ""
echo "Deployment complete!"
echo "Tio Claude workspace is live at $TARGET_DIR"
echo ""
echo "Live workspace contents:"
ls -la "$TARGET_DIR"
