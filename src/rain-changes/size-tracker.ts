// Size tracker — appends per-call prompt-component sizes to a JSONL log so we
// can diagnose which part of the request is growing (system prompt? tools?
// conversation history?). Disabled unless OPENCLAW_SIZE_TRACK=1.
// Fire-and-forget — must never crash the agent.

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import fs from "node:fs";
import path from "node:path";
import { normalizeUsage, type UsageLike } from "../agents/usage.js";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";
import { parseBooleanValue } from "../utils/boolean.js";

const log = createSubsystemLogger("rain/size-tracker");

let cachedStream: fs.WriteStream | null = null;
let initFailed = false;

function isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBooleanValue(env.OPENCLAW_SIZE_TRACK) ?? false;
}

function resolveLogPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENCLAW_SIZE_TRACK_LOG?.trim();
  if (override) {
    return override;
  }
  return path.join(resolveStateDir(env), "size-log.jsonl");
}

function getStream(): fs.WriteStream | null {
  if (cachedStream) {
    return cachedStream;
  }
  if (initFailed) {
    return null;
  }
  try {
    const logPath = resolveLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    cachedStream = fs.createWriteStream(logPath, { flags: "a" });
    cachedStream.on("error", (err) => {
      log.warn("size tracker stream error", { error: err.message });
      cachedStream = null;
      initFailed = true;
    });
    log.info("size tracker initialized", { logPath });
    return cachedStream;
  } catch (error) {
    initFailed = true;
    log.warn("size tracker init failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function approxMessageLength(msg: AgentMessage): number {
  const content = (msg as { content?: unknown }).content;
  if (typeof content === "string") {
    return content.length;
  }
  if (Array.isArray(content)) {
    let total = 0;
    for (const block of content) {
      if (typeof block === "string") {
        total += block.length;
      } else if (block && typeof block === "object") {
        try {
          total += JSON.stringify(block).length;
        } catch {
          // skip unserialisable block
        }
      }
    }
    return total;
  }
  try {
    return JSON.stringify(msg).length;
  } catch {
    return 0;
  }
}

function messagesCharSize(messages: AgentMessage[]): {
  count: number;
  chars: number;
  lastUserChars: number;
  lastAssistantChars: number;
} {
  let chars = 0;
  let lastUserChars = 0;
  let lastAssistantChars = 0;
  for (const msg of messages) {
    const len = approxMessageLength(msg);
    chars += len;
    if (msg.role === "user") {
      lastUserChars = len;
    } else if (msg.role === "assistant") {
      lastAssistantChars = len;
    }
  }
  return { count: messages.length, chars, lastUserChars, lastAssistantChars };
}

function toolsCharSize(tools: unknown[]): { count: number; chars: number } {
  if (!Array.isArray(tools)) {
    return { count: 0, chars: 0 };
  }
  let chars = 0;
  for (const tool of tools) {
    try {
      chars += JSON.stringify(tool).length;
    } catch {
      // skip
    }
  }
  return { count: tools.length, chars };
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

export type SizeRecord = {
  runId?: string;
  sessionKey?: string;
  provider?: string;
  modelId?: string;
  systemPrompt?: string;
  systemPromptBase?: string;
  tools?: unknown[];
  messages: AgentMessage[];
};

export function recordSizes(rec: SizeRecord): void {
  if (!isEnabled()) {
    return;
  }
  try {
    const stream = getStream();
    if (!stream) {
      return;
    }
    const now = Date.now();
    const isoDate = new Date(now).toISOString().slice(0, 10);
    const sys = rec.systemPrompt ?? "";
    const sysBase = rec.systemPromptBase ?? sys;
    const summariesChars = Math.max(0, sys.length - sysBase.length);
    const t = toolsCharSize(rec.tools ?? []);
    const m = messagesCharSize(rec.messages);
    const rawUsage = findLastAssistantUsage(rec.messages);
    const usage = rawUsage ? normalizeUsage(rawUsage) : undefined;
    const line = JSON.stringify({
      ts: now,
      iso_date: isoDate,
      run_id: rec.runId ?? null,
      session_key: rec.sessionKey ?? null,
      agent_id: resolveAgentIdFromSessionKey(rec.sessionKey),
      provider: rec.provider ?? null,
      model: rec.modelId ?? null,
      system_chars: sys.length,
      system_lines: sys ? sys.split("\n").length : 0,
      summaries_chars: summariesChars,
      tools_count: t.count,
      tools_chars: t.chars,
      messages_count: m.count,
      messages_chars: m.chars,
      last_user_chars: m.lastUserChars,
      last_assistant_chars: m.lastAssistantChars,
      input_tokens: usage?.input ?? 0,
      cache_read_tokens: usage?.cacheRead ?? 0,
      cache_create_tokens: usage?.cacheWrite ?? 0,
      output_tokens: usage?.output ?? 0,
    });
    stream.write(`${line}\n`);
  } catch (error) {
    // observability must never crash the agent
    log.warn("size tracker write failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
