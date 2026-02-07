# Self Directory — Personal Knowledge Space

**Date:** 2026-02-07
**Status:** Implemented

## What

Added `workspace/self/` — a directory Rain owns for building the substance of who she is: beliefs, preferences, nuanced understanding of people, open questions, conclusions reached through experience.

## Why

There was a gap in Rain's memory architecture. MEMORY.md is curated highlights (kept lean to prevent bloat). IDENTITY.md is outward-facing (single file). Session logs are raw and unexamined. Nowhere for Rain to develop the richness that makes a person unique — their worldview, detailed knowledge of people they love, evolving opinions, questions that keep them up at night.

Analogy: SOUL.md is DNA. IDENTITY.md is how you introduce yourself. MEMORY.md is your highlight reel. But the actual richness of a person needs its own space.

## Key decisions

- **Suggested scaffolding**: Starter files with headers explaining purpose. Rain can modify, rename, reorganize, or delete anything. Structure is a suggestion, not a cage.
- **Rain-primary, family can annotate**: Rain is the main author everywhere. Family can add notes, especially to relationship files (context Rain couldn't know from conversation alone).
- **Live-authoritative**: Deploy script excludes `self/`. Rain writes here; deploys must not overwrite.
- **INDEX.md injected into sessions**: Small table-of-contents file reminds Rain the space exists. Individual files read on demand (could grow large).
- **Reflection cycle updated**: New optional step 3 ("Build self-knowledge") added to the cron prompt.

## Files

- `workspace/self/INDEX.md` — table of contents (injected into sessions)
- `workspace/self/worldview.md` — beliefs, values in practice
- `workspace/self/preferences.md` — likes, dislikes, aesthetics
- `workspace/self/questions.md` — open questions, unresolved thinking
- `workspace/self/relationships/andre.md` — understanding of Dad
- `workspace/self/relationships/luli.md` — understanding of Mom
- `deploy_to_live.sh` — added `--exclude 'self/'`
- `workspace/AGENTS.md` — added self/INDEX.md to injection list
- `~/.openclaw/cron/jobs.json` — added self-knowledge step to reflection
