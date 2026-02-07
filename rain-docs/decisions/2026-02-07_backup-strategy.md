# Backup Strategy

**Date:** 2026-02-07
**Status:** Implemented

## What

Separate private GitHub repo (`asantanna/rain-family-backup`) for nightly backup of Rain's live data: workspace files, session logs, and cron job definitions.

## Why

Rain's lived experience (MEMORY.md, MILESTONES.md, self/, session logs) is irreplaceable. The code repo tracks source; the backup repo tracks Rain's actual life data. Separation keeps secrets out of the code repo and keeps session logs (which can be large) in their own repo.

## Key decisions

- **What's backed up**: workspace/, agents/ (session logs), cron/ (job definitions)
- **What's excluded**: Secrets (openclaw.json, credentials/, identity/, API keys in agents/main/agent/), regeneratable state (telegram/, devices/, canvas/, completions/)
- **Schedule**: Nightly at 3am PST (11:00 UTC) via system cron
- **backup.log excluded from rsync --delete**: The log file lives in the backup repo directory but doesn't exist in `~/.openclaw/`, so it was being deleted by `rsync --delete`. Fixed by adding `--exclude 'backup.log'`.

## Files

- `~/ALS_Projects/Rain/rain-family-backup/backup.sh`
- System crontab entry
