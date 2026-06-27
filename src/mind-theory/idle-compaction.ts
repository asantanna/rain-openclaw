import fs from "node:fs/promises";
import type { OpenClawConfig } from "../config/types.js";
import { isBedtimeEnabled, resolveMindTheoryConfig } from "./config.js";

/**
 * Per-session idle timer state.
 * When a session goes idle for longer than `bedtime.idleMinutes`,
 * compaction is triggered — which in turn fires the readable-transcript
 * renderer and (if enabled) the librarian's batch processing.
 *
 * This scheduler is independent of the librarian: disabling the
 * librarian does NOT silently disable idle compaction. Use
 * `bedtime.enabled = false` to turn idle compaction off explicitly.
 *
 * Compaction-trigger params for every session that has run during the
 * gateway's lifetime are also tracked in `knownSessions` so the
 * nightly scheduler (in nightly-compaction.ts) can compact them even
 * when bedtime is disabled.
 */

export type CompactParams = {
  sessionFile: string;
  sessionKey: string;
  config?: OpenClawConfig;
  provider?: string;
  model?: string;
  workspaceDir: string;
};

type IdleTimerEntry = {
  timer: ReturnType<typeof setTimeout>;
};

const idleTimers = new Map<string, IdleTimerEntry>();

/** Every session we've seen this gateway lifetime, with its compaction params. */
const knownSessions = new Map<string, CompactParams>();

/**
 * Track session file size after the last successful compaction.
 * Used by both schedulers to skip no-op cycles when nothing new has
 * been written. Exposed so the nightly scheduler can share the map.
 */
const lastCompactedFileSize = new Map<string, number>();

export function getLastCompactedSize(sessionKey: string): number | undefined {
  return lastCompactedFileSize.get(sessionKey);
}

export function setLastCompactedSize(sessionKey: string, size: number): void {
  lastCompactedFileSize.set(sessionKey, size);
}

/** Snapshot of every session we've seen run this gateway lifetime. */
export function snapshotKnownSessions(): ReadonlyMap<string, CompactParams> {
  return new Map(knownSessions);
}

/**
 * Reset the idle compaction timer for a session.
 * Called after every agent run completes.
 *
 * Always records the session's compaction params (so the nightly
 * scheduler can find them), even when `bedtime.enabled = false`.
 * Only the idle timer itself is gated on the bedtime flag.
 */
export function resetIdleTimer(
  sessionKey: string,
  runParams: {
    sessionFile: string;
    config?: OpenClawConfig;
    provider?: string;
    model?: string;
    workspaceDir?: string;
  },
  config?: OpenClawConfig,
): void {
  const compactParams: CompactParams = {
    sessionFile: runParams.sessionFile,
    sessionKey,
    config,
    provider: runParams.provider,
    model: runParams.model,
    workspaceDir: runParams.workspaceDir ?? process.cwd(),
  };
  knownSessions.set(sessionKey, compactParams);

  if (!isBedtimeEnabled(config)) {
    return;
  }

  const mtConfig = resolveMindTheoryConfig(config);
  const idleMs = mtConfig.bedtime.idleMinutes * 60 * 1000;

  // Clear existing timer for this session
  const existing = idleTimers.get(sessionKey);
  if (existing) {
    clearTimeout(existing.timer);
  }

  const timer = setTimeout(() => {
    idleTimers.delete(sessionKey);
    runCompaction(compactParams, "bedtime").catch((err) => {
      console.log(`[mind-theory] bedtime: unhandled error: ${String(err)}`);
    });
  }, idleMs);

  // Don't keep the process alive just for idle timers
  timer.unref();

  idleTimers.set(sessionKey, { timer });
}

/**
 * Trigger compaction for a session. Shared by the idle (bedtime) and
 * nightly schedulers. Skips when the session file hasn't grown since
 * the last successful compaction (the "nothing to compact" floor).
 *
 * `tag` is used only as a log prefix so the caller's identity is
 * visible in journalctl ("bedtime" or "nightly").
 */
export async function runCompaction(params: CompactParams, tag: string): Promise<void> {
  // Skip if session file hasn't changed since last compaction
  try {
    const stat = await fs.stat(params.sessionFile);
    const prevSize = lastCompactedFileSize.get(params.sessionKey);
    if (prevSize !== undefined && stat.size === prevSize) {
      console.log(`[mind-theory] ${tag}: session ${params.sessionKey} unchanged, skipping`);
      return;
    }
  } catch {
    // File missing or stat failed — proceed with compaction anyway
  }

  console.log(`[mind-theory] ${tag}: triggering compaction for ${params.sessionKey}`);

  try {
    const { compactEmbeddedPiSessionDirect } =
      await import("../agents/pi-embedded-runner/compact.js");

    const result = await compactEmbeddedPiSessionDirect({
      sessionId: params.sessionKey,
      sessionKey: params.sessionKey,
      sessionFile: params.sessionFile,
      workspaceDir: params.workspaceDir,
      config: params.config,
      provider: params.provider,
      model: params.model,
    });

    console.log(
      `[mind-theory] ${tag}: compaction ${result.ok ? "succeeded" : "failed"}: ${result.reason ?? "ok"}`,
    );

    // Record file size after compaction to detect future no-ops
    if (result.ok) {
      try {
        const postStat = await fs.stat(params.sessionFile);
        lastCompactedFileSize.set(params.sessionKey, postStat.size);
      } catch {
        // Non-critical
      }
    }
  } catch (err) {
    console.log(`[mind-theory] ${tag}: compaction error: ${String(err)}`);
  }
}
