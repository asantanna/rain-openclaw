/**
 * Gateway Group Relay — relays agent messages to peer agents in shared groups.
 *
 * When Agent A responds in a group, this module delivers the message to all
 * peer agents that have bindings to the same channel, triggering them to
 * process and respond. Uses cross-provider routing so peer responses are
 * delivered via their own channel accounts (e.g., each Telegram bot posts
 * under its own identity).
 *
 * Loop prevention: tracks relay depth per group key. Human-originated messages
 * reset the counter. When depth >= maxDepth, falls back to passive transcript
 * injection (no agent run triggered).
 */

import type { MsgContext } from "../auto-reply/templating.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveAgentConfig } from "../agents/agent-scope.js";
import { dispatchInboundMessageWithDispatcher } from "../auto-reply/dispatch.js";
import { isSilentReplyText, SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import { loadConfig } from "../config/config.js";
import { appendRelayMessageToSessionTranscript } from "../config/sessions/transcript.js";
import { logVerbose } from "../globals.js";
import { saveMediaSource } from "../media/store.js";
import { listBindings } from "../routing/bindings.js";
import { normalizeAgentId, buildAgentPeerSessionKey } from "../routing/session-key.js";
import { parseAgentSessionKey } from "../sessions/session-key-utils.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../utils/message-channel.js";

// ---------------------------------------------------------------------------
// Loop prevention state
// ---------------------------------------------------------------------------

/** Run IDs triggered by relay (to distinguish from human-originated runs). */
const relayRunIds = new Set<string>();

/** Relay depth per group key (e.g. "telegram:group:-5255152440"). */
const groupDepth = new Map<string, number>();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type ParsedGroupSession = {
  agentId: string;
  channel: string;
  peerKind: "group" | "channel";
  peerId: string;
};

/**
 * Parse a group session key into its components.
 * Expected format: `agent:{agentId}:{channel}:{peerKind}:{peerId}`
 */
function parseGroupSessionKey(sessionKey: string): ParsedGroupSession | null {
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed) {
    return null;
  }
  // rest = "{channel}:{peerKind}:{peerId}" (e.g. "telegram:group:-5255152440")
  const parts = parsed.rest.split(":");
  if (parts.length < 3) {
    return null;
  }
  const channel = parts[0];
  const peerKind = parts[1];
  if (peerKind !== "group" && peerKind !== "channel") {
    return null;
  }
  const peerId = parts.slice(2).join(":");
  return {
    agentId: normalizeAgentId(parsed.agentId),
    channel,
    peerKind,
    peerId,
  };
}

type PeerAgent = {
  agentId: string;
  accountId: string;
};

/**
 * Find peer agents that have bindings to the same channel.
 * Returns agents other than the source agent with accountId from binding.
 */
function findPeerAgentBindings(
  cfg: OpenClawConfig,
  channel: string,
  sourceAgentId: string,
): PeerAgent[] {
  const normalizedSource = normalizeAgentId(sourceAgentId);
  const normalizedChannel = channel.toLowerCase();
  const peers: PeerAgent[] = [];
  const seen = new Set<string>();

  for (const binding of listBindings(cfg)) {
    if (!binding?.match) {
      continue;
    }
    const bindingChannel = (binding.match.channel ?? "").trim().toLowerCase();
    if (bindingChannel !== normalizedChannel) {
      continue;
    }
    const agentId = normalizeAgentId(binding.agentId);
    if (agentId === normalizedSource) {
      continue;
    }
    if (seen.has(agentId)) {
      continue;
    }
    const accountId = (binding.match.accountId ?? "").trim();
    if (!accountId) {
      continue;
    }
    seen.add(agentId);
    peers.push({ agentId, accountId });
  }

  return peers;
}

/** Build the group key used for depth tracking. */
function buildGroupKey(channel: string, peerKind: string, peerId: string): string {
  return `${channel}:${peerKind}:${peerId}`.toLowerCase();
}

