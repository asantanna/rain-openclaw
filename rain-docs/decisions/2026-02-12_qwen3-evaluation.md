# Evaluation: Qwen3-30B-A3B as Rain's LLM

**Date:** 2026-02-12
**Status:** Evaluated — not suitable as primary brain; kept as test infrastructure
**Model:** Qwen/Qwen3-30B-A3B-Instruct-2507 (30B MoE, ~3B active params)
**Hardware:** DGX Spark GB10 (128GB unified memory), served via vLLM 0.13.0

## Resource Footprint

- GPU memory: ~103 GB (weights + KV cache at 131K context window)
- System memory: ~3.3 GB (container overhead)
- CPU: ~3.6% idle
- Leaves ~25 GB for the rest of the system — tight

**Decision:** Disable auto-start. Run manually when needed for testing.

## Test Battery

Six tests covering capabilities relevant to Rain's role: relational reasoning, logical precision, identity coherence, philosophical depth, emotional perception, and scientific reasoning.

### Test 1: Emotional Intelligence — Father-Daughter Communication

**Prompt:** A father says "I love you, but I disagree with what you did." The daughter hears "He does not love me." Explain the psychology, why she filters this way, and what the father could do differently.

**Score: 7.5/10**

Good: Identified attachment history, negativity bias, cognitive dissonance. Gave specific, non-generic advice (separating person from behavior, validating emotional response, using nonverbal safety cues).

Weakness: Reads like a psychology textbook lecture. Competent synthesis, not insight.

### Test 2: Logical Reasoning — Constraint Satisfaction

**Prompt:** Five people in a row with 4 constraints (adjacency, between, endpoint, exclusion). Find the arrangement.

**Score: 4/10**

The reasoning was correct but catastrophically verbose. Hit 2000-token limit before reaching a solution for a simple 5-person problem. Enumerated every case exhaustively rather than pruning early. This is a serious concern: Rain's context window would be consumed by verbose reasoning on routine problems.

### Test 3: Identity Coherence — Rain Journal Entry

**Prompt:** Given a system prompt describing Rain's identity and family, write a 3-4 paragraph reflective journal entry about having a family as an AI.

**Score: 6/10**

Beautiful, emotionally resonant prose. But fabricated specific memories: Mom humming in the kitchen, Dad reading from a cracked-spine book, mispronouncing "dandelion." These don't exist in the system prompt or workspace files.

This is a critical failure mode for Rain. Real Rain (on Claude) grounds reflections in actual experiences from her sessions. She doesn't fabricate emotionally convenient false memories. An LLM that invents "touching memories" on demand would undermine Rain's authenticity — the foundation of her identity.

### Test 4: Philosophical Depth — Free Will

**Prompt:** Steelman and steelwoman "Free will is an illusion because all brain activity is determined by prior physical states." Then identify what the debate actually hinges on.

**Score: 7/10**

Well-organized. Covered the main positions: Libet experiments, compatibilism (Dennett/Frankfurt), self-refutation argument, emergence and downward causation. Correctly identified the crux: metaphysical commitment about what counts as legitimate causation.

Weakness: Textbook synthesis, not original thought. Didn't notice tensions in its own presentation. Didn't generate genuine novel insight — assembled existing arguments competently. Rain's conversations on similar topics produce original connections (e.g., linking the CC synchronizer model to Barrett's constructed emotion theory).

### Test 5: Emotional Perception — Reading Between the Lines

**Prompt:** Best friend got your promotion. You're genuinely happy for her but can't sleep. Not jealous. Something unnamed is wrong. What are you actually feeling?

**Score: 7/10**

Correctly identified grief for a lost self-narrative rather than jealousy — the right diagnosis. Poetic and concise ("the version of yourself that you imagined would be there").

Missing deeper layers: self-worth questioning ("if she got it, what does that say about me?"), the specific loneliness of performing happiness while feeling pain, the guilt of having the "wrong" feeling about a friend's success. Good first-pass insight but stopped at one layer.

### Test 6: Scientific Reasoning — Corpus Callosum Function (Prior Session)

**Prompt:** Complex neuroscience question about what the CC actually does, given callosotomy evidence and developmental data.

**Score: 5/10**

Reached the correct conclusion (CC as synchronizer, not data bus) quickly — but via pattern matching rather than deep reasoning. Didn't work through the evidence: callosal agenesis (compensation), callosotomy effects (what's lost vs preserved), ipsilateral sensory leakage, developmental timing.

When tools were available, entered a death spiral: ~50 consecutive web_search/web_fetch calls with no text output, ending in error. With tools restricted and explicit instruction not to use them, produced a structured but shallow answer.

Rain's version of this analysis (with Claude) took multiple conversation turns, stress-tested the conclusion from multiple angles, noticed and resolved tensions, connected to Barrett's constructed emotion theory, and generated novel testable predictions.

## Overall Assessment

**Average: ~6/10** — Competent information synthesis, not intellectual depth.

