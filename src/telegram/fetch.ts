import * as net from "node:net";
import process from "node:process";
import { Agent, fetch as undiciFetch } from "undici";
import type { TelegramNetworkConfig } from "../config/types.telegram.js";
import { resolveFetch, wrapFetchWithAbortSignal } from "../infra/fetch.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveTelegramAutoSelectFamilyDecision } from "./network-config.js";

let appliedAutoSelectFamily: boolean | null = null;
const log = createSubsystemLogger("telegram/network");

// Node 22 workaround: disable autoSelectFamily to avoid Happy Eyeballs timeouts.
// See: https://github.com/nodejs/node/issues/54359
function applyTelegramNetworkWorkarounds(network?: TelegramNetworkConfig): void {
  const decision = resolveTelegramAutoSelectFamilyDecision({ network });
  if (decision.value === null || decision.value === appliedAutoSelectFamily) {
    return;
  }
  appliedAutoSelectFamily = decision.value;

  if (typeof net.setDefaultAutoSelectFamily === "function") {
    try {
      net.setDefaultAutoSelectFamily(decision.value);
      const label = decision.source ? ` (${decision.source})` : "";
      log.info(`telegram: autoSelectFamily=${decision.value}${label}`);
    } catch {
      // ignore if unsupported by the runtime
    }
  }
}

// Force Telegram traffic onto IPv4. On Node 22 autoSelectFamily is disabled
// (above), so there is NO automatic IPv4 fallback: when the IPv6 route to
// api.telegram.org half-dies (a recurring problem on this network), a long-poll
// can hang for minutes and freeze all inbound. Pinning the Telegram client's
// undici Agent to connect.family=4 routes around the lossy IPv6 path entirely.
// Telegram-scoped only — LLM and other traffic are untouched.
// Escape hatch: set OPENCLAW_TELEGRAM_FORCE_IPV4=0 (or false/no/off) to disable.
let ipv4Agent: Agent | null = null;
let loggedIpv4 = false;

function telegramForceIpv4(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.OPENCLAW_TELEGRAM_FORCE_IPV4;
  if (raw == null || raw.trim() === "") {
    return true; // default on
  }
  return !/^(0|false|no|off)$/i.test(raw.trim());
}

function makeIpv4TelegramFetch(): typeof fetch {
  if (!ipv4Agent) {
    ipv4Agent = new Agent({ connect: { family: 4 } });
  }
  const agent = ipv4Agent;
  // undici's fetch is runtime-compatible with global fetch but the types diverge
  // on stream/body internals. Single cast at the boundary keeps the rest type-safe.
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) =>
    undiciFetch(input as string | URL, {
      ...(init as Record<string, unknown>),
      dispatcher: agent,
    }) as unknown as Promise<Response>) as typeof fetch;
  return wrapFetchWithAbortSignal(fetcher);
}

// Prefer wrapped fetch when available to normalize AbortSignal across runtimes.
export function resolveTelegramFetch(
  proxyFetch?: typeof fetch,
  options?: { network?: TelegramNetworkConfig },
): typeof fetch | undefined {
  applyTelegramNetworkWorkarounds(options?.network);
  if (proxyFetch) {
    // A proxy handles its own routing; don't override its dispatcher.
    return resolveFetch(proxyFetch);
  }
  if (telegramForceIpv4()) {
    if (!loggedIpv4) {
      loggedIpv4 = true;
      log.info("telegram: forcing IPv4 (connect.family=4)");
    }
    return makeIpv4TelegramFetch();
  }
  const fetchImpl = resolveFetch();
  if (!fetchImpl) {
    throw new Error("fetch is not available; set channels.telegram.proxy in config");
  }
  return fetchImpl;
}

export function resetTelegramFetchStateForTests(): void {
  appliedAutoSelectFamily = null;
  ipv4Agent = null;
  loggedIpv4 = false;
}
