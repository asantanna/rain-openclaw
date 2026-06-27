export type MindTheoryConfig = {
  librarian?: { enabled?: boolean; model?: string; syncCompaction?: boolean };
  bedtime?: { idleMinutes?: number; enabled?: boolean };
  nightly?: {
    enabled?: boolean;
    hour?: number;
    minute?: number;
    tz?: string;
    minIdleMinutes?: number;
    /**
     * When true, the nightly cycle compacts each eligible session (which
     * side-effects a fresh transcript). When false (default), the nightly
     * cycle only renders transcripts and leaves each session's live
     * context alone — compaction is left to the in-turn safety path
     * which only fires when context pressure makes it necessary.
     */
    compact?: boolean;
  };
  transcripts?: { enabled?: boolean };
  researcher?: { enabled?: boolean; inject?: boolean };
};
