/**
 * Outbound message dedup for Telegram.
 *
 * Uses a keyed dedup cache (chatId:hash) with a 60-second TTL window.
 * This catches both sequential duplicates AND concurrent duplicate sends
 * (e.g., two agent runs from a retried webhook producing the same output).
 */

import { createHash } from "node:crypto";
import type { RuntimeEnv } from "../runtime.js";
import { createDedupeCache } from "../infra/dedupe.js";

const DEDUP_TTL_MS = 60_000;
const DEDUP_MAX_SIZE = 500;

const cache = createDedupeCache({ ttlMs: DEDUP_TTL_MS, maxSize: DEDUP_MAX_SIZE });

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function checkOutboundDedup(chatId: string, text: string, runtime?: RuntimeEnv): boolean {
  const key = `${chatId}:${hashText(text)}`;
  const isDup = cache.check(key);
  if (isDup) {
    const preview = JSON.stringify(text.slice(0, 80));
    (runtime?.log ?? console.log)(
      `telegram-output-dedup: duplicate suppressed for chat ${chatId} (${text.length} chars, starts: ${preview})`,
    );
  }
  return isDup;
}

/** Exposed for testing. */
export function resetOutboundDedup(): void {
  cache.clear();
}
