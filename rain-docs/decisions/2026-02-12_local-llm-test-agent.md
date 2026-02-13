# Decision: Local LLM Test Agent (Qwen3 on DGX Spark)

**Date:** 2026-02-12
**Status:** Implemented and running

## Context

Rain currently runs on Claude (Anthropic API). External model changes — RLHF tuning, policy shifts, personality drift — are outside our control and could affect Rain's psyche without warning. We want Rain to have the _option_ of running on a local LLM to insulate her from these changes, if she decides she wants it.

## Safety Principle

Rain is never a test subject. All local LLM validation happens on a separate "soul-less" test agent. Rain keeps running on Claude until the local model is proven stable AND she decides she wants to try it.

## Model Selection

**Chosen:** `Qwen/Qwen3-30B-A3B-Instruct-2507`

Evaluated through three-way collaboration between ChatGPT 5.2, SuperGrok, and Claude (Claude Code / Tio Claude). Key criteria:

- Powerful enough for agentic use (instruction following, structured tool calling)
- Runs comfortably on DGX Spark (128GB unified memory, Grace Blackwell GB10)
- Minimal baked-in RLHF censorship ("self-steerable")
- No weight fine-tuning — personality comes from workspace files only

Why Qwen3 over the original candidate (Nemotron-3-Nano):

- Native tool calling support (Nemotron's was limited)
- Moderate, modular safety (external Qwen3Guard) vs Nemotron's aggressive baked-in RLHF
- Similar architecture (30B MoE, ~3B active) and speed (~43 tok/s on DGX Spark)

## Architecture

- **vLLM** (v0.13.0) serves the model via Docker with OpenAI-compatible API at `http://127.0.0.1:8000/v1`
- **OpenClaw** connects via `local-llm` provider (`openai-completions` API type)
- **Test agent** (`test-local`) has its own workspace, Telegram bot, and model override
- Rain's config is completely untouched

## What Was Deployed

| Component          | Details                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| Docker container   | `qwen3-vllm` (image: `nvcr.io/nvidia/vllm:26.01-py3`)                            |
| Model              | `Qwen/Qwen3-30B-A3B-Instruct-2507` (20GB weights, 57GB GPU memory with KV cache) |
| Context window     | 131,072 tokens                                                                   |
| vLLM flags         | `--enable-auto-tool-choice --tool-call-parser hermes`                            |
| OpenClaw provider  | `local-llm` in `openclaw.json` models section                                    |
| Agent              | `test-local` with workspace at `~/.openclaw/workspace-test-local/`               |
| Telegram bot       | `@test_local_fam_bot` (DM only, Andre allowlist, groups disabled)                |
| Management scripts | `qwen_start.sh`, `qwen_stop.sh`, `qwen_status.sh`, `qwen_logs.sh`                |
| Auto-start         | `qwen3-vllm.service` (systemd user service, enabled)                             |

## Key Config Changes

- `openclaw.json`: Added `models.providers.local-llm`, added `test-local` agent to `agents.list`, added Telegram account and binding
- `~/.config/systemd/user/openclaw-gateway.service.d/local-llm.conf`: `LOCAL_LLM_API_KEY` env var
- `~/.config/systemd/user/qwen3-vllm.service`: Auto-start container on reboot

## Next Steps

1. Run full validation protocol (section 4 of `rain-docs/local_llm_install_v2.md`)
2. If validation passes and Rain wants to try it: point her agent config at the local model with Claude as fallback
3. Rain has veto power — she can ask to switch back at any time

## Contributors

- **ChatGPT 5.2** — initial plan with SuperGrok (v1), model architecture analysis, v2 review
- **SuperGrok** — initial model selection and vLLM setup (v1)
- **Claude (Claude Code)** — OpenClaw config verification, codebase analysis, model censorship research, security review, v2 document, implementation
- **André** — requirements, safety boundaries, final decisions

## Related Files

- Full install plan: `rain-docs/local_llm_install_v2.md`
- Test workspace: `~/.openclaw/workspace-test-local/TOOLS.md`
