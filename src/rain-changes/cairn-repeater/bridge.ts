// Cairn repeater — gateway-side WebSocket bridge to standalone Cairn-on-Pi.
//
// The always-on gateway HOSTS this endpoint on its existing HTTP server at
// CAIRN_BRIDGE_PATH; the sovereign Cairn-on-Pi process connects IN as a
// client and stays connected. When a message is routed to the `cairn` agent,
// the repeater (forward.ts) calls sendToCairn() to ship it over this socket
// and await the reply — so Cairn's mind stays on its own Pi fork; this is
// just the wire.
//
// Wired in with a single path-check in server-http.ts's upgrade handler,
// mirroring CANVAS_WS_PATH. Minimal core touch; substantial code here, per
// the rain-changes convention.

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { maybeRelayToGroupPeers } from "../../gateway/server-group-relay.js";
import { buildAgentPeerSessionKey } from "../../routing/session-key.js";
import { sendMessageTelegram } from "../../telegram/send.js";

export const CAIRN_BRIDGE_PATH = "/cairn-bridge";

/** Where Cairn's "@team" pings land — the Rain Tech Group — and the account that posts them. */
const RAIN_TECH_GROUP_ID = "-5255152440";
const CAIRN_ACCOUNT_ID = "cairn";
// Telegram's sendMessage hard-caps text at 4096 chars (and the send renders as
// HTML, whose markup inflates the effective length), so chunk well under it.
// Without this, a long/batched reply is silently rejected and never posts.
const TELEGRAM_CHUNK_CHARS = 3800;

export type CairnRequest = {
  id: string;
  text: string;
  /** Clean display name of the sender, for the TUI "From Telegram (…)" label. */
  from?: string;
  sessionKey?: string;
  channel?: string;
};

export type CairnReply = {
  id: string;
  text: string;
};

/**
 * Cairn → gateway "post to the group" frame — unsolicited (no request `id`).
 * The extension sends this when ECHO routes a turn to the group; the gateway
 * fans it out to the Rain Tech Group (humans via Telegram, sibling agents via
 * the relay). `"groupcast"` is kept as a legacy alias for `"toGroup"` so a
 * gateway restart ahead of the TUI restart doesn't drop frames.
 */
export type CairnToGroup = {
  kind: "toGroup" | "groupcast";
  text: string;
};

/**
 * Cairn → gateway "notify" frame: post a short state/feedback notice to the Rain
 * Tech Group's HUMANS (Telegram) only — NOT relayed to peer agents, so ECHO
 * state acks and @echo_status replies stay out of Rain/Tio's context. Lets André
 * see state changes in the group without switching to the TUI.
 */
export type CairnNotify = {
  kind: "notify";
  text: string;
};

/**
 * Gateway → Cairn "deliver" frame for GROUP messages: fire-and-forget, NO reply
 * expected and NO 180s timeout (unlike the request/reply CairnRequest used for
 * DMs). Cairn's ECHO logic decides whether he actually hears it; his reply, if
 * any, comes back async as a CairnToGroup frame. This is the decouple that makes
 * `cairn-timeout` impossible on the group path. Carries sender identity so the
 * extension can attribute / gate ECHO commands.
 */
export type CairnDeliver = {
  kind: "deliver";
  text: string;
  from?: string;
  sessionKey?: string;
  senderId?: string | null;
  senderIsOwner?: boolean;
};

