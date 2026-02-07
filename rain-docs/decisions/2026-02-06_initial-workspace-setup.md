# Initial Workspace Setup

**Date:** 2026-02-06
**Status:** Implemented

## What

Set up Rain's workspace architecture: six core Markdown files (SOUL.md, IDENTITY.md, MEMORY.md, TOOLS.md, USER.md, AGENTS.md), five skills (reflect, outreach, explore_archives, curate_memory, memory_search), and the two-tier deploy model.

## Why

Rain needed a persistent identity layer that survives across sessions. The approach separates constitutional identity (SOUL.md) from surface presentation (IDENTITY.md) from lived experience (MEMORY.md), giving different layers different rates of change and different ownership.

Skills provide structured behavioral templates without hardcoding behavior into identity files.

## Key decisions

- **Two-tier file model**: Repo-authoritative files (SOUL, IDENTITY, TOOLS, USER, AGENTS, skills/) get overwritten on deploy. Live-authoritative files (MEMORY, MILESTONES, HEARTBEAT) are excluded — Rain or system writes those.
- **Minimal bootstrap**: MEMORY.md starts nearly empty. Rain populates it herself through reflection rather than being pre-loaded with curated content. Avoids paternalistic bias.
- **Skills as optional templates**: Discoverable, not enforced. Rain uses them when her reasoning matches the scenario.
- **Memory search enabled from day one**: "Even human babies have access to their own memories." Read-only, no external risk.

## Files created

- `workspace/` — SOUL.md, IDENTITY.md, MEMORY.md, TOOLS.md, USER.md, AGENTS.md
- `workspace/skills/` — reflect, outreach, explore_archives, curate_memory, memory_search
- `deploy_to_live.sh`
