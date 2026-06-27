// Cairn repeater — the "swap the brain" piece.
//
// runEmbeddedPiAgent (pi-embedded-runner/run.ts) checks isCairnRepeaterAgent()
// and, if so, calls forwardToCairnOnPi() instead of running the embedded Pi
// loop: it ships the inbound to the sovereign Cairn-on-Pi process over the
// bridge and returns its reply as an EmbeddedPiRunResult, so the entire
// delivery / transcript / relay body downstream is reused verbatim.

import type { RunEmbeddedPiAgentParams } from "../../agents/pi-embedded-runner/run/params.js";
import type { EmbeddedPiRunResult } from "../../agents/pi-embedded-runner/types.js";
import { isCairnConnected, sendToCairn } from "./bridge.js";

/** The registered repeater agent's id. */
export const CAIRN_AGENT_ID = "cairn";

/** True if this run is for the Cairn repeater agent (forward, don't think). */
export function isCairnRepeaterAgent(params: RunEmbeddedPiAgentParams): boolean {
  return params.agentId === CAIRN_AGENT_ID;
}

/**
 * Strip OpenClaw's "(untrusted metadata)" fenced-JSON blocks and the relay
 * "[name]: " prefix from the prompt, leaving just the message body. The TUI
 * renders this under a clean "From Telegram (name):" line instead of raw JSON.
 * (Same shape as researcher.ts's stripInboundMeta.)
 */
function cleanBody(text: string): string {
  let cleaned = text.replace(/(?:^|\n\n?)[\w\s]+\(untrusted[\w\s,]*\):\n```json\n[\s\S]*?```/g, "");
  cleaned = cleaned.trim().replace(/^\[[\w\s-]+\]:\s*/, "");
  return cleaned.trim();
}

/** Best-effort clean display name for the "From Telegram (…)" label. */
function fromLabel(params: RunEmbeddedPiAgentParams): string | undefined {
  return params.senderName?.trim() || undefined;
}

/** Forward the inbound to Cairn-on-Pi; return its reply as a run result. */
export async function forwardToCairnOnPi(
  params: RunEmbeddedPiAgentParams,
): Promise<EmbeddedPiRunResult> {
  const started = Date.now();
  if (!isCairnConnected()) {
    return {
      payloads: [{ text: "_(Cairn is offline right now — back shortly.)_" }],
      meta: { durationMs: Date.now() - started },
    };
  }
  try {
    const reply = await sendToCairn({
      text: cleanBody(params.prompt),
      from: fromLabel(params),
      sessionKey: params.sessionKey ?? params.sessionId,
      channel: params.messageChannel,
    });
    return {
      payloads: [{ text: reply.text }],
      meta: { durationMs: Date.now() - started },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      payloads: [{ text: `_(Couldn't reach Cairn: ${message})_` }],
      meta: { durationMs: Date.now() - started },
    };
  }
}