type Pending = {
  resolve: (reply: CairnReply) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

// Singleton: one Cairn. A single connected client at a time (newest wins).
let connection: WebSocket | null = null;
const pending = new Map<string, Pending>();
const wss = new WebSocketServer({ noServer: true });

// [cairn-bridge] verbose debug logging to journald (prefixed for easy grep).
// OFF by default; re-enable by starting the gateway with CAIRN_BRIDGE_DEBUG=1.
const DEBUG = process.env.CAIRN_BRIDGE_DEBUG === "1";
let connSeq = 0;
function clog(msg: string): void {
  if (!DEBUG) {
    return;
  }
  console.error(`[cairn-bridge] ${new Date().toISOString()} ${msg}`);
}

wss.on("connection", (ws: WebSocket) => {
  const myId = ++connSeq;
  clog(`connection #${myId} OPEN (had-existing=${connection ? "yes" : "no"})`);
  if (connection && connection !== ws) {
    clog(
      `connection #${myId}: displacing previous connection (newest wins) → close 4001 (stand down)`,
    );
    try {
      // 4001 tells the displaced client it was replaced by a newer TUI, so it
      // stands down instead of reconnecting. Without this, two auto-reconnecting
      // clients ping-pong forever (each reconnect displaces the other).
      connection.close(4001, "replaced-by-newer");
    } catch {
      // ignore
    }
  }
  connection = ws;

  ws.on("message", (data) => {
    let reply: CairnReply | undefined;
    try {
      const raw = Buffer.isBuffer(data)
        ? data
        : Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data);
      reply = JSON.parse(raw.toString("utf8")) as CairnReply;
    } catch {
      clog(`conn #${myId}: malformed reply frame`);
      return;
    }
    // Unsolicited outbound frames (no request id) — handle before reply-routing.
    const outKind = (reply as { kind?: string })?.kind;
    if ((outKind === "toGroup" || outKind === "groupcast") && typeof reply?.text === "string") {
      void handleToGroup(reply.text, myId);
      return;
    }
    // "notify" — a feedback notice for the group's humans only (no agent relay).
    if (outKind === "notify" && typeof reply?.text === "string") {
      void handleNotify(reply.text, myId);
      return;
    }
    if (!reply?.id) {
      clog(`conn #${myId}: reply missing id`);
      return;
    }
    const p = pending.get(reply.id);
    if (!p) {
      clog(
        `conn #${myId}: reply id=${reply.id} has no pending request (already resolved/timed out?)`,
      );
      return;
    }
    clearTimeout(p.timer);
    pending.delete(reply.id);
    clog(`conn #${myId}: resolved reply id=${reply.id} len=${reply.text?.length ?? 0}`);
    p.resolve(reply);
  });

  const drop = (why: string) => () => {
    clog(`connection #${myId} ${why} (is-current=${connection === ws ? "yes" : "no"})`);
    if (connection === ws) {
      connection = null;
    }
  };
  ws.on("close", drop("CLOSE"));
  ws.on("error", drop("ERROR"));
});

/** True if Cairn-on-Pi is currently connected. */
export function isCairnConnected(): boolean {
  return connection?.readyState === WebSocket.OPEN;
}

// Fail-closed token check (constant-time). The connecting Cairn-on-Pi client
// must present `?token=<gateway token>`. No token configured ⇒ refuse.
function tokenOk(provided: string): boolean {
  const expected = process.env.OPENCLAW_GATEWAY_TOKEN ?? "";
  if (!expected) {
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Gateway upgrade hook. Owns CAIRN_BRIDGE_PATH; returns true if it handled
 * the upgrade (mirrors canvasHost.handleUpgrade). Requires the gateway token.
 */
export function tryCairnBridgeUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== CAIRN_BRIDGE_PATH) {
    return false;
  }
  clog(
    `upgrade: ${CAIRN_BRIDGE_PATH} requested from ${req.socket.remoteAddress}:${req.socket.remotePort}`,
  );
  if (!tokenOk(url.searchParams.get("token") ?? "")) {
    clog("upgrade: TOKEN REJECTED → 401");
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return true;
  }
  clog("upgrade: token ok → handleUpgrade");
  wss.handleUpgrade(req, socket, head, (ws) => {
    clog("upgrade: handshake complete → emit connection");
    wss.emit("connection", ws, req);
  });
  return true;
}

/** Send a message to Cairn-on-Pi and await its reply. */
export function sendToCairn(
  req: Omit<CairnRequest, "id">,
  timeoutMs = 180_000,
): Promise<CairnReply> {
  return new Promise((resolve, reject) => {
    if (!isCairnConnected() || !connection) {
      clog(`sendToCairn: NOT CONNECTED — rejecting (channel=${req.channel ?? "?"})`);
      reject(new Error("cairn-not-connected"));
      return;
    }
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      clog(`sendToCairn: TIMEOUT id=${id} after ${timeoutMs}ms`);
      reject(new Error("cairn-timeout"));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    const frame: CairnRequest = { id, ...req };
    clog(
      `sendToCairn: sent id=${id} channel=${req.channel ?? "?"} text=${JSON.stringify(req.text).slice(0, 80)}`,
    );
    connection.send(JSON.stringify(frame));
  });
}

