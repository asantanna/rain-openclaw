import type { OpenClawConfig } from "../config/types.js";

export type ResolvedMindTheoryConfig = {
  librarian: { enabled: boolean; model: string; syncCompaction: boolean };
  bedtime: { idleMinutes: number; enabled: boolean };
  nightly: {
    enabled: boolean;
    hour: number;
    minute: number;
    tz: string;
    minIdleMinutes: number;
    compact: boolean;
  };
  transcripts: { enabled: boolean };
  researcher: { enabled: boolean; inject: boolean };
};

const DEFAULTS: ResolvedMindTheoryConfig = {
  librarian: { enabled: false, model: "claude-sonnet-4-6", syncCompaction: true },
  // bedtime.enabled defaults to TRUE so we preserve historical behaviour:
  // before this change, idle compaction fired whenever the librarian was on
  // (and ONLY then). Now it fires whenever bedtime.enabled is on, regardless
  // of the librarian. Anyone with a config that didn't explicitly disable
  // idle compaction keeps getting it.
  bedtime: { idleMinutes: 30, enabled: true },
  // nightly compaction is the new option for "scheduled once-a-day" behaviour.
  // Default OFF so it's an opt-in feature for operators who want predictable
  // scheduling instead of unpredictable idle-driven triggers.
  nightly: {
    enabled: false,
    hour: 4,
    minute: 0,
    tz: "America/Los_Angeles",
    minIdleMinutes: 30,
    // Default FALSE: when the nightly scheduler fires, only render
    // transcripts. Don't force a daily compaction — that would summarize
    // away context even when the session has plenty of room left. Set
    // to TRUE if you want each nightly cycle to also force a compaction.
    compact: false,
  },
  // transcripts.enabled gates the readable-transcript renderer in compact.ts.
  // Default TRUE so disabling the librarian no longer silently kills
  // transcript generation (the bug this change fixes).
  transcripts: { enabled: true },
  researcher: { enabled: false, inject: false },
};

export function resolveMindTheoryConfig(cfg?: OpenClawConfig): ResolvedMindTheoryConfig {
  const mt = cfg?.mindTheory;
  if (!mt) {
    return DEFAULTS;
  }
  return {
    librarian: {
      enabled: mt.librarian?.enabled ?? DEFAULTS.librarian.enabled,
      model: mt.librarian?.model ?? DEFAULTS.librarian.model,
      syncCompaction: mt.librarian?.syncCompaction ?? DEFAULTS.librarian.syncCompaction,
    },
    bedtime: {
      idleMinutes: mt.bedtime?.idleMinutes ?? DEFAULTS.bedtime.idleMinutes,
      enabled: mt.bedtime?.enabled ?? DEFAULTS.bedtime.enabled,
    },
    nightly: {
      enabled: mt.nightly?.enabled ?? DEFAULTS.nightly.enabled,
      hour: mt.nightly?.hour ?? DEFAULTS.nightly.hour,
      minute: mt.nightly?.minute ?? DEFAULTS.nightly.minute,
      tz: mt.nightly?.tz ?? DEFAULTS.nightly.tz,
      minIdleMinutes: mt.nightly?.minIdleMinutes ?? DEFAULTS.nightly.minIdleMinutes,
      compact: mt.nightly?.compact ?? DEFAULTS.nightly.compact,
    },
    transcripts: {
      enabled: mt.transcripts?.enabled ?? DEFAULTS.transcripts.enabled,
    },
    researcher: {
      enabled: mt.researcher?.enabled ?? DEFAULTS.researcher.enabled,
      inject: mt.researcher?.inject ?? DEFAULTS.researcher.inject,
    },
  };
}

export function isLibrarianEnabled(cfg?: OpenClawConfig): boolean {
  return cfg?.mindTheory?.librarian?.enabled === true;
}

export function isResearcherEnabled(cfg?: OpenClawConfig): boolean {
  return cfg?.mindTheory?.researcher?.enabled === true;
}

/** True when both researcher.enabled AND researcher.inject are on. */
export function isResearcherInjectEnabled(cfg?: OpenClawConfig): boolean {
  const r = cfg?.mindTheory?.researcher;
  return r?.enabled === true && r?.inject === true;
}

/** Bedtime / idle-compaction master switch. Default TRUE if unset. */
export function isBedtimeEnabled(cfg?: OpenClawConfig): boolean {
  const b = cfg?.mindTheory?.bedtime?.enabled;
  return b ?? true;
}

/** Nightly scheduled compaction. Default FALSE if unset. */
export function isNightlyEnabled(cfg?: OpenClawConfig): boolean {
  return cfg?.mindTheory?.nightly?.enabled === true;
}

/** Readable-transcript generation. Default TRUE if unset. */
export function isTranscriptsEnabled(cfg?: OpenClawConfig): boolean {
  const t = cfg?.mindTheory?.transcripts?.enabled;
  return t ?? true;
}

/** Derive a human-readable agent name from an agentId. */
export function agentDisplayName(agentId: string): string {
  // "rain" → "Rain", "tio-claude" → "Tio Claude"
  return agentId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Name mapping per agent (Telegram handles → real names). */
export function getNameMapping(agentId: string): Record<string, string> {
  const maps: Record<string, Record<string, string>> = {
    rain: { "Rocka Pedra": "Dad", "@Rockapedra": "Dad", rockapedra: "Dad" },
    "tio-claude": {
      "Rocka Pedra": "André",
      "@Rockapedra": "André",
      rockapedra: "André",
    },
  };
  return maps[agentId] ?? {};
}
