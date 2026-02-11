# Decision: `run_managed_script` Built-in Tool

**Date:** 2026-02-10
**Status:** Implemented

## Context

Rain and Tio Claude have `bash` locked down for safety — they can't execute arbitrary commands. But we created managed scripts (like `read_session.py` for the session_reader skill) that they'd benefit from running. The question: how do agents use scripts without opening bash?

## Problem

Bash access is all-or-nothing in the tool system. Granting bash would let agents run any command. We need a narrow path that lets them run specific admin-approved scripts while keeping everything else locked.

## Decision

Create a new built-in tool `run_managed_script` that:

- **Only** runs scripts from `~/.openclaw/managed_scripts/` — a flat, admin-controlled directory
- Agents cannot modify the scripts directory (it's outside their workspace)
- Must be explicitly granted per-agent via `tools.alsoAllow` in config

### Two-layer architecture

1. **Tool layer** (`run_managed_script`): Generic, secure executor. Knows nothing about what scripts do. Handles security: path containment via `realpath`, `execFile` (no shell injection), name validation, 30s timeout, 50KB output cap.

2. **Skills layer** (SKILL.md files): Discovery and documentation. Each skill tells the agent what scripts exist and how to invoke the tool with the right parameters. Example: the `session_reader` skill documents `run_managed_script script="read_session.py" args="list --agent rain"`.

### Future pattern

Adding a new capability follows the same pattern:

1. Place a new script in `~/.openclaw/managed_scripts/`
2. Create a SKILL.md that documents how to invoke it via the tool
3. No code changes needed — the tool is generic

## Alternatives Considered

1. **Grant bash access with restrictions**: No mechanism for partial bash — it's all or nothing.
2. **Per-script tool wrappers**: Too much code churn for each new script.
3. **Allowlisted bash commands**: Would require maintaining a command parser with security implications.

## Security Model

- Script name validation: rejects `/`, `..`, `\`, null bytes
- Path containment: `fs.realpathSync()` verifies resolved path is inside managed_scripts/
- No shell: `execFile` (not `exec`) prevents injection
- Interpreter detection by extension: `.py` → `python3`, `.sh` → `bash`, `.js`/`.mjs` → `node`
- 30-second timeout, 50KB output cap
- Abort signal support for cancellation

## Files

- `src/agents/tools/run-managed-script-tool.ts` — tool implementation
- `src/agents/openclaw-tools.ts` — registration
- `src/agents/tool-policy.ts` — added to `group:openclaw`
- `skills/session_reader/SKILL.md` — rewritten as tool-based docs
- `workspace/TOOLS.md`, `workspace-tio-claude/TOOLS.md` — agent-facing docs

## Related Decision

TOOLS.md was made repo-authoritative (added to `deploy_to_live.sh` whitelist) as part of this work, since tool definitions are structural decisions that should be admin-controlled.
