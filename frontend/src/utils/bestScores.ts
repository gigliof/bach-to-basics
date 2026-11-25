/**
 * Best Test Mode score per song, kept in localStorage.
 *
 * Songs are identified by their notes, not by the import id, so re-importing
 * the same file finds its earlier best. A best is kept separately for each
 * hand choice and each tested section (whole piece or a given A-B range).
 */
import type { NoteEvent } from "@bach-to-basics/shared";

const STORAGE_KEY = "b2b-best-scores";

export interface BestScore {
  score: number;
  tempoPct: number;
  /** ISO date of the run */
  date: string;
}

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Stable id for a piece: FNV-1a hash of its pitches and onsets (10 ms grid). */
export function songFingerprint(notes: Pick<NoteEvent, "midi" | "startSeconds">[]): string {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= n & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (n >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (n >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  mix(notes.length);
  for (const n of notes) {
    mix(n.midi);
    mix(Math.round(n.startSeconds * 100));
  }
  return (h >>> 0).toString(36);
}

export function bestScoreKey(
  fingerprint: string,
  hands: readonly string[],
  section: { from: number; to: number } | null
): string {
  const h = [...hands].sort().join("+");
  const s = section ? `${section.from.toFixed(2)}-${section.to.toFixed(2)}` : "piece";
  return `${fingerprint}|${h}|${s}`;
}

/** Is `a` better than `b`? Higher score wins; on a tie, the faster tempo. */
export function isBetter(a: Pick<BestScore, "score" | "tempoPct">, b: BestScore | null): boolean {
  if (!b) return true;
  return a.score > b.score || (a.score === b.score && a.tempoPct > b.tempoPct);
}

function readAll(store: KeyValueStore): Record<string, BestScore> {
  try {
    const parsed: unknown = JSON.parse(store.getItem(STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, BestScore>)
      : {};
  } catch {
    return {};
  }
}

function defaultStore(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Record a finished run. Returns the best from BEFORE this run (null if none)
 * and whether this run beat it.
 */
export function recordTestResult(
  key: string,
  run: { score: number; tempoPct: number },
  store: KeyValueStore | null = defaultStore(),
  now = new Date()
): { previousBest: BestScore | null; isNewBest: boolean } {
  if (!store) return { previousBest: null, isNewBest: false };
  const all = readAll(store);
  const prev = all[key];
  const previousBest =
    prev && typeof prev.score === "number" && typeof prev.tempoPct === "number" ? prev : null;
  const isNewBest = isBetter(run, previousBest);
  if (isNewBest) {
    all[key] = { score: run.score, tempoPct: run.tempoPct, date: now.toISOString() };
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
      /* storage full or blocked - ignore */
    }
  }
  return { previousBest, isNewBest };
}
