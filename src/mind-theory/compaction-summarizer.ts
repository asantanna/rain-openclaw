import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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
 * Write the SDK compaction summary to a per-session-key file.
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

    const selfDir = join(workspaceDir, "self");
    await mkdir(selfDir, { recursive: true });

    const fileName = `before-compact-summary--${slug}.md`;
    const filePath = join(selfDir, fileName);
    const content = `<!-- Compaction summary for ${sessionKey} at ${new Date().toISOString()} -->\n\n${summary.trim()}\n`;

    await writeFile(filePath, content, "utf-8");
    console.log(`[mind-theory] wrote compaction summary: ${fileName}`);
  } catch (err) {
    console.log(`[mind-theory] compaction summary write failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Load compaction summaries (for injection into fresh sessions)
// ---------------------------------------------------------------------------

const SUMMARY_PREFIX = "before-compact-summary--";
const SUMMARY_SUFFIX = ".md";

/**
 * Load all per-session-key compaction summaries from the workspace.
 * Returns formatted context string for system prompt injection, or null if none found.
 * Never throws.
 */
export async function loadCompactionSummaries(workspaceDir: string): Promise<string | null> {
  try {
    const selfDir = join(workspaceDir, "self");
    let entries: string[];
    try {
      entries = await readdir(selfDir);
    } catch {
      return null; // self/ directory doesn't exist
    }

    const summaryFiles = entries
      .filter((f) => f.startsWith(SUMMARY_PREFIX) && f.endsWith(SUMMARY_SUFFIX))
      .toSorted();

    if (summaryFiles.length === 0) {
      return null;
    }

    const sections: string[] = [];
    for (const file of summaryFiles) {
      try {
        const content = await readFile(join(selfDir, file), "utf-8");
        const trimmed = content.trim();
        if (!trimmed) {
          continue;
        }
        // Extract slug from filename for section header
        const slug = file.slice(SUMMARY_PREFIX.length, -SUMMARY_SUFFIX.length);
        sections.push(`### Context from ${slug} session\n\n${trimmed}`);
      } catch {
        // Skip unreadable files
      }
    }

    if (sections.length === 0) {
      return null;
    }

    return `## Previous Session Context\n\nThe following summaries were saved from your most recent sessions. Use them to maintain continuity.\n\n${sections.join("\n\n---\n\n")}`;
  } catch (err) {
    console.log(`[mind-theory] failed to load compaction summaries: ${String(err)}`);
    return null;
  }
}
