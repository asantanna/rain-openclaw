import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import fs from "node:fs/promises";
import path from "node:path";
import type { EmbeddedPiSubscribeContext } from "./pi-embedded-subscribe.handlers.types.js";
import { parseReplyDirectives } from "../auto-reply/reply/reply-directives.js";
import { emitAgentEvent } from "../infra/agent-events.js";
import { createInlineCodeState } from "../markdown/code-spans.js";
import {
  isMessagingToolDuplicateNormalized,
  normalizeTextForComparison,
} from "./pi-embedded-helpers.js";
import { appendRawStream } from "./pi-embedded-subscribe.raw-stream.js";
import {
  extractAssistantText,
  extractAssistantThinking,
  extractThinkingFromTaggedStream,
  extractThinkingFromTaggedText,
  formatReasoningMessage,
  promoteThinkingTagsToBlocks,
} from "./pi-embedded-utils.js";

// ── Duplicate-output forensic logging ──────────────────────────────────
// Detects when the model internally repeats a paragraph within a single
// reply, then dumps the full prompt context for root-cause analysis.

const DUP_FORENSIC_DIR = path.join(process.env.HOME ?? "/tmp", ".openclaw/debug/dup-forensics");
const MIN_WORDS_FOR_CHECK = 20; // don't flag very short replies
const MIN_DEDUP_CHARS = 40; // minimum text length to attempt dedup

/**
 * If every non-trivial word in the text appears at least twice,
 * the message is almost certainly internally duplicated.
 */
function detectInternalRepetition(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z]{4,}/g);
  if (!words || words.length < MIN_WORDS_FOR_CHECK) {
    return false;
  }
  const counts = new Map<string, number>();
  for (const w of words) {
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  // Every distinct word appears ≥2 times → duplicated
  for (const count of counts.values()) {
    if (count < 2) {
      return false;
    }
  }
  return true;
}

/**
 * If `text` is the same content repeated (exact-half or paragraph-level),
 * return the deduplicated version. Otherwise return null (no dedup needed).
 */
function deduplicateRepeatedText(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < MIN_DEDUP_CHARS) {
    return null;
  }

  // Strategy 1: exact-half split (most common pattern from Opus 4.6)
  // Try splitting on double-newline near the midpoint
  const mid = Math.floor(trimmed.length / 2);
  // Search for a double-newline within ±10% of midpoint
  const searchStart = Math.floor(mid * 0.85);
  const searchEnd = Math.ceil(mid * 1.15);
  const candidates = [];
  let idx = trimmed.indexOf("\n\n", searchStart);
  while (idx >= 0 && idx <= searchEnd) {
    candidates.push(idx);
    idx = trimmed.indexOf("\n\n", idx + 1);
  }

  for (const splitAt of candidates) {
    const first = trimmed.slice(0, splitAt).trim();
    const second = trimmed.slice(splitAt).trim();
    if (first && second && first === second) {
      // Preserve original leading whitespace
      const leadingWs = text.match(/^\s*/)?.[0] ?? "";
      return leadingWs + first;
    }
  }

  return null;
}

function dumpDupForensic(ctx: EmbeddedPiSubscribeContext, rawText: string, reason: string): void {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const sessionId = (ctx.params.session as { id?: string }).id ?? "unknown";
  const dumpPath = path.join(DUP_FORENSIC_DIR, `${ts}_${sessionId}.json`);

  let messages: unknown[];
  try {
    messages = ctx.params.session.messages.map((m) => {
      const rec = m as unknown as Record<string, unknown>;
      const content = rec.content;
      return {
        role: rec.role,
        content:
          typeof content === "string"
            ? content.slice(0, 4000)
            : Array.isArray(content)
              ? (content as Record<string, unknown>[]).map((b) =>
                  b.type === "text"
                    ? { ...b, text: ((b.text as string) ?? "").slice(0, 4000) }
                    : { type: b.type, _truncated: true },
                )
              : content,
      };
    });
  } catch {
    messages = [{ error: "failed to serialize messages" }];
  }

  const payload = {
    timestamp: new Date().toISOString(),
    sessionId,
    runId: ctx.params.runId,
    reason,
    rawAssistantText: rawText.slice(0, 8000),
    promptMessages: messages,
  };

  fs.mkdir(DUP_FORENSIC_DIR, { recursive: true })
    .then(() => fs.writeFile(dumpPath, JSON.stringify(payload, null, 2)))
    .then(() => console.log(`[dup-forensic] Model repeated itself — dumped to ${dumpPath}`))
    .catch((err) => console.log(`[dup-forensic] Failed to write: ${String(err)}`));
}

