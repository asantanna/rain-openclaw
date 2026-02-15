import { Type } from "@sinclair/typebox";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AnyAgentTool } from "./common.js";
import { CONFIG_DIR } from "../../utils.js";
import { jsonResult, readStringParam } from "./common.js";

const MANAGED_SCRIPTS_DIR = path.join(CONFIG_DIR, "managed_scripts");
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 50 * 1024;

const INTERPRETER_MAP: Record<string, string> = {
  ".py": "python3",
  ".sh": "bash",
  ".js": "node",
  ".mjs": "node",
};

const RunManagedScriptSchema = Type.Object({
  script: Type.String({ description: "Script filename (e.g. 'read_session.py')" }),
  args: Type.Optional(
    Type.String({ description: "Arguments (e.g. 'list --agent rain --active 60')" }),
  ),
});

function validateScriptName(name: string): void {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new Error(`Invalid script name: ${name}`);
  }
  if (name.includes("..")) {
    throw new Error(`Invalid script name: ${name}`);
  }
}

function resolveInterpreter(scriptPath: string): string | undefined {
  const ext = path.extname(scriptPath).toLowerCase();
  return INTERPRETER_MAP[ext];
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max) + `\n... (truncated at ${max} bytes)`;
}

export function createRunManagedScriptTool(): AnyAgentTool {
  return {
    label: "Run Managed Script",
    name: "run_managed_script",
    description: [
      "Run a pre-approved script from the managed_scripts directory.",
      "Scripts are placed there by the system administrator and cannot be modified by agents.",
      "Check your available skills for documentation on which scripts exist and how to use them.",
    ].join(" "),
    parameters: RunManagedScriptSchema,

    execute: async (_toolCallId, rawParams, signal) => {
      const params = rawParams as Record<string, unknown>;
      const scriptName = readStringParam(params, "script", { required: true });
      const argsStr = readStringParam(params, "args") ?? "";

      validateScriptName(scriptName);

      // Resolve and verify containment.
      const candidate = path.join(MANAGED_SCRIPTS_DIR, scriptName);
      let resolvedScript: string;
      let resolvedBase: string;
      try {
        resolvedScript = fs.realpathSync(candidate);
        resolvedBase = fs.realpathSync(MANAGED_SCRIPTS_DIR);
      } catch {
        throw new Error(`Script not found: ${scriptName}`);
      }

      if (!resolvedScript.startsWith(resolvedBase + path.sep)) {
        throw new Error(`Script not found: ${scriptName}`);
      }

      if (!fs.statSync(resolvedScript).isFile()) {
        throw new Error(`Script not found: ${scriptName}`);
      }

      // Build command.
      const interpreter = resolveInterpreter(resolvedScript);
      const argsList = argsStr.trim() ? argsStr.trim().split(/\s+/) : [];
      const cmd = interpreter ? interpreter : resolvedScript;
      const cmdArgs = interpreter ? [resolvedScript, ...argsList] : argsList;

      // Execute.
      return new Promise((resolve, reject) => {
        const child = execFile(
          cmd,
          cmdArgs,
          {
            timeout: TIMEOUT_MS,
            maxBuffer: MAX_OUTPUT * 2,
            env: { ...process.env, PYTHONUNBUFFERED: "1" },
          },
          (error, stdout, stderr) => {
            const exitCode =
              error && "code" in error ? ((error as { code?: number }).code ?? 1) : 0;
            const ok = exitCode === 0;
            resolve(
              jsonResult({
                ok,
                exitCode,
                stdout: truncate(stdout, MAX_OUTPUT),
                ...(stderr.trim() ? { stderr: truncate(stderr, MAX_OUTPUT) } : {}),
              }),
            );
          },
        );

        if (signal) {
          const onAbort = () => {
            child.kill("SIGTERM");
            reject(new Error("Script execution aborted"));
          };
          if (signal.aborted) {
            child.kill("SIGTERM");
            reject(new Error("Script execution aborted"));
          } else {
            signal.addEventListener("abort", onAbort, { once: true });
            child.on("close", () => signal.removeEventListener("abort", onAbort));
          }
        }
      });
    },
  };
}
