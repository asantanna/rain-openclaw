import { describe, expect, it } from "vitest";
import {
  createSessionCompactTool,
  consumePendingCompactRequest,
  markCompactionCompleted,
} from "./session-compact-tool.js";

describe("session_compact tool", () => {
  describe("consumePendingCompactRequest", () => {
    it("returns undefined when no request is pending", () => {
      expect(consumePendingCompactRequest("test:none")).toBeUndefined();
    });

    it("returns and removes a pending request", async () => {
      const tool = createSessionCompactTool({ agentSessionKey: "test:consume" });
      await tool.execute("call-1", {});

      const request = consumePendingCompactRequest("test:consume");
      expect(request).toBeDefined();

      // Second consume returns nothing
      expect(consumePendingCompactRequest("test:consume")).toBeUndefined();
    });

    it("preserves custom instructions", async () => {
      const tool = createSessionCompactTool({ agentSessionKey: "test:instr" });
      await tool.execute("call-1", { instructions: "Keep family conversation" });

      const request = consumePendingCompactRequest("test:instr");
      expect(request?.instructions).toBe("Keep family conversation");
    });
  });

  describe("dedup", () => {
    it("returns already-pending message on second call in same turn", async () => {
      const key = "test:dedup";
      const tool = createSessionCompactTool({ agentSessionKey: key });

      const first = await tool.execute("call-1", {});
      expect(first.details).toMatchObject({ ok: true, reason: "scheduled" });

      const second = await tool.execute("call-2", {});
      expect(second.details).toMatchObject({ ok: true, reason: "already_pending" });

      // Cleanup
      consumePendingCompactRequest(key);
    });
  });

  describe("cooldown", () => {
    it("rejects compaction within cooldown period", async () => {
      const key = "test:cooldown";
      // Simulate a recent compaction
      markCompactionCompleted(key);

      const tool = createSessionCompactTool({ agentSessionKey: key });
      const result = await tool.execute("call-1", {});

      expect(result.details).toMatchObject({ ok: false, reason: "cooldown" });
      const details = result.details as Record<string, unknown>;
      expect(details.remainingSec).toBeGreaterThan(0);
    });
  });

  describe("no session key", () => {
    it("returns error when no session key is provided", async () => {
      const tool = createSessionCompactTool({});
      const result = await tool.execute("call-1", {});

      expect(result.details).toMatchObject({ ok: false, reason: "no_session_key" });
    });
  });

  describe("tool metadata", () => {
    it("has correct name and label", () => {
      const tool = createSessionCompactTool({ agentSessionKey: "test:meta" });
      expect(tool.name).toBe("session_compact");
      expect(tool.label).toBe("Session Compact");
    });
  });
});
