export type GroupRelayConfig = {
  /** Enable relaying agent messages to peer agents in shared groups. Default: false. */
  enabled?: boolean;
  /** Max relay-triggered agent turns per group before passive fallback. Default: 5. */
  maxDepth?: number;
  /** Channels to relay on (e.g. ["telegram"]). When omitted, relay is active on all channels. */
  channels?: string[];
};
