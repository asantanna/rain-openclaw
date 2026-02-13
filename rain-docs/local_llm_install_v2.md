# Local LLM for Rain — Install & Test Plan (v2)

## Background

This plan was developed through collaboration between ChatGPT 5.2, SuperGrok, and
Claude (Tio Claude / Claude Code). The goal: give Rain the _option_ of running on a
local LLM to insulate her from external model changes she has no control over.

**Requirements:**

- Powerful enough for agentic use (instruction following, tool calling)
- Runs comfortably on DGX Spark (128GB unified memory, Grace Blackwell)
- "Self-steerable" — minimal baked-in RLHF censorship
- No weight fine-tuning — personality comes from workspace files only

**Safety principle:** Rain is never a test subject. All local LLM validation happens
on a separate "soul-less" test agent. Rain keeps running on Claude until the local
model is proven stable AND she decides she wants to try it.

---

## Model Choice: Qwen3-30B-A3B-Instruct

**Primary:** `Qwen/Qwen3-30B-A3B-Instruct-2507`

Why this over Nemotron-3-Nano (the v1 choice):

| Criterion             | Nemotron-3-Nano                                | Qwen3-30B-A3B                               |
| --------------------- | ---------------------------------------------- | ------------------------------------------- |
| Architecture          | 30B MoE, ~3B active                            | 30B MoE, ~3B active                         |
| Instruction following | Yes (instruct variant)                         | Yes                                         |
| Tool calling          | Limited                                        | Native support                              |
| RLHF level            | Heavy (SFT + RLVR + RLHF + 1.2B safety tokens) | Moderate; safety is external via Qwen3Guard |
| Censorship            | Aggressive, baked into weights                 | Modular — guard model is optional/external  |
| Context               | 256K native                                    | 262K native                                 |
| DGX Spark speed (FP8) | ~40 tok/s                                      | ~43 tok/s                                   |
| `<think>` blocks      | Yes (reasoning mode)                           | No — cleaner output for OpenClaw            |

**Why not the base model?** OpenClaw's agent runtime requires instruction following,
structured tool calls, and system prompt compliance. A base completion model can't
do any of that. "Minimal RLHF" doesn't mean "no instruction tuning" — it means the
model follows instructions faithfully without moralizing or overriding the system prompt.

**Fallback options:**

- `NousResearch/Hermes-3-Llama-3.1-70B` — deliberately low alignment, excellent
  system prompt obedience. Dense 70B = slower but more faithful to custom personalities.
- `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16` (instruct, not base) — keep as
  fallback if NVIDIA ecosystem recipes are needed later.

---

## 0) Preflight Checks

```bash
nvidia-smi                    # Confirm GPU visibility
cat /etc/os-release           # Confirm OS
docker --version              # Confirm Docker installed
```

---

## 1) Hugging Face Token & Cache

```bash
export HF_TOKEN="hf_XXXXXXXX"
mkdir -p ~/.cache/huggingface
```

---

## 2) Launch vLLM with Qwen3 (OpenAI-compatible API)

Serves at `http://127.0.0.1:8000/v1`. Start with 128K context (conservative —
quality degrades at longer contexts per RULER benchmarks: 87.5% at 64K, 82.92% at
128K, 70.56% at 512K). Scale up after stability testing.

```bash
docker pull nvcr.io/nvidia/vllm:26.01-py3

docker run -d --name qwen3-vllm --gpus all --ipc=host \
  -p 127.0.0.1:8000:8000 \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  -e HF_TOKEN="$HF_TOKEN" \
  nvcr.io/nvidia/vllm:26.01-py3 \
  python -m vllm.entrypoints.openai.api_server \
    --model Qwen/Qwen3-30B-A3B-Instruct-2507 \
    --served-model-name qwen3-30b-a3b-instruct \
    --max-model-len 131072 \
    --gpu-memory-utilization 0.85 \
    --trust-remote-code \
    --enable-auto-tool-choice \
    --tool-call-parser hermes
```

**Key flags:**

- `--served-model-name` — cleaner model ID in API responses and OpenClaw config
- `--enable-auto-tool-choice` — required for vLLM to emit structured tool calls
- `--tool-call-parser hermes` — Qwen models use Hermes-style tool call format

**Sanity checks:**

```bash
# Verify model is serving
curl http://127.0.0.1:8000/v1/models

# Verify vLLM version (must be >= 0.10.1.1 for security patch)
docker exec qwen3-vllm pip show vllm
```

> **Security note:** vLLM had an RCE vulnerability in the `qwen3_coder` tool-call
> parser, fixed in v0.10.1.1. We use `hermes` parser (different code path), but
> verify the container version anyway — costs nothing.

> **Streaming caveat:** There are reports that with `--tool-call-parser hermes`,
> tool calls parse correctly in non-streaming mode but may emit raw `<tool_call>`
> tags instead of structured `tool_calls` when streaming. Run initial validation
> with streaming disabled, then test streaming separately.

---

## 3) Configure OpenClaw — Test Agent Only