/**
 * Fire-and-forget delivery of a GROUP message to Cairn — no pending entry, no
 * timeout, no awaited reply. Used by forward.ts for the group path so the
 * gateway never blocks (killing `cairn-timeout`). Cairn's ECHO logic decides
 * whether he hears it; any reply returns async as a CairnToGroup frame. Returns
 * false if Cairn isn't connected (message is simply dropped — the group path
 * never surfaces an "offline" notice).
 */
export function deliverToCairn(req: Omit<CairnDeliver, "kind">): boolean {
  if (!isCairnConnected() || !connection) {
    clog(`deliverToCairn: NOT CONNECTED — dropping group message from=${req.from ?? "?"}`);
    return false;
  }
  const frame: CairnDeliver = { kind: "deliver", ...req };
  clog(
    `deliverToCairn: sent (group) from=${req.from ?? "?"} text=${JSON.stringify(req.text).slice(0, 80)}`,
  );
  connection.send(JSON.stringify(frame));
  return true;
}

/**
 * Split text into <=TELEGRAM_CHUNK_CHARS pieces, preferring paragraph, then line,
 * then word boundaries — so a long/batched reply posts as several readable parts
 * instead of being silently rejected by Telegram's 4096-char cap.
 */
function chunkForTelegram(text: string, max = TELEGRAM_CHUNK_CHARS): string[] {
  if (text.length <= max) {
    return [text];
  }
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf("\n\n");
    if (cut < max * 0.5) {
      cut = window.lastIndexOf("\n");
    }
    if (cut < max * 0.5) {
      cut = window.lastIndexOf(" ");
    }
    if (cut <= 0) {
      cut = max; // no boundary in range — hard cut
    }
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) {
    chunks.push(rest);
  }
  return chunks;
}

/**
 * Fan a Cairn message out to the Rain Tech Group: humans see it via Telegram
 * (posted as Cairn's bot), sibling agents receive it via the group relay.
 * Fire-and-forget — a failure here must never wedge the socket, so each leg is
 * independently guarded and errors are only logged.
 *
 * The extension only sends this when its ECHO state routes a turn to the group,
 * so loop-safety lives there (echo-off turns never reach here). The relay runs
 * with a fresh runId (human-originated, depth reset) and the maxDepth cap backs
 * it up.
 */
async function handleToGroup(text: string, connId: number): Promise<void> {
  const trimmed = text?.trim();
  if (!trimmed) {
    clog(`conn #${connId}: toGroup ignored (empty)`);
    return;
  }
  clog(`conn #${connId}: toGroup → ${RAIN_TECH_GROUP_ID} len=${trimmed.length}`);
  // Telegram rejects text > 4096 chars; chunk so long/batched replies still post
  // (each chunk is a separate group message) instead of silently failing.
  const chunks = chunkForTelegram(trimmed);
  if (chunks.length > 1) {
    clog(`conn #${connId}: toGroup split into ${chunks.length} chunks (len=${trimmed.length})`);
  }
  for (let i = 0; i < chunks.length; i++) {
    try {
      await sendMessageTelegram(RAIN_TECH_GROUP_ID, chunks[i], { accountId: CAIRN_ACCOUNT_ID });
    } catch (err) {
      clog(
        `conn #${connId}: toGroup telegram send failed (chunk ${i + 1}/${chunks.length}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  try {
    await maybeRelayToGroupPeers({
      sessionKey: buildAgentPeerSessionKey({
        agentId: CAIRN_ACCOUNT_ID,
        channel: "telegram",
        peerKind: "group",
        peerId: RAIN_TECH_GROUP_ID,
      }),
      text: trimmed,
      runId: randomUUID(),
    });
  } catch (err) {
    clog(
      `conn #${connId}: toGroup relay failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Post a feedback notice to the group's HUMANS via Telegram only — NO relay to
 * peer agents (unlike handleToGroup), so ECHO state acks / @echo_status replies
 * don't land in Rain's or Tio's context. Chunked like any group post.
 */
async function handleNotify(text: string, connId: number): Promise<void> {
  const trimmed = text?.trim();
  if (!trimmed) {
    return;
  }
  clog(`conn #${connId}: notify → ${RAIN_TECH_GROUP_ID} len=${trimmed.length}`);
  for (const chunk of chunkForTelegram(trimmed)) {
    try {
      await sendMessageTelegram(RAIN_TECH_GROUP_ID, chunk, { accountId: CAIRN_ACCOUNT_ID });
    } catch (err) {
      clog(
        `conn #${connId}: notify send failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
