import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";

const PYTHON_VENV = join(homedir(), ".openclaw/shared/mind-theory/experiments/.venv/bin/python3");
const SCRIPT = join(homedir(), ".openclaw/shared/mind-theory/memory/tools/session_to_readable.py");

/**
 * Convert a session JSONL file to a human-readable text transcript.
 * Spawns session_to_readable.py, captures stdout, writes to the agent's readable dir.
 * Never throws — failures are logged.
 */
export async function generateReadableTranscript(params: {
  sessionKey: string;
  sessionFile: string;
}): Promise<void> {
  const agentId = resolveAgentIdFromSessionKey(params.sessionKey);
  if (!agentId || agentId === "main") {
    return;
  }
  if (params.sessionKey.includes(":cron:")) {
    return;
  }

  const outDir = join(homedir(), `.openclaw/shared/readable-transcripts-${agentId}`);
  await mkdir(outDir, { recursive: true });

  const stem = basename(params.sessionFile, ".jsonl");
  const outFile = join(outDir, `${stem}.txt`);

  const stdout = await new Promise<string>((resolve, reject) => {
    const proc = spawn(PYTHON_VENV, [SCRIPT, params.sessionFile], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
    let out = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve(out);
      } else {
        reject(new Error(`exit ${code}`));
      }
    });
    proc.on("error", reject);
  });

  await writeFile(outFile, stdout);
  console.log(`[mind-theory] transcript: ${stem}.txt updated`);
}
