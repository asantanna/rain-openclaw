#!/bin/bash

# deploy_tio_claude.sh
# Copies Tio Claude's workspace files from repo to live.
# Safety model: whitelist, not blacklist — three tiers.
#
# REPO-AUTHORITATIVE (always overwritten):
#   TOOLS.md, USER.md, AGENTS.md
#
# DIFF-GATED (deploy fails if live differs from repo):
#   SOUL.md, IDENTITY.md
#   These are identity files the agent may modify. Drift is flagged
#   for human review — accept changes into repo, or investigate.
#
# LIVE-AUTHORITATIVE (bootstrap only, never touched after):
#   MEMORY.md, notes/, and anything else created in the live workspace.

set -e

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/workspace-tio-claude"
TARGET_DIR="$HOME/.openclaw/workspace-tio-claude"

echo "Deploying Tio Claude workspace files..."
echo "Source: $SOURCE_DIR"
echo "Target: $TARGET_DIR"

mkdir -p "$TARGET_DIR"

# ── Tier 1: Repo-authoritative (always overwrite) ───────────────────
REPO_FILES=(
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
    echo "  To accept: cp ~/.openclaw/workspace-tio-claude/$f workspace-tio-claude/$f"
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

# ── Tier 3: Live-authoritative (bootstrap only) ─────────────────────
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
