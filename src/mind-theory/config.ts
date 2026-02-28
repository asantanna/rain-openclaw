import type { OpenClawConfig } from "../config/types.js";

export type ResolvedMindTheoryConfig = {
  librarian: { enabled: boolean; model: string; syncCompaction: boolean };
  bedtime: { idleMinutes: number };
  researcher: { enabled: boolean };
};

const DEFAULTS: ResolvedMindTheoryConfig = {
  librarian: { enabled: false, model: "claude-sonnet-4-6", syncCompaction: true },
  bedtime: { idleMinutes: 30 },
  researcher: { enabled: false },
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
    },
    researcher: {
      enabled: mt.researcher?.enabled ?? DEFAULTS.researcher.enabled,
    },
  };
}

export function isLibrarianEnabled(cfg?: OpenClawConfig): boolean {
  return cfg?.mindTheory?.librarian?.enabled === true;
}

export function isResearcherEnabled(cfg?: OpenClawConfig): boolean {
  return cfg?.mindTheory?.researcher?.enabled === true;
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