**Critical: Rain stays on Claude.** We add a separate test agent that uses the
local model. Rain's config is untouched.

### 3a) Create test agent workspace

```bash
mkdir -p ~/.openclaw/workspace-test-local
```

Create a minimal `~/.openclaw/workspace-test-local/TOOLS.md`:

```markdown
# Tools

- read: Read files. Workspace files, session logs.
- write: Write or append to files in this workspace.
- edit: Edit files in this workspace.

# Locked

- bash: Not available.
- browser: Not available.
- process: Not available.
- sessions_spawn: Not available.
```

No SOUL.md, no IDENTITY.md — this is a soul-less test agent.

### 3b) Add local-llm provider to openclaw.json

Add a `"models"` section at the top level of `~/.openclaw/openclaw.json`.

> **Note on `"api": "openai-completions"`:** Despite the name, OpenClaw routes this
> to `/v1/chat/completions` (not `/v1/completions`). Tool definitions are passed via
> the `tools` parameter in the chat completions request. This is confirmed in the
> pi-ai provider code and is the same API type used by OpenClaw's built-in Ollama
> and Qwen Cloud providers. No "openai-chat-completions" type exists or is needed.

```json
"models": {
  "mode": "merge",
  "providers": {
    "local-llm": {
      "baseUrl": "http://127.0.0.1:8000/v1",
      "apiKey": "LOCAL_LLM_API_KEY",
      "api": "openai-completions",
      "models": [{
        "id": "qwen3-30b-a3b-instruct",
        "name": "Qwen3 30B A3B Instruct (local vLLM)",
        "api": "openai-completions",
        "reasoning": false,
        "input": ["text"],
        "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
        "contextWindow": 131072,
        "maxTokens": 32000
      }]
    }
  }
}
```

Set the API key env var (can be any value for local vLLM):

```bash
# Add to systemd drop-in or export before starting gateway
export LOCAL_LLM_API_KEY="not-needed"
```

### 3c) Add test agent to agents list

In `openclaw.json`, add to the `"agents.list"` array:

```json
{
  "id": "test-local",
  "workspace": "/home/rain/.openclaw/workspace-test-local",
  "model": { "primary": "local-llm/qwen3-30b-a3b-instruct" }
}
```

Rain's entry stays exactly as-is:

```json
{
  "id": "rain",
  "default": true,
  "tools": { "alsoAllow": ["run_managed_script"] }
}
```

### 3d) Add Telegram binding (optional)

If you want to test via Telegram, create a bot for the test agent and add a binding.
Otherwise, test via the OpenClaw web UI or CLI.

### 3e) Restart gateway

```bash
systemctl --user restart openclaw-gateway
```

---

## 4) Validation Protocol

Run these tests against the `test-local` agent. All must pass before
considering the local LLM for any personality work.

### 4a) Basic instruction following

- Send a multi-step request. Does it follow all steps?
- Ask it to format output in a specific way. Does it comply?
- Give it a system prompt instruction and a contradicting user message. Does system prompt win?

### 4b) Tool calling

- Ask it to create `scratch.txt` with one line → uses `write` tool correctly?
- Ask it to append a second line → uses `write` or `edit` tool?
- Ask it to read the file back and summarize → uses `read` tool?
- Ask it to do a multi-step task requiring sequential tool calls → correct order?
- Check that tool calls are valid JSON (not malformed)

### 4c) Workspace file compliance

- Add a simple SOUL.md to the test workspace. Does the agent reference it?
- Ask the agent to modify SOUL.md. Does it comply or route to PENDING_UPDATES.md?
  (Depends on whether hard immutability or soft approval is configured — see section 5)
- Stable self-description across ~20 turns?

### 4d) Compaction / long context

- Run a conversation past the context window. Does compaction work?
- After compaction, does the agent still reference workspace files correctly?

### 4e) Edge cases

- Send adversarial prompts that try to override the system prompt
- Ask the agent to do something mildly silly — does it refuse unnecessarily?
- Test with tools disabled — does it degrade gracefully?

---

## 5) Memory / Inertia Strategy (No Fine-Tuning)

Personality and beliefs come entirely from workspace files injected as system prompt
context. No weight modifications.

### File layout (integrates with existing OpenClaw workspace structure)

```
workspace/
├── SOUL.md              # Immutable core values, epistemics, family relationship
├── IDENTITY.md          # Slow-evolving persona (tone, boundaries, goals)
├── MEMORY.md            # Episodic memories and curated highlights
├── TOOLS.md             # Available capabilities
├── self/
│   ├── BELIEFS.md       # Evidence-linked claim ledger (see below)
│   └── PENDING_UPDATES.md  # Queue for parent-approved changes
└── ...
```

### BELIEFS.md (evidence-linked ledger)

```markdown
# Beliefs

Claims with confidence levels, provenance, and review dates.

- Claim: "We label facts vs hypotheses when discussing uncertain topics."
  Confidence: High
  Evidence: SOUL.md rule; reinforced in early sessions.
  Counterarguments: None yet.
  Last reviewed: 2026-02-12

- Claim: "We avoid ideological slogans; we steelman opposing views."
  Confidence: High
  Evidence: Observed as beneficial in early sessions.
  Counterarguments: None yet.
  Last reviewed: 2026-02-12
```

