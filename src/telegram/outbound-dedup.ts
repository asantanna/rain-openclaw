/**
 * Outbound message dedup for Telegram.
 *
 * Tracks the last text sent per chatId. If a sequential identical send is
 * detected, logs it and returns true (= duplicate, should skip).
 *
 * This catches the observed pattern where Rain sends byte-identical messages
 * twice in a row to the same chat.
 */

import type { RuntimeEnv } from "../runtime.js";

const lastSentText = new Map<string, string>();

export function checkOutboundDedup(chatId: string, text: string, runtime?: RuntimeEnv): boolean {
  const prev = lastSentText.get(chatId);
  if (prev === text) {
    const preview = JSON.stringify(text.slice(0, 80));
    (runtime?.log ?? console.log)(
      `telegram-output-dedup: duplicate suppressed for chat ${chatId} (${text.length} chars, starts: ${preview})`,
    );
    return true;
  }
  lastSentText.set(chatId, text);
  return false;
}

/** Exposed for testing. */
export function resetOutboundDedup(): void {
  lastSentText.clear();
}
