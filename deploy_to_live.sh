#!/bin/bash

# deploy_to_live.sh
# Copies current workspace files from repo (source) to OpenClaw's live workspace
# Run this anytime you update SOUL.md, skills, etc. and want them live

set -e  # Exit on any error

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/workspace"
TARGET_DIR="$HOME/.openclaw/workspace"

echo "Deploying Rain workspace files..."
echo "Source: $SOURCE_DIR"
echo "Target: $TARGET_DIR"

# Create target if missing
mkdir -p "$TARGET_DIR"

# Copy everything (preserves structure)
rsync -av --delete "$SOURCE_DIR/" "$TARGET_DIR/"

echo "Deployment complete!"
echo "Files are now live in $TARGET_DIR"
echo "You can now safely run onboarding or restart the daemon."

# Optional: Show what was copied
echo ""
echo "Live workspace contents:"
ls -la "$TARGET_DIR"
