#!/bin/bash

# deploy_to_live.sh
# Copies ONLY repo-authoritative files to OpenClaw's live workspace.
# Run this anytime you update SOUL.md, skills, etc. and want them live.
#
# SAFETY MODEL: Whitelist, not blacklist.
#   We explicitly copy only the files we control.
#   Everything Rain creates in the live workspace is untouched.
#   No --delete. No sync. One-way copy of named files only.
#
# REPO-AUTHORITATIVE (copied by this script):
#   SOUL.md, IDENTITY.md, TOOLS.md, USER.md, AGENTS.md, skills/
#
# RAIN-AUTHORITATIVE (never touched — Rain owns these):
#   MEMORY.md, MILESTONES.md, HEARTBEAT.md, self/, mind-theory/,
#   and anything else she creates in the live workspace.

set -e  # Exit on any error

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/workspace"
TARGET_DIR="$HOME/.openclaw/workspace"

echo "Deploying Rain workspace files..."
echo "Source: $SOURCE_DIR"
echo "Target: $TARGET_DIR"

# Create target if missing
mkdir -p "$TARGET_DIR"

# Copy repo-authoritative files only
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

# Copy skills directory (repo-authoritative, full sync within skills/ only)
if [ -d "$SOURCE_DIR/skills" ]; then
  echo ""
  echo "Copying skills..."
  rsync -av "$SOURCE_DIR/skills/" "$TARGET_DIR/skills/"
fi

echo ""
echo "Deployment complete!"
echo "Only repo-authoritative files were copied. Rain's files are untouched."
echo ""
echo "Live workspace contents:"
ls -la "$TARGET_DIR"
