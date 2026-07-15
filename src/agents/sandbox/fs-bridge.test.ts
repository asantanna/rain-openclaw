import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./docker.js", () => ({
  execDockerRaw: vi.fn(),
}));

import type { SandboxContext } from "./types.js";
import { execDockerRaw } from "./docker.js";
import { createSandboxFsBridge } from "./fs-bridge.js";

const mockedExecDockerRaw = vi.mocked(execDockerRaw);

const sandbox: SandboxContext = {
  enabled: true,
  sessionKey: "sandbox:test",
  workspaceDir: "/tmp/workspace",
  agentWorkspaceDir: "/tmp/workspace",
  workspaceAccess: "rw",
  containerName: "moltbot-sbx-test",
  containerWorkdir: "/workspace",
  docker: {
    image: "moltbot-sandbox:bookworm-slim",
    containerPrefix: "moltbot-sbx-",
    network: "none",
    user: "1000:1000",
    workdir: "/workspace",
    readOnlyRoot: false,
    tmpfs: [],
    capDrop: [],
    seccompProfile: "",
    apparmorProfile: "",
    setupCommand: "",
    binds: [],
    dns: [],
    extraHosts: [],
    pidsLimit: 0,
  },
  tools: { allow: ["*"], deny: [] },
  browserAllowHostControl: false,
};

describe("sandbox fs bridge shell compatibility", () => {
  beforeEach(() => {
    mockedExecDockerRaw.mockReset();
    mockedExecDockerRaw.mockImplementation(async (args) => {
      const script = args[5] ?? "";
      if (script.includes('stat -c "%F|%s|%Y"')) {
        return {
          stdout: Buffer.from("regular file|1|2"),
          stderr: Buffer.alloc(0),
          code: 0,
        };
      }
      if (script.includes('cat -- "$1"')) {
        return {
          stdout: Buffer.from("content"),
          stderr: Buffer.alloc(0),
          code: 0,
        };
      }
      return {
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        code: 0,
      };
    });
  });

  it("uses POSIX-safe shell prologue in all bridge commands", async () => {
    const bridge = createSandboxFsBridge({ sandbox });

    await bridge.readFile({ filePath: "a.txt" });
    await bridge.writeFile({ filePath: "b.txt", data: "hello" });
    await bridge.mkdirp({ filePath: "nested" });
    await bridge.remove({ filePath: "b.txt" });
    await bridge.rename({ from: "a.txt", to: "c.txt" });
    await bridge.stat({ filePath: "c.txt" });

    expect(mockedExecDockerRaw).toHaveBeenCalled();

    const scripts = mockedExecDockerRaw.mock.calls.map(([args]) => args[5] ?? "");
    const executables = mockedExecDockerRaw.mock.calls.map(([args]) => args[3] ?? "");

    expect(executables.every((shell) => shell === "sh")).toBe(true);
    expect(scripts.every((script) => script.includes("set -eu;"))).toBe(true);
    expect(scripts.some((script) => script.includes("pipefail"))).toBe(false);
  });
});

describe("sandbox fs bridge container-mount paths", () => {
  const mounted: SandboxContext = {
    ...sandbox,
    workspaceDir: "/home/rain/.openclaw/workspace",
    agentWorkspaceDir: "/home/rain/.openclaw/workspace",
    docker: {
      ...sandbox.docker,
      binds: [
        "/home/rain/.openclaw/shared:/workspace/shared:rw",
        "/tmp:/workspace/tmp_host:rw",
        "/home/rain/.openclaw/agents/rain:/workspace/agent-data:ro",
      ],
    },
  };

  it("resolves a container-absolute extra-mount path via the mount table", () => {
    const bridge = createSandboxFsBridge({ sandbox: mounted });
    const resolved = bridge.resolvePath({
      filePath: "/workspace/tmp_host/team_discussion.md",
    });
    expect(resolved.containerPath).toBe("/workspace/tmp_host/team_discussion.md");
    expect(resolved.relativePath).toBe("tmp_host/team_discussion.md");
    // longest-prefix wins: the /workspace/tmp_host bind, not the workspace root.
    expect(resolved.hostPath).toBe("/tmp/team_discussion.md");
  });

  it("maps a container path under the workspace root back to the host workspace", () => {
    const bridge = createSandboxFsBridge({ sandbox: mounted });
    const resolved = bridge.resolvePath({ filePath: "/workspace/self/scratchpad.md" });
    expect(resolved.containerPath).toBe("/workspace/self/scratchpad.md");
    expect(resolved.hostPath).toBe("/home/rain/.openclaw/workspace/self/scratchpad.md");
  });

  it("execs cat against the container path when reading an extra-mount file", async () => {
    mockedExecDockerRaw.mockClear();
    const bridge = createSandboxFsBridge({ sandbox: mounted });
    await bridge.readFile({ filePath: "/workspace/tmp_host/foo.md" });
    const [args] = mockedExecDockerRaw.mock.calls[0];
    // last positional arg is the resolved container path handed to `cat -- "$1"`.
    expect(args[args.length - 1]).toBe("/workspace/tmp_host/foo.md");
  });

  it("rejects a container path that climbs out of the workdir via ..", () => {
    const bridge = createSandboxFsBridge({ sandbox: mounted });
    expect(() => bridge.resolvePath({ filePath: "/workspace/tmp_host/../../etc/passwd" })).toThrow(
      /escapes sandbox root/,
    );
  });

  it("leaves plain relative paths resolving against the workspace root", () => {
    const bridge = createSandboxFsBridge({ sandbox: mounted });
    const resolved = bridge.resolvePath({ filePath: "notes.md" });
    expect(resolved.containerPath).toBe("/workspace/notes.md");
    expect(resolved.hostPath).toBe("/home/rain/.openclaw/workspace/notes.md");
  });
});
