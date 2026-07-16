import fs from "node:fs/promises";
import path from "node:path";
import type { SandboxFsBridge, SandboxFsStat, SandboxResolvedPath } from "../sandbox/fs-bridge.js";
import { resolveSandboxPath } from "../sandbox-paths.js";

export function createHostSandboxFsBridge(rootDir: string): SandboxFsBridge {
  const root = path.resolve(rootDir);

  const workdir = "/workspace";

  const resolvePath = (filePath: string, cwd?: string): SandboxResolvedPath => {
    // Mirror the real fs bridge: a container-absolute path under the workdir
    // (e.g. /workspace/tmp_host/foo) resolves directly as a container path,
    // mapped back onto the (single-mount) host root. Everything else goes
    // through the host-relative check.
    const trimmed = filePath.trim();
    if (path.posix.isAbsolute(trimmed)) {
      const normalized = path.posix.normalize(trimmed);
      if (normalized === workdir || normalized.startsWith(`${workdir}/`)) {
        const relativePath = normalized === workdir ? "" : path.posix.relative(workdir, normalized);
        return {
          hostPath: relativePath ? path.join(root, relativePath) : root,
          relativePath,
          containerPath: normalized,
        };
      }
    }

    const resolved = resolveSandboxPath({
      filePath,
      cwd: cwd ?? root,
      root,
    });
    const relativePath = resolved.relative
      ? resolved.relative.split(path.sep).filter(Boolean).join(path.posix.sep)
      : "";
    const containerPath = relativePath ? path.posix.join(workdir, relativePath) : workdir;
    return {
      hostPath: resolved.resolved,
      relativePath,
      containerPath,
    };
  };

  return {
    resolvePath: ({ filePath, cwd }) => resolvePath(filePath, cwd),
    readFile: async ({ filePath, cwd }) => {
      const target = resolvePath(filePath, cwd);
      return fs.readFile(target.hostPath);
    },
    writeFile: async ({ filePath, cwd, data, mkdir = true }) => {
      const target = resolvePath(filePath, cwd);
      if (mkdir) {
        await fs.mkdir(path.dirname(target.hostPath), { recursive: true });
      }
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      await fs.writeFile(target.hostPath, buffer);
    },
    mkdirp: async ({ filePath, cwd }) => {
      const target = resolvePath(filePath, cwd);
      await fs.mkdir(target.hostPath, { recursive: true });
    },
    remove: async ({ filePath, cwd, recursive, force }) => {
      const target = resolvePath(filePath, cwd);
      await fs.rm(target.hostPath, {
        recursive: recursive ?? false,
        force: force ?? false,
      });
    },
    rename: async ({ from, to, cwd }) => {
      const source = resolvePath(from, cwd);
      const target = resolvePath(to, cwd);
      await fs.mkdir(path.dirname(target.hostPath), { recursive: true });
      await fs.rename(source.hostPath, target.hostPath);
    },
    stat: async ({ filePath, cwd }) => {
      try {
        const target = resolvePath(filePath, cwd);
        const stats = await fs.stat(target.hostPath);
        return {
          type: stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other",
          size: stats.size,
          mtimeMs: stats.mtimeMs,
        } satisfies SandboxFsStat;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
  };
}
