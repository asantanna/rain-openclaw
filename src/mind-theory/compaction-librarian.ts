import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import type { OpenClawConfig } from "../config/types.js";
import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";
import {
  agentDisplayName,
  getNameMapping,
  isLibrarianEnabled,
  resolveMindTheoryConfig,
} from "./config.js";

const PYTHON_VENV = join(homedir(), ".openclaw/shared/mind-theory/experiments/.venv/bin/python3");

export type MindTheoryCompactionParams = {
  messages: unknown[];
  sessionKey: string;
  sessionFile: string;
  config?: OpenClawConfig;
};

/**
 * Run the batch Librarian before compaction.
 * Called from compact.ts BEFORE session.compact().
 * Must never throw — failure is logged but does not block compaction.
 */
export async function mindTheoryBeforeCompaction(
  params: MindTheoryCompactionParams,
): Promise<void> {
  if (!isLibrarianEnabled(params.config)) {
    return;
  }

  const mtConfig = resolveMindTheoryConfig(params.config);
  const agentId = resolveAgentIdFromSessionKey(params.sessionKey);
  if (!agentId || agentId === "main") {
    console.log(`[mind-theory] could not resolve agentId from sessionKey: ${params.sessionKey}`);
    return;
  }

  const dbPath = join(homedir(), `.openclaw/agents/${agentId}/memories.sqlite`);
  const agentName = agentDisplayName(agentId);
  const nameMapping = getNameMapping(agentId);

  // Serialize messages as role+content pairs for Python.
  // Strip any injected EVOKED MEMORIES blocks so the librarian doesn't
  // re-extract memories that were already in the DB (circular extraction).
  const simplifiedMessages = params.messages.map((msg: unknown) => {
    const m = msg as { role?: string; content?: unknown };
    let content = m.content ?? "";
    if (typeof content === "string") {
      content = stripEvokedMemoriesBlock(content);
    }
    return { role: m.role ?? "unknown", content };
  });

  const sessionFileUuid = basename(params.sessionFile, ".jsonl");
  const stdinData = JSON.stringify({
    messages: simplifiedMessages,
    session_key: params.sessionKey,
    session_file: sessionFileUuid,
    agent_id: agentId,
    agent_name: agentName,
    db_path: dbPath,
    model: mtConfig.librarian.model,
    name_mapping: nameMapping,
  });

  const startMs = Date.now();
  console.log(
    `[mind-theory] librarian: starting batch for ${agentId} (${simplifiedMessages.length} messages)`,
  );

  try {
    const result = await spawnPython(stdinData);
    const elapsed = Date.now() - startMs;
    console.log(`[mind-theory] librarian: done in ${elapsed}ms — ${result}`);
  } catch (err) {
    const elapsed = Date.now() - startMs;
    console.log(`[mind-theory] librarian: failed after ${elapsed}ms — ${String(err)}`);
  }
}

/** Remove ### EVOKED MEMORIES ... ### END EVOKED MEMORIES blocks from message text. */
function stripEvokedMemoriesBlock(text: string): string {
  return text.replace(/### EVOKED MEMORIES\n[\s\S]*?### END EVOKED MEMORIES\n*/g, "").trim();
}

function spawnPython(stdinData: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: Error) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    const cwd = join(homedir(), ".openclaw/shared/mind-theory/memory/live");
    let proc;
    try {
      proc = spawn(PYTHON_VENV, ["live_batch.py"], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 120_000, // 2 minute timeout
      });
    } catch (err) {
      fail(new Error(`Failed to spawn live_batch.py: ${String(err)}`));
      return;
    }

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // Catch EPIPE / write errors on stdin — the child may exit before we finish writing.
    proc.stdin.on("error", (err) => {
      fail(new Error(`stdin write failed: ${err.message}`));
    });

    proc.on("close", (code) => {
      // Log stderr (Python's logging goes there)
      if (stderr.trim()) {
        for (const line of stderr.trim().split("\n")) {
          console.log(`[mind-theory] py: ${line}`);
        }
      }
      if (settled) {
        return; // Already rejected (e.g. stdin EPIPE)
      }
      settled = true;
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`live_batch.py exited with code ${code}: ${stderr.trim()}`));
      }
    });

    proc.on("error", (err) => {
      fail(new Error(`Failed to spawn live_batch.py: ${err.message}`));
    });

    try {
      proc.stdin.write(stdinData);
      proc.stdin.end();
    } catch (err) {
      fail(new Error(`stdin write threw: ${String(err)}`));
    }
  });
}
