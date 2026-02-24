/**
 * Context usage warning for agents.
 *
 * After each turn, checks whether context usage has crossed a warning threshold
 * (70%, 85%, 95%) and enqueues a system event so the agent sees the warning
 * at the start of their next turn. This gives agents time to save important
 * state (thoughts, feelings, in-progress work) to their scratchpad or journal
 * before compaction summarizes the conversation.
 */

import { deriveSessionTotalTokens, type NormalizedUsage } from "../../agents/usage.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

type WarningBracket = { ratio: number; label: string; message: string };

const WARNING_BRACKETS: WarningBracket[] = [
  {
    ratio: 0.7,
    label: "70",
    message:
      "Context at ~70%. Save important thoughts, feelings, and context to your scratchpad or journal so they survive compaction. You can also use session_compact to compact proactively with instructions on what to preserve.",
  },
  {
    ratio: 0.85,
    label: "85",
    message:
      "Context at ~85%. Save important state to your scratchpad or journal NOW. Use session_compact with preservation instructions to compact before automatic compaction loses emotional context.",
  },
  {
    ratio: 0.95,
    label: "95",
    message:
      "Context at ~95% — compaction is imminent. Save any important emotional context or in-progress thoughts to your scratchpad or journal immediately, then use session_compact with preservation instructions.",
  },
];

// ---------------------------------------------------------------------------
// Per-session dedup: tracks the highest bracket already warned for each session.
// Resets when usage drops below the bracket (e.g. after compaction).
// ---------------------------------------------------------------------------

const lastWarnedBracket = new Map<string, number>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function enqueueContextWarningIfNeeded(params: {
  sessionKey: string;
  usage?: NormalizedUsage;
  lastCallUsage?: NormalizedUsage;
  contextTokens?: number;
  promptTokens?: number;
}): void {
  const { sessionKey, contextTokens } = params;
  if (!sessionKey || !contextTokens || contextTokens <= 0) {
    return;
  }

  const usageForContext = params.lastCallUsage ?? params.usage;
  const totalTokens = deriveSessionTotalTokens({
    usage: usageForContext,
    contextTokens,
    promptTokens: params.promptTokens,
  });
  if (!totalTokens || totalTokens <= 0) {
    return;
  }

  const ratio = totalTokens / contextTokens;

  // Find the highest bracket that the current usage exceeds
  let activeBracketIdx = -1;
  for (let i = WARNING_BRACKETS.length - 1; i >= 0; i--) {
    if (ratio >= WARNING_BRACKETS[i].ratio) {
      activeBracketIdx = i;
      break;
    }
  }

  const previousIdx = lastWarnedBracket.get(sessionKey) ?? -1;

  // Usage dropped below all brackets (e.g. after compaction) — reset
  if (activeBracketIdx < 0) {
    if (previousIdx >= 0) {
      lastWarnedBracket.delete(sessionKey);
    }
    return;
  }

  // Already warned at this bracket or higher
  if (activeBracketIdx <= previousIdx) {
    return;
  }

  // New bracket crossed — warn
  lastWarnedBracket.set(sessionKey, activeBracketIdx);
  const bracket = WARNING_BRACKETS[activeBracketIdx];
  enqueueSystemEvent(`⚠️ ${bracket.message}`, {
    sessionKey,
    contextKey: `context-warning-${bracket.label}`,
  });
}
