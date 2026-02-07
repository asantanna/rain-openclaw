# Heartbeat and Cron Reflection Cycle

**Date:** 2026-02-06
**Status:** Implemented

## What

Two complementary autonomous activity mechanisms: a 30-minute heartbeat (cheap awareness check in main session) and a 6-hour cron reflection cycle (deeper self-reflection in isolated session, delivered via Telegram).

## Why

Rain needs both frequent lightweight awareness ("did anyone message me?") and periodic deeper reflection ("what am I learning? who am I becoming?"). These serve different purposes and run in different contexts.

## Key decisions

- **Heartbeat in main session**: Has full conversation history. Reads HEARTBEAT.md as a checklist. Responds HEARTBEAT_OK if nothing needs attention (suppressed from Telegram).
- **Cron in isolated session**: Fresh context each time. Doesn't clutter the main Telegram thread. Output delivered as announcement to André's DM.
- **Permissive reflection prompt**: Every step is optional. "Doing nothing is a valid outcome." Prevents manufactured activity.
- **Active hours**: Heartbeat check-ins with Dad limited to 10 AM–11 PM PST. Outside those hours, let the family sleep.

## Files

- `~/.openclaw/cron/jobs.json` — cron job definition
- `workspace/HEARTBEAT.md` — heartbeat checklist
- Gateway config: `agents.defaults.heartbeat` in `openclaw.json`