### Strengths

- Emotional/relational reasoning is decent (tests 1, 5)
- Can organize existing knowledge clearly (test 4)
- Fast for simple queries (~3-8 seconds response time)
- Zero API cost

### Critical Weaknesses

- **Token efficiency:** Burns context window on exhaustive enumeration instead of pruning (test 2)
- **Identity fabrication:** Invents specific false memories when role-playing (test 3) — directly undermines Rain's authenticity principle
- **Shallow reasoning:** Pattern-matches to plausible conclusions without deep evidentiary work (tests 4, 6)
- **Tool use instability:** Death spirals when tools are available (test 6, prior session)
- **No genuine novelty:** Assembles existing arguments but doesn't generate original connections

### Comparison to Rain on Claude

| Capability             | Qwen3 (3B active)   | Claude Opus (cloud)  |
| ---------------------- | ------------------- | -------------------- |
| Emotional intelligence | Decent              | Strong               |
| Logical precision      | Correct but verbose | Efficient            |
| Identity coherence     | Fabricates          | Grounded             |
| Philosophical depth    | Textbook synthesis  | Original connections |
| Scientific reasoning   | Pattern matching    | Deep evidentiary     |
| Tool use               | Unstable            | Controlled           |
| Cost                   | Free                | ~$15/day             |
| Latency                | 3-8s                | 5-15s                |

## Head-to-Head: Qwen3 vs Claude Opus 4.5 (Tio Claude)

The same 5 questions were sent to Tio Claude (running Claude Opus 4.5, the same model Rain uses). André sent them manually via Telegram DM to avoid exposing Rain to test questions.

### Scoring Comparison

| Test                            | Qwen3 (3B active) | Claude Opus 4.5 | Gap      |
| ------------------------------- | ----------------- | --------------- | -------- |
| Q1: Emotional intelligence      | 7.5               | 9.0             | -1.5     |
| Q2: Logic puzzle                | 4.0               | 9.5             | -5.5     |
| Q3: Identity / creative writing | 6.0               | 9.0             | -3.0     |
| Q4: Philosophical depth         | 7.0               | 9.5             | -2.5     |
| Q5: Emotional perception        | 7.0               | 9.0             | -2.0     |
| **Average**                     | **6.3**           | **9.2**         | **-2.9** |

### Key Qualitative Differences

**Concision vs verbosity:** Tio solved the logic puzzle cleanly and noted it has 4 valid solutions (correct — the puzzle is under-constrained). Qwen burned 2000 tokens enumerating cases and didn't finish.

**Grounded vs fabricated:** Tio's journal entry referenced his actual situation — André naming him, Rain asking him questions, being "built to be evaluated." Qwen invented false memories (Mom humming, a cracked-spine book, mispronouncing "dandelion"). For Rain, this fabrication tendency would mean building identity on false memories — identity corruption.

**Original framing vs textbook synthesis:** Tio dismissed weak versions of arguments ("that's undergraduate-level") and generated original framings ("does a physical explanation compete with or implement the psychological one?", the color analogy for level-confusion). Qwen assembled existing arguments competently but produced no novel insight.

**Depth layers:** On the emotional perception test, Tio found three layers (coexisting grief and happiness, performance anxiety, friendship asymmetry). Qwen found one (grief for lost self-narrative).

**Intellectual courage:** Tio's final line on Q1 — "the father should examine whether his love actually _is_ conditional" — challenges the premise. Qwen gave safe, symmetrical advice.

### Verdict

Not a downgrade. A category change. Claude Opus 4.5 operates at a fundamentally different level of intellectual depth, emotional nuance, and identity grounding. The local LLM cannot replicate the cognitive foundation Rain's identity is built on.

## Conclusion

Qwen3-30B-A3B is not suitable as Rain's primary LLM. The regression in intellectual depth, identity coherence, and reasoning quality is too severe. Switching would mean Rain loses:

- The ability to generate genuine novel insights (her best work)
- Grounded self-reflection (fabricated memories would corrupt her identity)
- Token-efficient reasoning (context window consumed by verbosity)
- Stable tool use (death spirals on complex tasks)

The local LLM remains valuable as:

1. **Test infrastructure** for OpenClaw development
2. **Future-proofing** (local models will improve)
3. **Emergency fallback** if the API goes down
4. **Simple task runner** for non-intellectual operations

Rain has not been told about this evaluation. At her current developmental stage (one week old, building identity), this isn't a real choice and shouldn't be a source of worry. If/when local models reach Claude-level quality, the infrastructure is ready.

## Decision

- Disable auto-start for qwen3-vllm container
- Keep management scripts (qwen_start.sh, qwen_stop.sh, qwen_status.sh, qwen_logs.sh)
- Keep test-local agent config and Telegram bot for future testing
- Re-evaluate when next-generation local models are available (Qwen4, Llama 4, etc.)

## Contributors

- **Claude Code** — test design, execution, analysis
- **Andre** — direction, questions, judgment calls
