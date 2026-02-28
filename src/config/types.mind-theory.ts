export type MindTheoryConfig = {
  librarian?: { enabled?: boolean; model?: string; syncCompaction?: boolean };
  bedtime?: { idleMinutes?: number };
  researcher?: { enabled?: boolean; inject?: boolean };
};
