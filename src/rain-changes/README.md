# rain-changes/

Code that belongs to **our fork** of OpenClaw, not upstream.

We try to keep modifications to forked OpenClaw files (everything else under
`src/`) as small as possible — typically a one-line import + a one-line call —
so that future merges from upstream stay clean. The actual logic lives here.

## Modules

### Spend tracker

- `spend-tracker.ts` — main module. Writes per-call token usage to a SQLite
  log at `~/.openclaw/spend-log.sqlite` (or `OPENCLAW_SPEND_TRACK_DB`).
  Disabled unless the env var `OPENCLAW_SPEND_TRACK=1` is set on the gateway.
  All writes are fire-and-forget; failures never crash the agent.
- `spend-tracker-compact.ts` — wraps `generateSummary` from
  `pi-coding-agent` so compaction calls show up in the same log with
  `kind='compaction'`. Token counts are estimated (the underlying call
  doesn't expose true usage).

Schema (created on first write):

```sql
CREATE TABLE spend (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                    INTEGER NOT NULL,    -- unix epoch ms
  iso_date              TEXT NOT NULL,       -- YYYY-MM-DD
  run_id                TEXT,
  session_key           TEXT,
  agent_id              TEXT,                -- rain | tio | librarian | researcher | ...
  provider              TEXT,
  model                 TEXT,
  kind                  TEXT,                -- agent_run | compaction | librarian | researcher
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_create_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  request_id            TEXT,
  notes                 TEXT
);
```

Hook points in upstream-shaped files:

| File                                                       | What we add                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/agents/pi-embedded-runner/run/attempt.ts` (~line 888) | `recordSpend(...)` right after `anthropicPayloadLogger?.recordUsage(...)` |
| `src/agents/compaction.ts` (~line 181)                     | `generateSummary` → `trackedGenerateSummary`                              |

Python writers (Librarian, Researcher) write directly to the same SQLite
file via `sqlite3` so the report tool sees a single unified log.

Query the data with `~/.openclaw/managed_scripts/spend_query.py`.

## Conventions

- **Never throw** out of code in this folder. We are observability — the
  primary path is more important than our data.
- **Keep dependencies on upstream files thin.** If we need a helper from
  an upstream module, import it; don't fork it.
- **Default off.** Anything in here that adds runtime cost (DB writes,
  extra LLM calls, background work) must be gated behind an env var or
  config flag and disabled by default.
