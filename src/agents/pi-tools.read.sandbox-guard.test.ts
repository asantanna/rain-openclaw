import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSandboxedReadTool } from "./pi-tools.read.js";
import { createHostSandboxFsBridge } from "./test-helpers/host-sandbox-fs-bridge.js";

// Regression for the container-absolute path guard: Rain could read a mount file
// via the relative form (`tmp_host/foo`) but the absolute container form
// (`/workspace/tmp_host/foo`) was rejected by the host-side sandbox guard before
// the (mount-aware) fs bridge was consulted. The guard now defers to the bridge
// and rewrites accepted container-absolute paths to the workspace-relative form.

function textFromResult(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content ?? [];
  return content
    .filter((c) => c?.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

describe("sandboxed read tool — container-absolute path guard", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-read-guard-"));
    await fs.writeFile(path.join(root, "note.txt"), "hello-from-workspace", "utf8");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("reads a workspace file via an absolute /workspace path", async () => {
    const tool = createSandboxedReadTool({ root, bridge: createHostSandboxFsBridge(root) });
    const result = await tool.execute("t1", { path: "/workspace/note.txt" });
    expect(textFromResult(result)).toContain("hello-from-workspace");
  });

  it("reads the same file via the relative path (unchanged behavior)", async () => {
    const tool = createSandboxedReadTool({ root, bridge: createHostSandboxFsBridge(root) });
    const result = await tool.execute("t2", { path: "note.txt" });
    expect(textFromResult(result)).toContain("hello-from-workspace");
  });

  it("still rejects a path that escapes the sandbox", async () => {
    const tool = createSandboxedReadTool({ root, bridge: createHostSandboxFsBridge(root) });
    await expect(tool.execute("t3", { path: "../../../etc/passwd" })).rejects.toThrow(
      /escapes sandbox root/i,
    );
  });
});
