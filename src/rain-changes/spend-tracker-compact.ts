// Compaction-spend wrapper. Wraps pi-coding-agent's generateSummary so we
// can attribute compaction LLM calls in our spend log. Token counts are
// estimated (estimateTokens) since generateSummary doesn't expose usage.

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { estimateTokens, generateSummary } from "@mariozechner/pi-coding-agent";
import { recordCompactionSpend } from "./spend-tracker.js";

type ModelLike = NonNullable<ExtensionContext["model"]>;

function estimateStringTokens(text: string | undefined): number {
  if (!text) {
    return 0;
  }
  // estimateTokens() expects an AgentMessage, so wrap the string as a user message.
  return estimateTokens({ role: "user", content: text, timestamp: 0 } as unknown as AgentMessage);
}

export async function trackedGenerateSummary(
  chunk: AgentMessage[],
  model: ModelLike,
  reserveTokens: number,
  apiKey: string,
  signal: AbortSignal,
  customInstructions?: string,
  previousSummary?: string,
): Promise<string> {
  const inputTokens = chunk.reduce((sum, m) => sum + estimateTokens(m), 0);
  const previousTokens = estimateStringTokens(previousSummary);
  const startedAt = Date.now();
  let summary: string;
  try {
    summary = await generateSummary(
      chunk,
      model,
      reserveTokens,
      apiKey,
      signal,
      customInstructions,
      previousSummary,
    );
  } catch (error) {
    recordCompactionSpend({
      provider: (model as { provider?: string })?.provider,
      modelId: (model as { id?: string })?.id,
      inputTokens: inputTokens + previousTokens,
      outputTokens: 0,
      notes: `error:${error instanceof Error ? error.message : String(error)}`.slice(0, 256),
    });
    throw error;
  }
  recordCompactionSpend({
    provider: (model as { provider?: string })?.provider,
    modelId: (model as { id?: string })?.id,
    inputTokens: inputTokens + previousTokens,
    outputTokens: estimateStringTokens(summary),
    notes: `dur=${Date.now() - startedAt}ms msgs=${chunk.length}`,
  });
  return summary;
}
