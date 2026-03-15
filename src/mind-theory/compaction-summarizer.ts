import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Write compaction summary
// ---------------------------------------------------------------------------

export type CompactionSummaryParams = {
  sessionKey: string;
  workspaceDir: string;
  summary: string;
};

/**
 * Slugify a session key into a safe filename component.
 * Strips the `agent:{id}:` prefix and replaces `:` with `-`.
 */
function slugifySessionKey(sessionKey: string): string {
  // Strip "agent:{agentId}:" prefix (e.g. "agent:rain:main" → "main")
  const stripped = sessionKey.replace(/^agent:[^:]+:/, "");
  return stripped.replaceAll(":", "-");
}

/**
 * Format a Date as a filesystem-safe ISO timestamp (colons → hyphens).
 * e.g. "2026-03-13T08-10-58Z"
 */
function fsTimestamp(date: Date): string {
  return date
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d+Z$/, "Z");
}

const SUMMARIES_DIR = "compact-summaries";

/**
 * Write the SDK compaction summary to a timestamped file.
 * Append-only: never overwrites previous summaries.
 * Called from compact.ts AFTER session.compact() succeeds.
 * Never throws — failure is logged but does not block compaction.
 */
export async function writeCompactionSummary(params: CompactionSummaryParams): Promise<void> {
  try {
    const { sessionKey, workspaceDir, summary } = params;

    if (!summary?.trim()) {
      return;
    }

    const slug = slugifySessionKey(sessionKey);

    // Skip cron sessions — they have no useful conversation context
    if (slug.startsWith("cron-")) {
      return;
    }

    const summariesDir = join(workspaceDir, "self", SUMMARIES_DIR);
    await mkdir(summariesDir, { recursive: true });

    const ts = fsTimestamp(new Date());
    const fileName = `${ts}--${slug}.md`;
    const filePath = join(summariesDir, fileName);
    const content = `<!-- Compaction summary for ${sessionKey} at ${new Date().toISOString()} -->\n\n${summary.trim()}\n`;

    await writeFile(filePath, content, "utf-8");
    console.log(`[mind-theory] wrote compaction summary: ${SUMMARIES_DIR}/${fileName}`);

    // Clean up files older than 48 hours (fire-and-forget)
    pruneOldSummaries(summariesDir, 48 * 60 * 60 * 1000).catch(() => {});
  } catch (err) {
    console.log(`[mind-theory] compaction summary write failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Prune old summary files
// ---------------------------------------------------------------------------

async function pruneOldSummaries(summariesDir: string, maxAgeMs: number): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  const entries = await readdir(summariesDir);
  for (const file of entries) {
    if (!file.endsWith(".md")) {
      continue;
    }
    const dashDash = file.indexOf("--");
    if (dashDash < 0) {
      continue;
    }
    const ts = parseTimestamp(file.slice(0, dashDash));
    if (ts && ts.getTime() < cutoff) {
      await unlink(join(summariesDir, file));
    }
  }
}

// ---------------------------------------------------------------------------
// Load compaction summaries (for injection into system prompt)
// ---------------------------------------------------------------------------

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Parse a filesystem-safe ISO timestamp back to a Date.
 * e.g. "2026-03-13T08-10-58Z" → Date
 */
function parseTimestamp(ts: string): Date | null {
  // Restore colons: "2026-03-13T08-10-58Z" → "2026-03-13T08:10:58Z"
  const restored = ts.replace(/T(\d{2})-(\d{2})-(\d{2})Z/, "T$1:$2:$3Z");
  const d = new Date(restored);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Load all compaction summaries from the last 24 hours.
 * Returns formatted context string for system prompt injection, or null if none found.
 * Never throws.
 */
export async function loadCompactionSummaries(workspaceDir: string): Promise<string | null> {
  try {
    const summariesDir = join(workspaceDir, "self", SUMMARIES_DIR);
    let entries: string[];
    try {
      entries = await readdir(summariesDir);
    } catch {
      return null; // directory doesn't exist yet
    }

    const now = Date.now();
    const cutoff = now - TWENTY_FOUR_HOURS_MS;

    // Filter to .md files with a parseable timestamp within the last 24 hours
    const recentFiles: { file: string; ts: Date; slug: string }[] = [];
    for (const file of entries) {
      if (!file.endsWith(".md")) {
        continue;
      }
      // Expected format: {timestamp}--{slug}.md
      const dashDash = file.indexOf("--");
      if (dashDash < 0) {
        continue;
      }
      const tsStr = file.slice(0, dashDash);
      const slug = file.slice(dashDash + 2, -3); // strip "--" prefix and ".md" suffix
      const ts = parseTimestamp(tsStr);
      if (!ts || ts.getTime() < cutoff) {
        continue;
      }
      recentFiles.push({ file, ts, slug });
    }

    if (recentFiles.length === 0) {
      return null;
    }

    // Sort by timestamp (oldest first)
    recentFiles.sort((a, b) => a.ts.getTime() - b.ts.getTime());

    const sections: string[] = [];
    for (const { file, slug } of recentFiles) {
      try {
        const content = await readFile(join(summariesDir, file), "utf-8");
        const trimmed = content.trim();
        if (!trimmed) {
          continue;
        }
        sections.push(`### Context from ${slug} session\n\n${trimmed}`);
      } catch {
        // Skip unreadable files
      }
    }

    if (sections.length === 0) {
      return null;
    }

    return `## Previous Session Context\n\nThe following summaries were saved from your most recent sessions (last 24 hours). Use them to maintain continuity.\n\n${sections.join("\n\n---\n\n")}`;
  } catch (err) {
    console.log(`[mind-theory] failed to load compaction summaries: ${String(err)}`);
    return null;
  }
}