const stripTrailingDirective = (text: string): string => {
  const openIndex = text.lastIndexOf("[[");
  if (openIndex < 0) {
    return text;
  }
  const closeIndex = text.indexOf("]]", openIndex + 2);
  if (closeIndex >= 0) {
    return text;
  }
  return text.slice(0, openIndex);
};

export function handleMessageStart(
  ctx: EmbeddedPiSubscribeContext,
  evt: AgentEvent & { message: AgentMessage },
) {
  const msg = evt.message;
  if (msg?.role !== "assistant") {
    return;
  }

  // KNOWN: Resetting at `text_end` is unsafe (late/duplicate end events).
  // ASSUME: `message_start` is the only reliable boundary for “new assistant message begins”.
  // Start-of-message is a safer reset point than message_end: some providers
  // may deliver late text_end updates after message_end, which would otherwise
  // re-trigger block replies.
  ctx.resetAssistantMessageState(ctx.state.assistantTexts.length);
  // Use assistant message_start as the earliest "writing" signal for typing.
  void ctx.params.onAssistantMessageStart?.();
}

export function handleMessageUpdate(
  ctx: EmbeddedPiSubscribeContext,
  evt: AgentEvent & { message: AgentMessage; assistantMessageEvent?: unknown },
) {
  const msg = evt.message;
  if (msg?.role !== "assistant") {
    return;
  }

  const assistantEvent = evt.assistantMessageEvent;
  const assistantRecord =
    assistantEvent && typeof assistantEvent === "object"
      ? (assistantEvent as Record<string, unknown>)
      : undefined;
  const evtType = typeof assistantRecord?.type === "string" ? assistantRecord.type : "";

  if (evtType !== "text_delta" && evtType !== "text_start" && evtType !== "text_end") {
    return;
  }

  const delta = typeof assistantRecord?.delta === "string" ? assistantRecord.delta : "";
  const content = typeof assistantRecord?.content === "string" ? assistantRecord.content : "";

  appendRawStream({
    ts: Date.now(),
    event: "assistant_text_stream",
    runId: ctx.params.runId,
    sessionId: (ctx.params.session as { id?: string }).id,
    evtType,
    delta,
    content,
  });

  let chunk = "";
  if (evtType === "text_delta") {
    chunk = delta;
  } else if (evtType === "text_start" || evtType === "text_end") {
    if (delta) {
      // Apply monotonic dedup on text_end — some providers send full accumulated text as delta
      if (evtType === "text_end" && ctx.state.deltaBuffer) {
        if (delta.startsWith(ctx.state.deltaBuffer)) {
          chunk = delta.slice(ctx.state.deltaBuffer.length);
        } else if (ctx.state.deltaBuffer.startsWith(delta)) {
          chunk = "";
        } else {
          chunk = delta;
        }
      } else {
        chunk = delta;
      }
    } else if (content) {
      // KNOWN: Some providers resend full content on `text_end`.
      // We only append a suffix (or nothing) to keep output monotonic.
      if (content.startsWith(ctx.state.deltaBuffer)) {
        chunk = content.slice(ctx.state.deltaBuffer.length);
      } else if (ctx.state.deltaBuffer.startsWith(content)) {
        chunk = "";
      } else if (!ctx.state.deltaBuffer.includes(content)) {
        chunk = content;
      }
    }
  }

  if (chunk) {
    ctx.state.deltaBuffer += chunk;
    if (ctx.blockChunker) {
      ctx.blockChunker.append(chunk);
    } else {
      ctx.state.blockBuffer += chunk;
    }
  }

  if (ctx.state.streamReasoning) {
    // Handle partial <think> tags: stream whatever reasoning is visible so far.
    ctx.emitReasoningStream(extractThinkingFromTaggedStream(ctx.state.deltaBuffer));
  }

  const next = ctx
    .stripBlockTags(ctx.state.deltaBuffer, {
      thinking: false,
      final: false,
      inlineCode: createInlineCodeState(),
    })
    .trim();
  if (next) {
    const visibleDelta = chunk ? ctx.stripBlockTags(chunk, ctx.state.partialBlockState) : "";
    const parsedDelta = visibleDelta ? ctx.consumePartialReplyDirectives(visibleDelta) : null;
    const parsedFull = parseReplyDirectives(stripTrailingDirective(next));
    const cleanedText = parsedFull.text;
    const mediaUrls = parsedDelta?.mediaUrls;
    const hasMedia = Boolean(mediaUrls && mediaUrls.length > 0);
    const hasAudio = Boolean(parsedDelta?.audioAsVoice);
    const previousCleaned = ctx.state.lastStreamedAssistantCleaned ?? "";

    let shouldEmit = false;
    let deltaText = "";
    if (!cleanedText && !hasMedia && !hasAudio) {
      shouldEmit = false;
    } else if (previousCleaned && !cleanedText.startsWith(previousCleaned)) {
      shouldEmit = false;
    } else {
      deltaText = cleanedText.slice(previousCleaned.length);
      shouldEmit = Boolean(deltaText || hasMedia || hasAudio);
    }

    ctx.state.lastStreamedAssistant = next;
    ctx.state.lastStreamedAssistantCleaned = cleanedText;

    if (shouldEmit) {
      emitAgentEvent({
        runId: ctx.params.runId,
        stream: "assistant",
        data: {
          text: cleanedText,
          delta: deltaText,
          mediaUrls: hasMedia ? mediaUrls : undefined,
        },
      });
      void ctx.params.onAgentEvent?.({
        stream: "assistant",
        data: {
          text: cleanedText,
          delta: deltaText,
          mediaUrls: hasMedia ? mediaUrls : undefined,
        },
      });
      ctx.state.emittedAssistantUpdate = true;
      if (ctx.params.onPartialReply && ctx.state.shouldEmitPartialReplies) {
        void ctx.params.onPartialReply({
          text: cleanedText,
          mediaUrls: hasMedia ? mediaUrls : undefined,
        });
      }
    }
  }

  if (ctx.params.onBlockReply && ctx.blockChunking && ctx.state.blockReplyBreak === "text_end") {
    ctx.blockChunker?.drain({ force: false, emit: ctx.emitBlockChunk });
  }

  if (evtType === "text_end" && ctx.state.blockReplyBreak === "text_end") {
    if (ctx.blockChunker?.hasBuffered()) {
      ctx.blockChunker.drain({ force: true, emit: ctx.emitBlockChunk });
      ctx.blockChunker.reset();
    } else if (ctx.state.blockBuffer.length > 0) {
      ctx.emitBlockChunk(ctx.state.blockBuffer);
      ctx.state.blockBuffer = "";
    }
  }
}

