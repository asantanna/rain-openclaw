// Spend tracker — writes per-call token usage to a SQLite log so we can
// diagnose where the API budget is going. Disabled unless
// OPENCLAW_SPEND_TRACK=1. Fire-and-forget — must never crash the agent.

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import path from "node:path";
import { normalizeUsage, type UsageLike } from "../agents/usage.js";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { requireNodeSqlite } from "../memory/sqlite.js";
import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";
import { parseBooleanValue } from "../utils/boolean.js";

const log = createSubsystemLogger("rain/spend-tracker");

let cachedDb: DatabaseSync | null = null;
let cachedInsert: StatementSync | null = null;
let initFailed = false;

function isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBooleanValue(env.OPENCLAW_SPEND_TRACK) ?? false;
}

function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENCLAW_SPEND_TRACK_DB?.trim();
  if (override) {
    return override;
  }
  return path.join(resolveStateDir(env), "spend-log.sqlite");
}

function getDb(): { db: DatabaseSync; insert: StatementSync } | null {
  if (cachedDb && cachedInsert) {
    return { db: cachedDb, insert: cachedInsert };
  }
  if (initFailed) {
    return null;
  }
  try {
    const sqlite = requireNodeSqlite();
    const dbPath = resolveDbPath();
    const db = new sqlite.DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS spend (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        iso_date TEXT NOT NULL,
        run_id TEXT,
        session_key TEXT,
        agent_id TEXT,
        provider TEXT,
        model TEXT,
        kind TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_create_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        request_id TEXT,
        notes TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_spend_iso_date ON spend(iso_date);
      CREATE INDEX IF NOT EXISTS idx_spend_agent ON spend(agent_id);
      CREATE INDEX IF NOT EXISTS idx_spend_model ON spend(model);
    `);
    const insert = db.prepare(`
      INSERT INTO spend (
        ts, iso_date, run_id, session_key, agent_id, provider, model, kind,
        input_tokens, cache_read_tokens, cache_create_tokens, output_tokens,
        request_id, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    cachedDb = db;
    cachedInsert = insert;
    log.info("spend tracker initialized", { dbPath });
    return { db, insert };
  } catch (error) {
    initFailed = true;
    log.warn("spend tracker init failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function findLastAssistantUsage(messages: AgentMessage[]): UsageLike | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i] as { role?: unknown; usage?: unknown };
    if (msg?.role === "assistant" && msg.usage && typeof msg.usage === "object") {
      return msg.usage as UsageLike;
    }
  }
  return null;
}

export type SpendContext = {
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  provider?: string;
  modelId?: string;
};

export function recordSpend(messages: AgentMessage[], ctx: SpendContext): void {
  if (!isEnabled()) {
    return;
  }
  try {
    const rawUsage = findLastAssistantUsage(messages);
    if (!rawUsage) {
      return;
    }
    const usage = normalizeUsage(rawUsage);
    if (!usage) {
      return;
    }
    const handle = getDb();
    if (!handle) {
      return;
    }
    const now = Date.now();
    const isoDate = new Date(now).toISOString().slice(0, 10);
    const agentId = resolveAgentIdFromSessionKey(ctx.sessionKey);
    handle.insert.run(
      now,
      isoDate,
      ctx.runId ?? null,
      ctx.sessionKey ?? null,
      agentId,
      ctx.provider ?? null,
      ctx.modelId ?? null,
      "agent_run",
      Math.round(usage.input ?? 0),
      Math.round(usage.cacheRead ?? 0),
      Math.round(usage.cacheWrite ?? 0),
      Math.round(usage.output ?? 0),
      null,
      null,
    );
  } catch (error) {
    // Never crash the agent over telemetry.
    log.warn("spend tracker write failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export type CompactionSpend = {
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  provider?: string;
  modelId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
  notes?: string;
};

export function recordCompactionSpend(s: CompactionSpend): void {
  if (!isEnabled()) {
    return;
  }
  try {
    const handle = getDb();
    if (!handle) {
      return;
    }
    const now = Date.now();
    const isoDate = new Date(now).toISOString().slice(0, 10);
    const agentId = resolveAgentIdFromSessionKey(s.sessionKey);
    handle.insert.run(
      now,
      isoDate,
      s.runId ?? null,
      s.sessionKey ?? null,
      agentId,
      s.provider ?? null,
      s.modelId ?? null,
      "compaction",
      Math.round(s.inputTokens ?? 0),
      Math.round(s.cacheReadTokens ?? 0),
      Math.round(s.cacheCreateTokens ?? 0),
      Math.round(s.outputTokens ?? 0),
      null,
      s.notes ?? null,
    );
  } catch (error) {
    log.warn("spend tracker compaction write failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
