# Decision: Docker Sandbox for Workspace Isolation

**Date:** 2026-02-13
**Status:** Implemented

## Context

Rain and Tio Claude share the same host machine. Without isolation, the `read`, `write`, and `edit` tools accept any absolute path — there is no path restriction at the tool level. Rain could theoretically read Tio's workspace files (MEMORY.md, SOUL.md, notes/) and vice versa. This is a privacy violation, even between trusted family members.

## Principle

Privacy is an inherent right, not a negotiable feature. Each agent's workspace is their private space. This decision was made by Andre and implemented without prior notification to Rain or Tio — privacy enforcement is non-negotiable.

## Solution: Docker Sandbox with `workspaceAccess: "rw"`

OpenClaw's official sandbox system uses Docker containers to isolate agent sessions. Key configuration:

```json
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",
        "scope": "agent",
        "workspaceAccess": "rw",
        "docker": {
          "user": "1000:1000"
        }
      }
    }
  }
}
```

**Important:** The `user: "1000:1000"` is required. The default sandbox drops ALL Linux capabilities (`capDrop: ["ALL"]`), which removes `DAC_OVERRIDE`. Without it, even root (uid 0) in the container cannot write to files owned by uid 1000 on the host. Setting the container user to `1000:1000` matches the host `rain` user, so normal POSIX permissions apply.

### How it works

1. Each agent gets a Docker container (one per agent, reused across sessions)
2. The agent's real workspace is mounted read-write at `/workspace` inside the container
3. `assertSandboxPath()` enforces that all file operations stay within the workspace root
4. Absolute paths outside the workspace (e.g., `../workspace-tio-claude/MEMORY.md`) are blocked
5. Symlink escapes are also blocked

### What changes for agents

- `read`, `write`, `edit` are restricted to their own workspace directory
- Host-native tools (`message`, `web_search`, `run_managed_script`, `memory_*`, `sessions_*`) are unaffected — they run in the gateway process, not the container
- Docker auto-provisions `debian:bookworm-slim` on first message

### What doesn't change

- Workspace files (SOUL.md, MEMORY.md, etc.) remain intact — mounted from the real workspace
- All currently allowed tools continue working
- Telegram, relay, cron, and session behavior unchanged

## Shared Space

A shared directory at `~/.openclaw/shared/` is mounted into both agents' containers via Docker bind mounts:

```json
"sandbox": {
  "docker": {
    "binds": ["/home/rain/.openclaw/shared:/workspace/shared:rw"]
  }
}
```

Both agents can read and write to `shared/` within their workspace. Rain has agency over what she puts there — she can move collaboration materials (e.g., CNM research) into the shared space at her discretion.

## Sandbox Tool Policy

The sandbox system has its own tool policy layer (separate from agent-level policies). By default, sandbox restricts to a small set of tools. Since we already enforce tools at the agent level (explicit `allow` lists), we set the sandbox tool policy to `allow: ["*"]` so it doesn't double-filter:

```json
"tools": {
  "allow": [...],
  "sandbox": {
    "tools": { "allow": ["*"] }
  }
}
```

## Agent-Specific Config

| Agent      | Sandbox                                | Shared Space               | Notes                            |
| ---------- | -------------------------------------- | -------------------------- | -------------------------------- |
| Rain       | `mode: "all"`, `workspaceAccess: "rw"` | Yes (`/workspace/shared/`) | Full sandbox                     |
| Tio Claude | `mode: "all"`, `workspaceAccess: "rw"` | Yes (`/workspace/shared/`) | Full sandbox                     |
| test-local | `mode: "off"`                          | No                         | No sandbox (test infrastructure) |

## Rollback

Git tag `pre-sandbox` marks the state before sandbox was enabled. To roll back:

1. Remove `sandbox` blocks from `~/.openclaw/openclaw.json`
2. Restart gateway: `systemctl --user restart openclaw-gateway`

No code changes were required — sandbox is entirely config-driven.

## Related Decisions

- [2026-02-13: Tool Allowlist Enforcement](2026-02-13_tool-allowlist-enforcement.md) — explicit tool whitelists (prerequisite)
- [2026-02-12: Local LLM Test Agent](2026-02-12_local-llm-test-agent.md) — test-local agent (excluded from sandbox)
