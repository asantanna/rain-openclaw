import fs from "node:fs/promises";
import type { OpenClawConfig } from "../config/types.js";
import { isNightlyEnabled, resolveMindTheoryConfig } from "./config.js";
import { runCompaction, snapshotKnownSessions } from "./idle-compaction.js";

/**
 * Nightly compaction scheduler.
 *
 * At the configured hour:minute (local tz), iterate over every session
 * the gateway has seen run during its lifetime and compact those that
 * have been idle for at least `minIdleMinutes` AND have new content
 * since their last compaction. Skip the rest.
 *
 * Independent of bedtime (idle-compaction.ts). You can run BOTH:
 *   bedtime catches sessions that go idle during the day,
 *   nightly catches anything bedtime missed (and anything that's been
 *     active right up to bedtime hours).
 *
 * Or just one. Or neither, in which case compactions only happen when
 * a session naturally fills its context mid-turn (the safety path in
 * compact.ts itself, independent of this file).
 *
 * The scheduler uses a single setTimeout per gateway lifetime. After
 * each firing it computes the next "next-hour-tomorrow" and schedules
 * again. Restart-safe — re-derives the next fire time on boot.
 */

let scheduled: ReturnType<typeof setTimeout> | undefined;

/** Compute the next firing instant (Date) for hour:minute in the given tz. */
function nextFireDate(hour: number, minute: number, tz: string, now: Date = new Date()): Date {
  // Strategy: ask Intl.DateTimeFormat to format `now` in the target tz,
  // extract the wall-clock hour/minute/second, and use that to determine
  // whether to fire today or tomorrow. Then construct the target UTC
  // instant by walking forward in 1-minute steps from the next minute
  // boundary that matches.
  //
  // Avoids importing a tz library (cheap and stdlib-only) at the cost of
  // a tight loop — bounded to ≤ 1440 iterations.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const start = new Date(now);
  // Round up to next whole minute to keep the loop bounded and exact.
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);
  for (let i = 0; i < 1440 * 2; i++) {
    const candidate = new Date(start.getTime() + i * 60_000);
    const parts = fmt.formatToParts(candidate);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "-1");
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "-1");
    if (h === hour && m === minute) {
      return candidate;
    }
  }
  // Fallback: 24h from now (shouldn't happen, but never crash)
  return new Date(now.getTime() + 24 * 3600 * 1000);
}

/**
 * One nightly cycle.
 *
 * Two modes, selected by `mt.nightly.compact`:
 *   true  → compact every eligible session (transcript is re-rendered as a
 *           side-effect of compaction running through compact.ts).
 *   false → render transcripts only; never call session.compact(). Sessions
 *           keep their full context until in-turn compaction (context
 *           pressure) forces a summary on its own schedule.
 *
 * In both modes the cycle skips sessions whose source JSONL hasn't grown
 * since the last action (no work to do). The minIdleMinutes floor still
 * applies in compact mode — we don't want to interrupt a session that
 * was active a moment ago. The idle floor does NOT apply to transcribe-
 * only mode (transcription is non-destructive and there's no reason to
 * wait for a session to go quiet before reading it).
 */
async function runNightlyCycle(config?: OpenClawConfig): Promise<void> {
  const mt = resolveMindTheoryConfig(config);
  const sessions = snapshotKnownSessions();
  const mode = mt.nightly.compact ? "compact" : "transcribe-only";
  console.log(
    `[mind-theory] nightly: cycle starting (mode=${mode}, ${sessions.size} known session(s))`,
  );
  if (sessions.size === 0) {
    console.log(
      `[mind-theory] nightly: nothing to do (no sessions tracked yet — common on a freshly-restarted gateway)`,
    );
    return;
  }

  if (mt.nightly.compact) {
    await runCompactCycle(sessions, mt.nightly.minIdleMinutes);
  } else {
    await runTranscribeOnlyCycle(sessions);
  }
}

async function runCompactCycle(
  sessions: ReadonlyMap<string, import("./idle-compaction.js").CompactParams>,
  minIdleMinutes: number,
): Promise<void> {
  const minIdleMs = minIdleMinutes * 60 * 1000;
  const nowMs = Date.now();
  let compacted = 0;
  let skippedIdle = 0;
  let errors = 0;
  for (const [sessionKey, params] of sessions) {
    try {
      const stat = await fs.stat(params.sessionFile);
      const idleMs = nowMs - stat.mtimeMs;
      if (idleMs < minIdleMs) {
        console.log(
          `[mind-theory] nightly: skipping ${sessionKey} (active ${Math.floor(idleMs / 1000)}s ago, < ${minIdleMinutes}m idle floor)`,
        );
        skippedIdle++;
        continue;
      }
      // runCompaction itself logs the "unchanged → skip" case (and is
      // a strict no-op when there's nothing new), so we don't try to
      // double-bookkeep the unchanged count here.
      await runCompaction(params, "nightly");
      compacted++;
    } catch (err) {
      console.log(`[mind-theory] nightly: error on ${sessionKey}: ${String(err)}`);
      errors++;
    }
  }
  console.log(
    `[mind-theory] nightly: cycle done. attempted=${compacted} skipped_idle=${skippedIdle} errors=${errors} (unchanged-skip counts in per-session logs)`,
  );
}

async function runTranscribeOnlyCycle(
  sessions: ReadonlyMap<string, import("./idle-compaction.js").CompactParams>,
): Promise<void> {
  const { generateReadableTranscript } = await import("./transcript-to-text.js");
  let rendered = 0;
  let errors = 0;
  for (const [sessionKey, params] of sessions) {
    try {
      // generateReadableTranscript skips internally when the existing .txt
      // is at least as fresh as the source JSONL — cheap to call here.
      await generateReadableTranscript({
        sessionKey: params.sessionKey,
        sessionFile: params.sessionFile,
      });
      rendered++;
    } catch (err) {
      console.log(`[mind-theory] nightly: transcript error on ${sessionKey}: ${String(err)}`);
      errors++;
    }
  }
  console.log(
    `[mind-theory] nightly: cycle done. transcribed=${rendered} errors=${errors} (per-session "updated" lines indicate which actually rewrote)`,
  );
}

/**
 * Start the nightly scheduler. Idempotent — safe to call multiple
 * times; the second call cancels the first's pending fire and
 * re-schedules.
 *
 * No-op when nightly compaction is disabled in config.
 */
export function startNightlyScheduler(config?: OpenClawConfig): void {
  if (!isNightlyEnabled(config)) {
    console.log("[mind-theory] nightly: disabled in config, scheduler not started");
    return;
  }
  if (scheduled !== undefined) {
    clearTimeout(scheduled);
    scheduled = undefined;
  }
  scheduleNext(config);
}

/** Stop the scheduler. Safe to call when not running. */
export function stopNightlyScheduler(): void {
  if (scheduled !== undefined) {
    clearTimeout(scheduled);
    scheduled = undefined;
  }
}

function scheduleNext(config?: OpenClawConfig): void {
  const mt = resolveMindTheoryConfig(config);
  const target = nextFireDate(mt.nightly.hour, mt.nightly.minute, mt.nightly.tz);
  const delayMs = target.getTime() - Date.now();
  console.log(
    `[mind-theory] nightly: next cycle at ${target.toISOString()} (in ${Math.round(delayMs / 60000)} min, tz=${mt.nightly.tz})`,
  );
  scheduled = setTimeout(() => {
    runNightlyCycle(config)
      .catch((err) => console.log(`[mind-theory] nightly: cycle error: ${String(err)}`))
      .finally(() => scheduleNext(config));
  }, delayMs);
  scheduled.unref();
}
