# Build Pipeline and Wrapper Script Fix

**Date:** 2026-02-07
**Status:** Implemented

## What

Fixed the `openclaw` wrapper script and build pipeline. The cron reflection cycle was silently failing because `dist/build-info.json` was missing, causing version to resolve to "0.0.0".

## Why

The wrapper used `pnpm openclaw` which triggered `run-node.mjs`. That script auto-rebuilds via `tsdown` when dist is stale — but `tsdown` cleans the dist directory first, deleting `build-info.json`. The full `pnpm build` includes a post-build step (`write-build-info.ts`) that creates this file, but `run-node.mjs` only runs `tsdown`.

With version "0.0.0", isolated agent sessions crashed silently during initialization. The cron timer advanced `nextRunAtMs` past each scheduled slot (in the `finally` block of `executeJob()`) but never set `lastStatus` — jobs appeared "idle" despite having been attempted and failed.

## Key decisions

- **Wrapper calls `node openclaw.mjs` directly**: Bypasses `run-node.mjs` auto-rebuild entirely. Requires a prior `pnpm build` but preserves `build-info.json`.
- **After any code changes**: Always run `pnpm build` (full build, not just `tsdown`), then `systemctl --user restart openclaw-gateway`.
- **Gateway service uses `dist/index.js`**: Library/gateway entry point. CLI uses `dist/entry.js` via `openclaw.mjs`. Both need correct version from `build-info.json`.

## Files

- `openclaw` — wrapper script rewritten
- `dist/build-info.json` — created by full `pnpm build` (version "2026.2.4")