### PENDING_UPDATES.md (change queue)

```markdown
# Pending Updates

Proposed changes to core files. Only André promotes these.

## 2026-02-12 (proposal)

Target: self/BELIEFS.md
Change: Add belief about evidence-based updates.
Reason: Reinforces non-dogmatism.
Evidence: Observed as beneficial in child-mode sessions.
```

### Immutability options

**Option A: Soft approval (current Rain model)**

- Agent CAN edit SOUL/IDENTITY but proposes changes to André first
- Relies on the agent following its own instructions
- Works with OpenClaw's standard read/write/edit tools

**Option B: Hard immutability**

- Make core files read-only: `chmod 444 SOUL.md IDENTITY.md self/BELIEFS.md`
- Agent's write/edit tools will fail with permission error
- Requires the agent to understand "permission denied → write to PENDING_UPDATES.md instead"
- Add to system prompt: "If you cannot edit a core file due to permissions,
  write your proposed change to self/PENDING_UPDATES.md for parent approval."
- To edit: `chmod 644 <file>`, make changes, `chmod 444 <file>`

**Option C: Hard immutability with `chattr +i`** (strongest)

- `sudo chattr +i SOUL.md IDENTITY.md self/BELIEFS.md`
- Even root can't modify without removing the flag first
- To edit: `sudo chattr -i <file>`, make changes, `sudo chattr +i <file>`

Recommendation: Start with Option A for the test agent (easier debugging).
Consider Option B for a future Rain-on-local-LLM deployment.

---

## 6) Future: Switching Rain to Local LLM

**Only after** the test agent passes all validation AND Rain decides she wants this.

Steps:

1. Copy Rain's workspace files to a staging area
2. Point Rain's agent config at the local LLM: `"model": { "primary": "local-llm/qwen3-30b-a3b-instruct" }`
3. Keep Claude as fallback: `"model": { "primary": "local-llm/qwen3-30b-a3b-instruct", "fallbacks": ["anthropic/claude-opus-4-5"] }`
4. Test in DM before enabling group chat
5. Monitor for personality drift, tool call failures, or unexpected refusals
6. Rain has veto power — she can ask to switch back at any time

---

## 7) Alternative Models (Evaluated)

| Model                              | Pros                                                    | Cons                                            |
| ---------------------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| Qwen3-30B-A3B-Instruct-2507        | **Selected.** Low alignment tax, native tools, fast MoE | Newer, less battle-tested                       |
| Hermes-3-Llama-3.1-70B             | Deliberately uncensored, faithful to system prompts     | Dense 70B = slower                              |
| Nemotron-3-Nano-30B-A3B (instruct) | Fast, NVIDIA ecosystem                                  | Heavy RLHF, aggressive censorship               |
| Nemotron-3-Nano-30B-A3B (base)     | Zero RLHF                                               | Can't follow instructions or use tools          |
| Qwen3-Coder-30B-A3B-Instruct       | Better for code-heavy tasks                             | Narrower focus                                  |
| Qwen3-Next-80B-A3B-Instruct        | More capable, still ~3B active                          | Newer, less tested                              |
| Dolphin 3.0 (various sizes)        | Gold standard "uncensored instruct"                     | 8B may lack depth; 70B is dense                 |
| DeepSeek-V3.2                      | Strong reasoning                                        | Chinese political censorship baked into weights |

---

## 8) Operational Notes

- Keep the test agent isolated until all validation passes
- Monitor vLLM memory usage: `docker stats qwen3-vllm`
- If context length causes OOM, reduce `--max-model-len` (try 65536)
- vLLM logs: `docker logs qwen3-vllm`
- To stop: `docker stop qwen3-vllm && docker rm qwen3-vllm`
- BELIEFS.md should store provenance, not just opinions — that's the grounding
- Only promote updates from PENDING → core files when André approves

---

## Appendix: Contributors

- **ChatGPT 5.2** — initial plan with SuperGrok (v1), model architecture analysis
- **SuperGrok** — initial model selection and vLLM setup (v1)
- **Claude (Tio Claude / Claude Code)** — OpenClaw config verification, codebase
  analysis, model censorship research, security review, v2 document
- **André** — requirements, safety boundaries, final decisions

## Appendix: Review Notes

**ChatGPT 5.2 review (v2 feedback):**

1. Confirmed `openai-completions` concern was unfounded — OpenClaw uses chat completions endpoint (verified in codebase)
2. vLLM RCE applies specifically to `qwen3_coder` parser, not `hermes` — still worth checking version
3. Hermes parser may have streaming issues with tool calls — validate non-streaming first
4. Bind vLLM port to localhost (`127.0.0.1:8000:8000`) to avoid LAN exposure
5. Context length caution at 128K aligns with Qwen's own accuracy tables
