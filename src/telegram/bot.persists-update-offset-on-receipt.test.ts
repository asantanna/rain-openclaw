// Regression guard for the stale-message-replay bug: the durable update-offset
// watermark must be persisted ON RECEIPT (before the update is handled), so that
// a gateway restart never replays a message we already received — even if the
// handler was slow, queued, or interrupted by the restart. See bot.ts: the
// receipt-time onUpdateId call in the logging/offset middleware.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTelegramBot } from "./bot.js";

const { loadConfig } = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({
    channels: { telegram: { dmPolicy: "open", allowFrom: ["*"] } },
  })),
}));
vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return { ...actual, loadConfig };
});

const middlewareUseSpy = vi.fn();
const onSpy = vi.fn();
const apiStub = {
  config: { use: vi.fn() },
  answerCallbackQuery: vi.fn(async () => undefined),
  sendChatAction: vi.fn(),
  setMessageReaction: vi.fn(async () => undefined),
  setMyCommands: vi.fn(async () => undefined),
  sendMessage: vi.fn(async () => ({ message_id: 1 })),
  sendAnimation: vi.fn(async () => ({ message_id: 2 })),
  sendPhoto: vi.fn(async () => ({ message_id: 3 })),
};
vi.mock("grammy", () => ({
  Bot: class {
    api = apiStub;
    use = middlewareUseSpy;
    on = onSpy;
    stop = vi.fn();
    command = vi.fn();
    catch = vi.fn();
    constructor(public token: string) {}
  },
  InputFile: class {},
  webhookCallback: vi.fn(),
}));

const sequentializeMiddleware = vi.fn();
vi.mock("@grammyjs/runner", () => ({
  sequentialize: () => sequentializeMiddleware,
}));
vi.mock("@grammyjs/transformer-throttler", () => ({
  apiThrottler: () => vi.fn(),
}));

type Middleware = (ctx: unknown, next: () => Promise<void>) => Promise<void>;

/**
 * Find the logging/offset middleware among the captured bot.use(...) calls: the
 * inline async middleware (the sequentialize middleware is a no-op stub here).
 */
function findOffsetMiddleware(): Middleware {
  for (const call of middlewareUseSpy.mock.calls) {
    const mw = call[0] as Middleware;
    if (typeof mw !== "function" || mw === sequentializeMiddleware) {
      continue;
    }
    return mw;
  }
  throw new Error("offset middleware not found");
}

describe("telegram offset watermark persistence on receipt", () => {
  beforeEach(() => {
    middlewareUseSpy.mockReset();
    onSpy.mockReset();
  });

  it("persists a new update's offset on receipt, before the handler runs", async () => {
    const onUpdateId = vi.fn();
    createTelegramBot({ token: "tok", updateOffset: { lastUpdateId: 100, onUpdateId } });
    const mw = findOffsetMiddleware();

    let persistedBeforeNext = false;
    const next = vi.fn(async () => {
      persistedBeforeNext = onUpdateId.mock.calls.length > 0;
    });
    await mw({ update: { update_id: 101 } }, next);

    expect(onUpdateId).toHaveBeenCalledWith(101);
    expect(persistedBeforeNext).toBe(true); // recorded on receipt, not after handling
  });

  it("still persists the offset when the handler throws (restart-interrupted case)", async () => {
    const onUpdateId = vi.fn();
    createTelegramBot({ token: "tok", updateOffset: { lastUpdateId: 100, onUpdateId } });
    const mw = findOffsetMiddleware();

    const next = vi.fn(async () => {
      throw new Error("handler interrupted");
    });
    await expect(mw({ update: { update_id: 101 } }, next)).rejects.toThrow("handler interrupted");

    // The whole point: an interrupted/failed handler does not lose the watermark,
    // so the message can't be replayed after a restart.
    expect(onUpdateId).toHaveBeenCalledWith(101);
  });

  it("does not re-persist an already-seen (replayed) update on receipt", async () => {
    const onUpdateId = vi.fn();
    createTelegramBot({ token: "tok", updateOffset: { lastUpdateId: 100, onUpdateId } });
    const mw = findOffsetMiddleware();

    const next = vi.fn(async () => {});
    await mw({ update: { update_id: 50 } }, next); // <= watermark → stale/dup

    expect(onUpdateId).not.toHaveBeenCalled();
  });
});
