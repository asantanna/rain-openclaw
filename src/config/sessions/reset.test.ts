import { describe, expect, it } from "vitest";
import type { SessionConfig } from "../types.base.js";
import { evaluateSessionFreshness, resolveSessionResetPolicy } from "./reset.js";

describe("resolveSessionResetPolicy", () => {
  describe("backward compatibility: resetByType.dm → direct", () => {
    it("uses resetByType.direct when available", () => {
      const sessionCfg = {
        resetByType: {
          direct: { mode: "idle" as const, idleMinutes: 30 },
        },
      } satisfies SessionConfig;

      const policy = resolveSessionResetPolicy({
        sessionCfg,
        resetType: "direct",
      });

      expect(policy.mode).toBe("idle");
      expect(policy.idleMinutes).toBe(30);
    });

    it("falls back to resetByType.dm (legacy) when direct is missing", () => {
      // Simulating legacy config with "dm" key instead of "direct"
      const sessionCfg = {
        resetByType: {
          dm: { mode: "idle" as const, idleMinutes: 45 },
        },
      } as unknown as SessionConfig;

      const policy = resolveSessionResetPolicy({
        sessionCfg,
        resetType: "direct",
      });

      expect(policy.mode).toBe("idle");
      expect(policy.idleMinutes).toBe(45);
    });

    it("prefers resetByType.direct over resetByType.dm when both present", () => {
      const sessionCfg = {
        resetByType: {
          direct: { mode: "daily" as const },
          dm: { mode: "idle" as const, idleMinutes: 99 },
        },
      } as unknown as SessionConfig;

      const policy = resolveSessionResetPolicy({
        sessionCfg,
        resetType: "direct",
      });

      expect(policy.mode).toBe("daily");
    });

    it("does not use dm fallback for group/thread types", () => {
      const sessionCfg = {
        resetByType: {
          dm: { mode: "idle" as const, idleMinutes: 45 },
        },
      } as unknown as SessionConfig;

      const groupPolicy = resolveSessionResetPolicy({
        sessionCfg,
        resetType: "group",
      });

      // Should use default mode since group has no config and dm doesn't apply
      expect(groupPolicy.mode).toBe("daily");
    });
  });

  it("passes through mode: 'never'", () => {
    const sessionCfg = { reset: { mode: "never" as const } } as unknown as SessionConfig;
    const policy = resolveSessionResetPolicy({ sessionCfg, resetType: "direct" });
    expect(policy.mode).toBe("never");
    expect(policy.idleMinutes).toBeUndefined();
  });
});

describe("evaluateSessionFreshness", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("keeps a 'never' session fresh regardless of age", () => {
    const now = 1_000_000_000_000;
    const freshness = evaluateSessionFreshness({
      updatedAt: now - 30 * DAY, // untouched for a month
      now,
      policy: { mode: "never", atHour: 4 },
    });
    expect(freshness.fresh).toBe(true);
    expect(freshness.dailyResetAt).toBeUndefined();
    expect(freshness.idleExpiresAt).toBeUndefined();
  });

  it("still expires a 'daily' session updated before today's boundary", () => {
    const now = 1_000_000_000_000;
    const freshness = evaluateSessionFreshness({
      updatedAt: now - 2 * DAY,
      now,
      policy: { mode: "daily", atHour: 4 },
    });
    expect(freshness.fresh).toBe(false);
  });
});
