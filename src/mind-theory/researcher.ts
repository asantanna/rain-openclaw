import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OpenClawConfig } from "../config/types.js";
import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";
import { isResearcherEnabled } from "./config.js";

const PYTHON_VENV = join(homedir(), ".openclaw/shared/mind-theory/experiments/.venv/bin/python3");

export type ResearcherParams = {
  sessionKey: string;
  lastUserMessage: string;
  config?: OpenClawConfig;
};

export type EvokedMemory = { fact: string; score: number };

/**
 * Run the Researcher synchronously before the agent sees the turn.
 * Returns evoked memories for injection into the conversation context.
 * Never throws — returns empty on any failure.
 */
export async function runResearcherSync(params: ResearcherParams): Promise<{
  memories: EvokedMemory[];
  latencyMs: number;
}> {
  const empty = { memories: [] as EvokedMemory[], latencyMs: -1 };

  if (!isResearcherEnabled(params.config)) {
    return empty;
  }

  const agentId = resolveAgentIdFromSessionKey(params.sessionKey);
  if (!agentId || agentId === "main") {
    return empty;
  }

  const query = stripInboundMeta(params.lastUserMessage);
  if (!query || query.length < 10) {
    return empty;
  }

  const dbPath = join(homedir(), `.openclaw/agents/${agentId}/memories.sqlite`);
  const logPath = join(homedir(), `.openclaw/agents/${agentId}/researcher.log`);

  const stdinData = JSON.stringify({
    query,
    agent_id: agentId,
    db_path: dbPath,
    session_key: params.sessionKey,
    log_path: logPath,
  });

  const startMs = Date.now();
  console.log(`[mind-theory] researcher: sync search for ${agentId}`);

  try {
    const stdout = await spawnResearcher(stdinData, 10_000);
    const elapsed = Date.now() - startMs;
    const parsed = JSON.parse(stdout) as { injected?: EvokedMemory[]; latency_ms?: number };
    const memories = parsed.injected ?? [];
    console.log(
      `[mind-theory] researcher: sync done for ${agentId} — ${memories.length} injected in ${elapsed}ms`,
    );
    return { memories, latencyMs: elapsed };
  } catch (err) {
    const elapsed = Date.now() - startMs;
    console.log(
      `[mind-theory] researcher: sync failed for ${agentId} after ${elapsed}ms — ${String(err)}`,
    );
    return empty;
  }
}

/**
 * Run the Researcher asynchronously after each agent turn.
 * Fire-and-forget — never throws, never blocks the response.
 * Used for log-only mode when injection is disabled.
 */
export function runResearcherAsync(params: ResearcherParams): void {
  if (!isResearcherEnabled(params.config)) {
    return;
  }

  const agentId = resolveAgentIdFromSessionKey(params.sessionKey);
  if (!agentId || agentId === "main") {
    return;
  }

  const query = stripInboundMeta(params.lastUserMessage);
  if (!query || query.length < 10) {
    return;
  }

  const dbPath = join(homedir(), `.openclaw/agents/${agentId}/memories.sqlite`);
  const logPath = join(homedir(), `.openclaw/agents/${agentId}/researcher.log`);

  const stdinData = JSON.stringify({
    query,
    agent_id: agentId,
    db_path: dbPath,
    session_key: params.sessionKey,
    log_path: logPath,
  });

  console.log(`[mind-theory] researcher: searching for ${agentId}`);

  // Fire-and-forget — don't await
  spawnResearcher(stdinData).catch((err) => {
    console.log(`[mind-theory] researcher: failed — ${String(err)}`);
  });
}

/**
 * Strip OpenClaw inbound context metadata from commandBody to get the raw user text.
 * Removes: "Conversation info (untrusted metadata):" blocks, "Sender (untrusted metadata):" blocks,
 * and other fenced JSON metadata blocks, plus the relay "[senderName]: " prefix.
 */
function stripInboundMeta(text: string): string {
  // Remove all "(untrusted metadata/context):" blocks with their fenced JSON
  let cleaned = text.replace(/(?:^|\n\n?)[\w\s]+\(untrusted[\w\s,]*\):\n```json\n[\s\S]*?```/g, "");
  // Strip relay "[senderName]: " prefix at the start of the remaining text
  cleaned = cleaned.trim().replace(/^\[[\w\s-]+\]:\s*/, "");
  return cleaned.trim();
}

function spawnResearcher(stdinData: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const cwd = join(homedir(), ".openclaw/shared/mind-theory/memory/offline-test");
    const proc = spawn(PYTHON_VENV, ["live_researcher.py"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (stderr.trim()) {
        for (const line of stderr.trim().split("\n")) {
          console.log(`[mind-theory] py: ${line}`);
        }
      }
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`live_researcher.py exited with code ${code}: ${stderr.trim()}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn live_researcher.py: ${err.message}`));
    });

    proc.stdin.write(stdinData);
    proc.stdin.end();
  });
}