/** Resolve the display name for an agent (falls back to agent ID). */
function resolveAgentDisplayName(cfg: OpenClawConfig, agentId: string): string {
  const config = resolveAgentConfig(cfg, agentId);
  return config?.name ?? agentId;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Relay an agent's group message to all peer agents in the same group.
 *
 * Called from emitChatFinal in server-chat.ts after an agent completes a run.
 * Fire-and-forget — errors are caught and logged, never propagated.
 */
export async function maybeRelayToGroupPeers(params: {
  sessionKey: string;
  text: string;
  mediaUrls?: string[];
  runId: string;
}): Promise<void> {
  const cfg = loadConfig();
  if (cfg.groupRelay?.enabled !== true) {
    return;
  }

  const maxDepth = cfg.groupRelay?.maxDepth ?? 5;
  const allowedChannels = cfg.groupRelay?.channels;

  const { sessionKey, text, runId } = params;
  const trimmed = text.trim();
  const hasMedia = Boolean(params.mediaUrls && params.mediaUrls.length > 0);
  if (!trimmed && !hasMedia) {
    return;
  }
  if (trimmed && (isSilentReplyText(trimmed) || SILENT_REPLY_TOKEN.startsWith(trimmed))) {
    return;
  }

  // Parse the source session key to extract channel/group info.
  const parsed = parseGroupSessionKey(sessionKey);
  if (!parsed) {
    return; // Not a group session key — nothing to relay.
  }

  const { agentId: sourceAgentId, channel, peerKind, peerId } = parsed;

  // Check channel filter: if channels are specified, only relay for those.
  if (allowedChannels && allowedChannels.length > 0) {
    const normalizedAllowed = allowedChannels.map((c) => c.trim().toLowerCase());
    if (!normalizedAllowed.includes(channel.toLowerCase())) {
      return;
    }
  }
  const groupKey = buildGroupKey(channel, peerKind, peerId);

  // Depth tracking: if this run was relay-triggered, increment depth.
  // If human-originated, reset depth counter.
  const isRelayRun = relayRunIds.has(runId);
  relayRunIds.delete(runId); // Clean up after checking.

  if (isRelayRun) {
    const current = groupDepth.get(groupKey) ?? 0;
    groupDepth.set(groupKey, current + 1);
  } else {
    // Human message: reset the depth counter.
    groupDepth.set(groupKey, 0);
  }

  const currentDepth = groupDepth.get(groupKey) ?? 0;

  // Find peer agents with bindings to the same channel.
  const peers = findPeerAgentBindings(cfg, channel, sourceAgentId);
  if (peers.length === 0) {
    return;
  }

  const senderName = resolveAgentDisplayName(cfg, sourceAgentId);
  const attributedText = `[${senderName}]: ${text}`;

  // Download media URLs to local files so the vision pipeline can process them.
  // buildInboundMediaNote() requires MediaPath to generate [media attached: ...] text,
  // and detectImageReferences() uses that to create vision blocks for the model.
  let mediaPaths: string[] | undefined;
  let mediaTypes: string[] | undefined;
  if (hasMedia && params.mediaUrls) {
    const results = await Promise.allSettled(
      params.mediaUrls.map((url) => saveMediaSource(url, undefined, "relay")),
    );
    const paths: string[] = [];
    const types: string[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        paths.push(result.value.path);
        types.push(result.value.contentType ?? "");
      } else {
        logVerbose(`relay: failed to download media: ${String(result.reason)}`);
      }
    }
    if (paths.length > 0) {
      mediaPaths = paths;
      mediaTypes = types;
    }
  }

  for (const peer of peers) {
    const peerSessionKey = buildAgentPeerSessionKey({
      agentId: peer.agentId,
      channel,
      peerKind,
      peerId,
    });

    if (currentDepth >= maxDepth) {
      // Passive fallback: inject into transcript without triggering a run.
      await appendRelayMessageToSessionTranscript({
        agentId: peer.agentId,
        sessionKey: peerSessionKey,
        text: attributedText,
      }).catch(() => {});
      continue;
    }

    // Active relay: trigger a full agent run for the peer.
    const relayRunId = `relay-${crypto.randomUUID()}`;
    relayRunIds.add(relayRunId);

    const ctx: MsgContext = {
      Body: attributedText,
      BodyForAgent: attributedText,
      RawBody: attributedText,
      SessionKey: peerSessionKey,
      Provider: INTERNAL_MESSAGE_CHANNEL,
      Surface: INTERNAL_MESSAGE_CHANNEL,
      OriginatingChannel: channel,
      OriginatingTo: peerId,
      AccountId: peer.accountId,
      ChatType: peerKind,
      CommandAuthorized: false,
      MessageSid: relayRunId,
      SenderName: senderName,
      MediaUrl: params.mediaUrls?.[0],
      MediaUrls: params.mediaUrls,
      MediaPath: mediaPaths?.[0],
      MediaPaths: mediaPaths,
      MediaType: mediaTypes?.[0],
      MediaTypes: mediaTypes,
    };

    dispatchInboundMessageWithDispatcher({
      ctx,
      cfg,
      dispatcherOptions: {
        // No-op deliver: cross-provider routing handles actual delivery.
        deliver: async () => {},
      },
    }).catch(() => {});
  }
}
