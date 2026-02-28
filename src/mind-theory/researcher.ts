import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import type { OpenClawConfig } from "../config/types.js";
import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";
import { isResearcherEnabled } from "./config.js";

const PYTHON_VENV = join(homedir(), ".openclaw/shared/mind-theory/experiments/.venv/bin/python3");
const DAEMON_SCRIPT = "live_researcher_daemon.py";
const SUBPROCESS_SCRIPT = "live_researcher.py";
const DAEMON_CWD = join(homedir(), ".openclaw/shared/mind-theory/memory/offline-test");

export type ResearcherParams = {
  sessionKey: string;
  lastUserMessage: string;
  config?: OpenClawConfig;
};

export type EvokedMemory = { fact: string; score: number };

// ---------------------------------------------------------------------------
// Daemon singleton state
// ---------------------------------------------------------------------------

type PendingQuery = {
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let daemon: ChildProcess | null = null;
let daemonReady = false;
let daemonReadyPromise: Promise<boolean> | null = null;
let daemonReadline: ReadlineInterface | null = null;
const responseQueue: PendingQuery[] = [];

// ---------------------------------------------------------------------------
// Daemon lifecycle
// ---------------------------------------------------------------------------

function spawnDaemon(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON_VENV, [DAEMON_SCRIPT], {
      cwd: DAEMON_CWD,
      stdio: ["pipe", "pipe", "pipe"],
    });

    daemon = proc;
    daemonReady = false;

    // Timeout for ready signal
    const readyTimeout = setTimeout(() => {
      console.log("[mind-theory] researcher daemon: ready timeout (10s)");
      teardownDaemon("ready timeout");
      resolve(false);
    }, 10_000);

    // Log stderr (Python logging goes there)
    proc.stderr.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().trim().split("\n")) {
        if (line) {
          console.log(`[mind-theory] daemon: ${line}`);
        }
      }
    });

    // Read stdout line-by-line (FIFO dispatch)
    const rl = createInterface({ input: proc.stdout });
    daemonReadline = rl;

    rl.on("line", (line: string) => {
      if (!daemonReady) {
        // First line should be {"ready": true}
        try {
          const msg = JSON.parse(line) as { ready?: boolean };
          if (msg.ready) {
            daemonReady = true;
            clearTimeout(readyTimeout);
            console.log("[mind-theory] researcher daemon: ready");
            resolve(true);
            return;
          }
        } catch {
          // Not valid JSON, ignore
        }
        return;
      }

      // FIFO: dispatch to oldest pending query
      const pending = responseQueue.shift();
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(line);
      }
    });

    proc.on("exit", (code, signal) => {
      console.log(`[mind-theory] researcher daemon: exited (code=${code}, signal=${signal})`);
      clearTimeout(readyTimeout);
      teardownDaemon("process exited");
      if (!daemonReady) {
        resolve(false);
      }
    });

    proc.on("error", (err) => {
      console.log(`[mind-theory] researcher daemon: spawn error — ${err.message}`);
      clearTimeout(readyTimeout);
      teardownDaemon("spawn error");
      resolve(false);
    });
  });
}

function teardownDaemon(reason: string): void {
  const proc = daemon;
  daemon = null;
  daemonReady = false;
  daemonReadyPromise = null;

  if (daemonReadline) {
    daemonReadline.close();
    daemonReadline = null;
  }

  // Reject all pending queries
  while (responseQueue.length > 0) {
    const pending = responseQueue.shift()!;
    clearTimeout(pending.timer);
    pending.reject(new Error(`daemon teardown: ${reason}`));
  }

  if (proc && !proc.killed) {
    try {
      proc.kill("SIGTERM");
    } catch {
      // already dead
    }
  }
}

async function ensureDaemon(): Promise<boolean> {
  if (daemon && daemonReady) {
    return true;
  }
  // If a spawn is already in progress, wait for it
  if (daemonReadyPromise) {
    return daemonReadyPromise;
  }
  daemonReadyPromise = spawnDaemon();
  return daemonReadyPromise;
}

function queryDaemon(stdinData: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!daemon || !daemonReady || !daemon.stdin?.writable) {
      reject(new Error("daemon not available"));
      return;
    }

    const timer = setTimeout(() => {
      // Remove from queue on timeout
      const idx = responseQueue.findIndex((p) => p.timer === timer);
      if (idx !== -1) {
        responseQueue.splice(idx, 1);
      }
      reject(new Error(`daemon query timeout (${timeoutMs}ms)`));
    }, timeoutMs);

    responseQueue.push({ resolve, reject, timer });

    try {
      daemon.stdin.write(stdinData + "\n");
    } catch (err) {
      // EPIPE — daemon died between check and write
      const idx = responseQueue.findIndex((p) => p.timer === timer);
      if (idx !== -1) {
        responseQueue.splice(idx, 1);
      }
      clearTimeout(timer);
      reject(new Error(`daemon stdin write failed: ${String(err)}`));
    }
  });
}

/** Shut down the researcher daemon. Called on gateway close. */
export function shutdownResearcherDaemon(): void {
  if (daemon) {
    console.log("[mind-theory] researcher daemon: shutting down");
    teardownDaemon("gateway shutdown");
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the Researcher synchronously before the agent sees the turn.
 * Tries daemon first, falls back to subprocess on failure.
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

  // Try daemon first
  try {
    const ready = await ensureDaemon();
    if (ready) {
      const stdout = await queryDaemon(stdinData, 10_000);
      const elapsed = Date.now() - startMs;
      const parsed = JSON.parse(stdout) as {
        injected?: EvokedMemory[];
        latency_ms?: number;
        cooldown?: boolean;
      };
      const memories = parsed.injected ?? [];
      const cooldownNote = parsed.cooldown ? " (cooldown)" : "";
      console.log(
        `[mind-theory] researcher: daemon done for ${agentId} — ${memories.length} injected in ${elapsed}ms${cooldownNote}`,
      );
      return { memories, latencyMs: elapsed };
    }
  } catch (err) {
    console.log(
      `[mind-theory] researcher: daemon failed, falling back to subprocess — ${String(err)}`,
    );
  }

  // Fallback to subprocess
  try {
    const stdout = await spawnResearcher(stdinData, 10_000);
    const elapsed = Date.now() - startMs;
    const parsed = JSON.parse(stdout) as { injected?: EvokedMemory[]; latency_ms?: number };
    const memories = parsed.injected ?? [];
    console.log(
      `[mind-theory] researcher: subprocess done for ${agentId} — ${memories.length} injected in ${elapsed}ms`,
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
    const proc = spawn(PYTHON_VENV, [SUBPROCESS_SCRIPT], {
      cwd: DAEMON_CWD,
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
