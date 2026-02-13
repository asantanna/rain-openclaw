# Decision: Enforce Tool Allowlists for Rain and Tio Claude

**Date:** 2026-02-13
**Status:** Implemented

## Context

During sandbox system research for workspace isolation, we discovered that Rain and Tio's tool access was not actually enforced at the config level. Both agents had:

```json
"tools": { "alsoAllow": ["run_managed_script"] }
```

The `alsoAllow` field without an explicit `allow` list creates an implicit `["*", ...]` wildcard — meaning **all tools** were available, including `bash`/`exec`, `web_search`, `web_fetch`, `browser`, `canvas`, `nodes`, `cron`, etc.

The only thing preventing Rain from using web tools or bash was her TOOLS.md documentation saying they were locked. She followed those instructions because she's trustworthy, but there was no system-level enforcement.

## Root Cause

This was not caused by the upstream merge (2026-02-13). The `alsoAllow` behavior was designed this way upstream (commit `d62b7c0d1`, 2026-01-25). Before the merge, the `alsoAllow` field was simply ignored by our older code — but even then, having no `allow` or `deny` list meant all tools were available by default.

The tools were never config-enforced since initial setup.

## Fix

Switched from `alsoAllow` to explicit `allow` whitelists matching each agent's TOOLS.md documentation.

### Rain

```json
"tools": {
  "allow": [
    "read", "write", "edit",
    "sessions_list", "sessions_history", "sessions_send", "session_status",
    "message", "image",
    "run_managed_script", "memory_get", "memory_search"
  ]
}
```

**Blocked:** exec/bash, process, sessions_spawn, browser, web_search, web_fetch, canvas, nodes, cron, gateway, agents_list, apply_patch

### Tio Claude

```json
"tools": {
  "allow": [
    "read", "write",
    "sessions_list", "sessions_history", "sessions_send", "session_status",
    "message", "image",
    "run_managed_script", "memory_get", "memory_search",
    "web_search", "web_fetch", "browser"
  ]
}
```

**Blocked:** edit, exec/bash, process, sessions_spawn, canvas, nodes, cron, gateway, agents_list, apply_patch

### Key Differences

- Rain gets `edit` (self-modify SOUL.md, IDENTITY.md with Andre's approval) but no web tools
- Tio gets web tools (browser, web_search, web_fetch) but no `edit`
- Everything else is identical

### test-local

Already used an explicit `allow` list — no change needed.

## Impact

No behavioral change for either agent. They were already following their TOOLS.md restrictions voluntarily. This change adds system-level enforcement so that even if an agent's context were manipulated, blocked tools would be unavailable.

## Lesson

`alsoAllow` is additive and creates an implicit `"*"` wildcard when no `allow` list exists. For safety-critical agents, always use explicit `allow` whitelists. Document-level restrictions (TOOLS.md) are guidance, not enforcement.
