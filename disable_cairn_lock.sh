#!/usr/bin/env bash
# ============================================================================
#  Cairn cross-session lock — EMERGENCY KILL SWITCH
# ============================================================================
# If anything ever goes wrong with the single-session lock, just run:
#
#     bash ~/.claude/disable_cairn_lock.sh
#
# It does two things, both safe:
#   1) Frees any held/stuck lock (removes the lockfile) so you can type again.
#   2) Surgically removes the lock's hooks from settings.json, leaving
#      EVERYTHING else (PreCompact, permissions, other hooks) untouched.
#
# It backs settings.json up first, writes atomically, and refuses to touch a
# settings file it can't parse. Safe to run even if the lock was never wired
# (it just no-ops). Reopen the Claude Code window afterward so the change loads.
#
# (Paths can be overridden with $CAIRN_SETTINGS / $CAIRN_LOCKFILE — used by tests.)
# ============================================================================
set -u
SETTINGS="${CAIRN_SETTINGS:-$HOME/.claude/settings.json}"
LOCKFILE="${CAIRN_LOCKFILE:-$HOME/.claude/cairn-session-lock.json}"

# --- Loud confirmation: this is the FULL DISABLE, not a gentle lock-clear ----
# Skip with -y / --yes or CAIRN_LOCK_DISABLE_YES=1 (used by tests/automation).
FORCE=0
for a in "$@"; do case "$a" in -y|--yes) FORCE=1 ;; esac; done
[ "${CAIRN_LOCK_DISABLE_YES:-0}" = "1" ] && FORCE=1

if [ "$FORCE" != "1" ]; then
  echo
  echo "  ⚠️  THIS IS NOT JUST CLEARING CAIRN'S SESSION LOCK."
  echo "      It REMOVES THE ENTIRE single-session functionality — it unhooks"
  echo "      the lock from settings.json. This is an EMERGENCY reset."
  echo
  echo "      If you only want to free a STUCK lock and KEEP the feature,"
  echo "      press Ctrl-C and instead run:"
  echo "          rm ~/.claude/cairn-session-lock.json"
  echo "      (or type  @steal_lock  in the blocked window)."
  echo
  printf "  Hit Enter to FULLY DISABLE, or Ctrl-C to abort... "
  if [ -r /dev/tty ]; then
    read -r _ </dev/tty || { echo; echo "Aborted (no confirmation received)."; exit 1; }
  else
    read -r _ || { echo; echo "Aborted (no terminal to confirm; re-run with -y to force)."; exit 1; }
  fi
  echo
fi

echo "== Cairn lock kill switch =="

# 1) Free any held lock ------------------------------------------------------
if [ -f "$LOCKFILE" ]; then
  rm -f "$LOCKFILE" && echo "• Removed held lock: $LOCKFILE"
else
  echo "• No lockfile present (nothing held)."
fi

# 2) Strip the lock hooks from settings.json (surgical, atomic, backed up) ----
if [ -f "$SETTINGS" ]; then
  cp "$SETTINGS" "$SETTINGS.bak-predisable" \
    && echo "• Backed up settings -> $SETTINGS.bak-predisable"
  python3 - "$SETTINGS" <<'PY'
import json, os, sys, tempfile
p = sys.argv[1]
try:
    d = json.load(open(p))
except Exception as e:
    print("• settings.json did not parse — leaving it untouched:", e)
    sys.exit(0)
hooks = d.get("hooks", {}) or {}
removed = 0
for ev in ("UserPromptSubmit", "Stop", "StopFailure", "SessionEnd"):
    groups = hooks.get(ev)
    if not isinstance(groups, list):
        continue
    kept = []
    for g in groups:
        hs = [h for h in g.get("hooks", [])
              if "cairn_session_lock.py" not in str(h.get("command", ""))]
        if hs:
            g["hooks"] = hs
            kept.append(g)
        else:
            removed += 1
    if kept:
        hooks[ev] = kept
    else:
        hooks.pop(ev, None)
d["hooks"] = hooks
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p) or ".")
with os.fdopen(fd, "w") as f:
    json.dump(d, f, indent=2)
os.replace(tmp, p)
print(f"• Disabled Cairn lock: removed {removed} hook group(s); everything else preserved.")
PY
else
  echo "• No settings.json found at $SETTINGS."
fi

echo "== Done. Reopen the Claude Code window so the change is fully loaded. =="
