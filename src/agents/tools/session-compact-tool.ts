import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { loadConfig } from "../../config/config.js";
import {
  loadSessionStore,
  resolveStorePath,
  resolveFreshSessionTotalTokens,
} from "../../config/sessions.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";

// ---------------------------------------------------------------------------
// Deferred compaction queue
// ---------------------------------------------------------------------------

type CompactRequest = { instructions?: string };

/**
 * Pending compaction requests keyed by session key.
 * Written by the tool, consumed by the run loop after the attempt completes.
 */
const pendingCompactRequests = new Map<string, CompactRequest>();

/** Tracks when the last compaction completed per session key (for cooldown). */
const lastCompactedAt = new Map<string, number>();

const COMPACT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const COOLDOWN_TTL_MS = 60 * 60 * 1000; // 1 hour (prune stale entries)

const MIN_CONTEXT_USAGE_RATIO = 0.4; // 40%

// ---------------------------------------------------------------------------
// Exports for the run loop (run.ts)
// ---------------------------------------------------------------------------

/**
 * Consume and remove a pending compaction request for the given session key.
 * Returns `undefined` if no request was pending.
 */
export function consumePendingCompactRequest(sessionKey: string): CompactRequest | undefined {
  const request = pendingCompactRequests.get(sessionKey);
  if (request) {
    pendingCompactRequests.delete(sessionKey);
  }
  return request;
}

/** Record that compaction completed, updating the cooldown timestamp. */
export function markCompactionCompleted(sessionKey: string): void {
  lastCompactedAt.set(sessionKey, Date.now());
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

const SessionCompactToolSchema = Type.Object({
  instructions: Type.Optional(
    Type.String({
      description:
        "Optional guidance for what the compaction summary should prioritize preserving.",
    }),
  ),
});

export function createSessionCompactTool(opts?: {
  agentSessionKey?: string;
  config?: OpenClawConfig;
}): AnyAgentTool {
  return {
    label: "Session Compact",
    name: "session_compact",
    description: [
      "Request proactive context compaction for the current session.",
      "Use when your context is getting large (check session_status first).",
      "Compaction summarizes older conversation history to free up context space.",
      "It runs after the current turn completes — not immediately.",
      "",
      "Parameters:",
      '  instructions (optional): Guidance for what to preserve, e.g. "Keep recent family conversation topics and pending tasks".',
      "",
      "Safeguards:",
      "  - Context must be at least 40% full.",
      "  - 5-minute cooldown between compactions.",
      "  - Non-destructive: context is summarized, not deleted.",
    ].join("\n"),
    parameters: SessionCompactToolSchema,
    execute: async (_toolCallId, args) => {
      const params = (args ?? {}) as Record<string, unknown>;
      const instructions =
        typeof params.instructions === "string"
          ? params.instructions.trim() || undefined
          : undefined;

      const sessionKey = opts?.agentSessionKey;
      if (!sessionKey) {
        return {
          content: [{ type: "text", text: "Compaction unavailable (no session context)." }],
          details: { ok: false, reason: "no_session_key" },
        };
      }

      // --- 40% context threshold ---
      const cfg = opts?.config ?? loadConfig();
      const agentId = resolveAgentIdFromSessionKey(sessionKey);
      const storePath = resolveStorePath(cfg.session?.store, { agentId });
      const store = loadSessionStore(storePath);
      const entry = store[sessionKey];
      const totalTokens = resolveFreshSessionTotalTokens(entry);
      const contextTokens = entry?.contextTokens;

      if (
        typeof totalTokens === "number" &&
        totalTokens > 0 &&
        typeof contextTokens === "number" &&
        contextTokens > 0
      ) {
        const usage = totalTokens / contextTokens;
        if (usage < MIN_CONTEXT_USAGE_RATIO) {
          const pct = Math.round(usage * 100);
          return {
            content: [
              {
                type: "text",
                text: `Context usage is ${pct}% — below the 40% threshold. Compaction not needed yet.`,
              },
            ],
            details: { ok: false, reason: "below_threshold", usagePercent: pct },
          };
        }
      }

      // --- Cooldown ---
      const now = Date.now();
      // Prune stale entries
      for (const [k, ts] of lastCompactedAt) {
        if (now - ts > COOLDOWN_TTL_MS) {
          lastCompactedAt.delete(k);
        }
      }
      const lastAt = lastCompactedAt.get(sessionKey);
      if (typeof lastAt === "number" && now - lastAt < COMPACT_COOLDOWN_MS) {
        const remainingSec = Math.ceil((COMPACT_COOLDOWN_MS - (now - lastAt)) / 1000);
        return {
          content: [
            {
              type: "text",
              text: `Compaction cooldown active — ${remainingSec}s remaining. Try again later.`,
            },
          ],
          details: { ok: false, reason: "cooldown", remainingSec },
        };
      }

      // --- Dedup: already pending ---
      if (pendingCompactRequests.has(sessionKey)) {
        return {
          content: [
            {
              type: "text",
              text: "Compaction already scheduled for this turn.",
            },
          ],
          details: { ok: true, reason: "already_pending" },
        };
      }

      // --- Queue the request ---
      pendingCompactRequests.set(sessionKey, { instructions });

      const instrNote = instructions ? ` Preservation guidance: "${instructions}"` : "";
      return {
        content: [
          {
            type: "text",
            text:
              `Compaction scheduled. Your context will be compacted after this turn completes.${instrNote}` +
              " Use session_status on your next turn to verify the result.",
          },
        ],
        details: { ok: true, reason: "scheduled" },
      };
    },
  };
}
