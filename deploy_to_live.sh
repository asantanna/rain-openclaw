#!/bin/bash

# deploy_to_live.sh
# Copies ONLY repo-authoritative files to OpenClaw's live workspace.
# Run this anytime you update TOOLS.md, skills, etc. and want them live.
#
# SAFETY MODEL: Whitelist, not blacklist — three tiers.
#
# REPO-AUTHORITATIVE (always overwritten):
#   TOOLS.md, skills/
#
# DIFF-GATED (deploy fails if live differs from repo):
#   SOUL.md, IDENTITY.md
#   Identity files Rain may modify. Drift is flagged for human review —
#   accept changes into repo, or investigate.
#
# RAIN-AUTHORITATIVE (never touched — Rain owns these):
#   USER.md, AGENTS.md, MEMORY.md, MILESTONES.md,
#   HEARTBEAT.md, self/, mind-theory/, and anything else she creates.

set -e  # Exit on any error

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/workspace"
TARGET_DIR="$HOME/.openclaw/workspace"

echo "Deploying Rain workspace files..."
echo "Source: $SOURCE_DIR"
echo "Target: $TARGET_DIR"

# Create target if missing
mkdir -p "$TARGET_DIR"

# ── Tier 1: Repo-authoritative (always overwrite) ───────────────────
REPO_FILES=(
  TOOLS.md
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

# ── Tier 2: Diff-gated (fail on drift) ──────────────────────────────
DIFF_GATED_FILES=(
  SOUL.md
  IDENTITY.md
)

DRIFT_FOUND=0
for f in "${DIFF_GATED_FILES[@]}"; do
  if [ ! -f "$TARGET_DIR/$f" ]; then
    # First deploy — bootstrap from repo
    cp -v "$SOURCE_DIR/$f" "$TARGET_DIR/$f"
    echo "  (bootstrapped $f)"
  elif ! diff -q "$SOURCE_DIR/$f" "$TARGET_DIR/$f" > /dev/null 2>&1; then
    echo ""
    echo "==========================================================="
    echo "  DRIFT DETECTED: $f"
    echo "==========================================================="
    echo ""
    diff -u "$SOURCE_DIR/$f" "$TARGET_DIR/$f" || true
    echo ""
    echo "  Live file differs from repo. Review the diff above."
    echo "  To accept: cp ~/.openclaw/workspace/$f workspace/$f"
    echo "  Then commit and re-deploy."
    echo ""
    DRIFT_FOUND=1
  else
    echo "  $f: in sync"
  fi
done

if [ "$DRIFT_FOUND" -eq 1 ]; then
  echo "==========================================================="
  echo "  DEPLOY ABORTED — resolve drifted files above first."
  echo "==========================================================="
  exit 1
fi

echo ""
echo "Deployment complete!"
echo "Only repo-authoritative files were copied. Rain's files are untouched."
echo ""
echo "Live workspace contents:"
ls -la "$TARGET_DIR"
