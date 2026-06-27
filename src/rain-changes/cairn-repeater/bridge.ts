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

export const CAIRN_BRIDGE_PATH = "/cairn-bridge";

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