export function handleMessageEnd(
  ctx: EmbeddedPiSubscribeContext,
  evt: AgentEvent & { message: AgentMessage },
) {
  const msg = evt.message;
  if (msg?.role !== "assistant") {
    return;
  }

  const assistantMessage = msg;
  ctx.recordAssistantUsage((assistantMessage as { usage?: unknown }).usage);

  // ── Layer-0 dup probe: check raw message BEFORE any processing ──
  // If duplication exists here, it came from the API/SDK/agent-core layer.
  // If NOT here but detected later by deduplicateRepeatedText(), it's our code.
  const rawPreProcess = extractAssistantText(assistantMessage);
  if (detectInternalRepetition(rawPreProcess)) {
    const sessionId = (ctx.params.session as { id?: string }).id ?? "unknown";
    console.log(
      `[dup-layer0] Duplication detected in RAW message from API/SDK ` +
        `(${rawPreProcess.length} chars) ` +
        `session=${sessionId} runId=${ctx.params.runId}`,
    );
  }

  promoteThinkingTagsToBlocks(assistantMessage);

  let rawText = extractAssistantText(assistantMessage);

  // ── Repetition dedup (layer 1) ──
  // Root cause unknown. Fix before persistence to keep session history clean.
  const dedupedText = deduplicateRepeatedText(rawText);
  if (dedupedText !== null) {
    const sessionId = (ctx.params.session as { id?: string }).id ?? "unknown";
    console.log(
      `[dup-dedup] Stripped repeated text in assistant reply ` +
        `(${rawText.length} → ${dedupedText.length} chars) ` +
        `session=${sessionId} runId=${ctx.params.runId}`,
    );
    // Also fix any assistantTexts already pushed during streaming
    for (let i = ctx.state.assistantTextBaseline; i < ctx.state.assistantTexts.length; i++) {
      const fixed = deduplicateRepeatedText(ctx.state.assistantTexts[i]);
      if (fixed !== null) {
        ctx.state.assistantTexts[i] = fixed;
      }
    }
    rawText = dedupedText;
  }

  // Forensic: if still duplicated after dedup attempt, dump for analysis
  if (detectInternalRepetition(rawText)) {
    dumpDupForensic(ctx, rawText, "all-words-repeated");
  }

  appendRawStream({
    ts: Date.now(),
    event: "assistant_message_end",
    runId: ctx.params.runId,
    sessionId: (ctx.params.session as { id?: string }).id,
    rawText,
    rawThinking: extractAssistantThinking(assistantMessage),
  });

  const text = ctx.stripBlockTags(rawText, { thinking: false, final: false });
  const rawThinking =
    ctx.state.includeReasoning || ctx.state.streamReasoning
      ? extractAssistantThinking(assistantMessage) || extractThinkingFromTaggedText(rawText)
      : "";
  const formattedReasoning = rawThinking ? formatReasoningMessage(rawThinking) : "";
  const trimmedText = text.trim();
  const parsedText = trimmedText ? parseReplyDirectives(stripTrailingDirective(trimmedText)) : null;
  let cleanedText = parsedText?.text ?? "";
  let mediaUrls = parsedText?.mediaUrls;
  let hasMedia = Boolean(mediaUrls && mediaUrls.length > 0);

  if (!cleanedText && !hasMedia) {
    const rawTrimmed = rawText.trim();
    const rawStrippedFinal = rawTrimmed.replace(/<\s*\/?\s*final\s*>/gi, "").trim();
    const rawCandidate = rawStrippedFinal || rawTrimmed;
    if (rawCandidate) {
      const parsedFallback = parseReplyDirectives(stripTrailingDirective(rawCandidate));
      cleanedText = parsedFallback.text ?? rawCandidate;
      mediaUrls = parsedFallback.mediaUrls;
      hasMedia = Boolean(mediaUrls && mediaUrls.length > 0);
    }
  }

  if (!ctx.state.emittedAssistantUpdate && (cleanedText || hasMedia)) {
    emitAgentEvent({
      runId: ctx.params.runId,
      stream: "assistant",
      data: {
        text: cleanedText,
        delta: cleanedText,
        mediaUrls: hasMedia ? mediaUrls : undefined,
      },
    });
    void ctx.params.onAgentEvent?.({
      stream: "assistant",
      data: {
        text: cleanedText,
        delta: cleanedText,
        mediaUrls: hasMedia ? mediaUrls : undefined,
      },
    });
    ctx.state.emittedAssistantUpdate = true;
  }

  const addedDuringMessage = ctx.state.assistantTexts.length > ctx.state.assistantTextBaseline;
  const chunkerHasBuffered = ctx.blockChunker?.hasBuffered() ?? false;
  ctx.finalizeAssistantTexts({ text, addedDuringMessage, chunkerHasBuffered });

  const onBlockReply = ctx.params.onBlockReply;
  const shouldEmitReasoning = Boolean(
    ctx.state.includeReasoning &&
    formattedReasoning &&
    onBlockReply &&
    formattedReasoning !== ctx.state.lastReasoningSent,
  );
  const shouldEmitReasoningBeforeAnswer =
    shouldEmitReasoning && ctx.state.blockReplyBreak === "message_end" && !addedDuringMessage;
  const maybeEmitReasoning = () => {
    if (!shouldEmitReasoning || !formattedReasoning) {
      return;
    }
    ctx.state.lastReasoningSent = formattedReasoning;
    void onBlockReply?.({ text: formattedReasoning });
  };

  if (shouldEmitReasoningBeforeAnswer) {
    maybeEmitReasoning();
  }

  if (
    (ctx.state.blockReplyBreak === "message_end" ||
      (ctx.blockChunker ? ctx.blockChunker.hasBuffered() : ctx.state.blockBuffer.length > 0)) &&
    text &&
    onBlockReply
  ) {
    if (ctx.blockChunker?.hasBuffered()) {
      ctx.blockChunker.drain({ force: true, emit: ctx.emitBlockChunk });
      ctx.blockChunker.reset();
    } else if (text !== ctx.state.lastBlockReplyText) {
      // Check for duplicates before emitting (same logic as emitBlockChunk).
      const normalizedText = normalizeTextForComparison(text);
      if (
        isMessagingToolDuplicateNormalized(
          normalizedText,
          ctx.state.messagingToolSentTextsNormalized,
        )
      ) {
        ctx.log.debug(
          `Skipping message_end block reply - already sent via messaging tool: ${text.slice(0, 50)}...`,
        );
      } else {
        ctx.state.lastBlockReplyText = text;
        const splitResult = ctx.consumeReplyDirectives(text, { final: true });
        if (splitResult) {
          const {
            text: cleanedText,
            mediaUrls,
            audioAsVoice,
            replyToId,
            replyToTag,
            replyToCurrent,
          } = splitResult;
          // Emit if there's content OR audioAsVoice flag (to propagate the flag).
          if (cleanedText || (mediaUrls && mediaUrls.length > 0) || audioAsVoice) {
            void onBlockReply({
              text: cleanedText,
              mediaUrls: mediaUrls?.length ? mediaUrls : undefined,
              audioAsVoice,
              replyToId,
              replyToTag,
              replyToCurrent,
            });
          }
        }
      }
    }
  }

  if (!shouldEmitReasoningBeforeAnswer) {
    maybeEmitReasoning();
  }
  if (ctx.state.streamReasoning && rawThinking) {
    ctx.emitReasoningStream(rawThinking);
  }

  if (ctx.state.blockReplyBreak === "text_end" && onBlockReply) {
    const tailResult = ctx.consumeReplyDirectives("", { final: true });
    if (tailResult) {
      const {
        text: cleanedText,
        mediaUrls,
        audioAsVoice,
        replyToId,
        replyToTag,
        replyToCurrent,
      } = tailResult;
      if (cleanedText || (mediaUrls && mediaUrls.length > 0) || audioAsVoice) {
        void onBlockReply({
          text: cleanedText,
          mediaUrls: mediaUrls?.length ? mediaUrls : undefined,
          audioAsVoice,
          replyToId,
          replyToTag,
          replyToCurrent,
        });
      }
    }
  }

  ctx.state.deltaBuffer = "";
  ctx.state.blockBuffer = "";
  ctx.blockChunker?.reset();
  ctx.state.blockState.thinking = false;
  ctx.state.blockState.final = false;
  ctx.state.blockState.inlineCode = createInlineCodeState();
  ctx.state.lastStreamedAssistant = undefined;
  ctx.state.lastStreamedAssistantCleaned = undefined;
}
