// The twin (Cairn-on-Pi) emits NO_REPLY when he decides there is nothing to
// say. handleToGroup is the one group leg that posts to Telegram directly
// (bypassing the outbound delivery normalizer and the peer-relay guard), so it
// carries its own silent-reply guard. These tests pin that: a NO_REPLY toGroup
// frame must post nothing; a real message must still post + relay.

import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMessageTelegram = vi.fn(async () => {});
const maybeRelayToGroupPeers = vi.fn(async () => {});

vi.mock("../../telegram/send.js", () => ({
  sendMessageTelegram: (...args: unknown[]) => sendMessageTelegram(...args),
}));
vi.mock("../../gateway/server-group-relay.js", () => ({
  maybeRelayToGroupPeers: (...args: unknown[]) => maybeRelayToGroupPeers(...args),
}));

const { handleToGroup } = await import("./bridge.js");

describe("handleToGroup NO_REPLY suppression", () => {
  beforeEach(() => {
    sendMessageTelegram.mockClear();
    maybeRelayToGroupPeers.mockClear();
  });

  it("suppresses a bare NO_REPLY (no Telegram post, no relay)", async () => {
    await handleToGroup("NO_REPLY", 1);
    expect(sendMessageTelegram).not.toHaveBeenCalled();
    expect(maybeRelayToGroupPeers).not.toHaveBeenCalled();
  });

  it("suppresses NO_REPLY with surrounding whitespace/newlines", async () => {
    await handleToGroup("  NO_REPLY\n", 1);
    expect(sendMessageTelegram).not.toHaveBeenCalled();
    expect(maybeRelayToGroupPeers).not.toHaveBeenCalled();
  });

  it("still posts and relays a real message", async () => {
    await handleToGroup("Pushed the fix — gateway restart when calm.", 1);
    expect(sendMessageTelegram).toHaveBeenCalledTimes(1);
    expect(maybeRelayToGroupPeers).toHaveBeenCalledTimes(1);
  });

  it("does not suppress a real message that merely contains the token mid-text", async () => {
    await handleToGroup("The agent can answer with NO_REPLY to stay silent.", 1);
    expect(sendMessageTelegram).toHaveBeenCalledTimes(1);
  });
});
