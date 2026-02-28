import type { OpenClawConfig } from "../config/types.js";
import { isLibrarianEnabled, resolveMindTheoryConfig } from "./config.js";

/**
 * Per-session idle timer state.
 * When a session goes idle for longer than `bedtime.idleMinutes`,
 * we trigger compaction so the Librarian can process recent turns.
 */

type IdleTimerEntry = {
  timer: ReturnType<typeof setTimeout>;
  compactParams: StoredCompactParams;
};

type StoredCompactParams = {
  sessionFile: string;
  sessionKey: string;
  config?: OpenClawConfig;
  provider?: string;
  model?: string;
  workspaceDir: string;
};

const idleTimers = new Map<string, IdleTimerEntry>();

/**
 * Reset the idle compaction timer for a session.
 * Called after every agent run completes.
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
  if (!isLibrarianEnabled(config)) {
    return;
  }

  const mtConfig = resolveMindTheoryConfig(config);
  const idleMs = mtConfig.bedtime.idleMinutes * 60 * 1000;

  // Clear existing timer for this session
  const existing = idleTimers.get(sessionKey);
  if (existing) {
    clearTimeout(existing.timer);
  }

  const compactParams: StoredCompactParams = {
    sessionFile: runParams.sessionFile,
    sessionKey,
    config,
    provider: runParams.provider,
    model: runParams.model,
    workspaceDir: runParams.workspaceDir ?? process.cwd(),
  };

  const timer = setTimeout(() => {
    idleTimers.delete(sessionKey);
    void triggerIdleCompaction(compactParams);
  }, idleMs);

  // Don't keep the process alive just for idle timers
  timer.unref();

  idleTimers.set(sessionKey, { timer, compactParams });
}

/**
 * Trigger compaction for an idle session.
 * Uses compactEmbeddedPiSessionDirect which has NO 40% threshold.
 */
async function triggerIdleCompaction(params: StoredCompactParams): Promise<void> {
  console.log(`[mind-theory] bedtime: session ${params.sessionKey} idle, triggering compaction`);

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
      `[mind-theory] bedtime: compaction ${result.ok ? "succeeded" : "failed"}: ${result.reason ?? "ok"}`,
    );
  } catch (err) {
    console.log(`[mind-theory] bedtime: compaction error: ${String(err)}`);
  }
}
