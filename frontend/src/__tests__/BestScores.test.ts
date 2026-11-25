import { describe, expect, it } from "vitest";
import { bestScoreKey, isBetter, recordTestResult, songFingerprint } from "../utils/bestScores";

const memoryStore = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

const notes = [
  { midi: 60, startSeconds: 0 },
  { midi: 64, startSeconds: 0.5 },
  { midi: 67, startSeconds: 1 },
];

describe("song fingerprint", () => {
  it("is the same for the same notes, whatever the import", () => {
    expect(songFingerprint(notes)).toBe(songFingerprint(notes.map((n) => ({ ...n }))));
  });

  it("differs when a pitch or an onset differs", () => {
    const fp = songFingerprint(notes);
    expect(songFingerprint([{ midi: 61, startSeconds: 0 }, ...notes.slice(1)])).not.toBe(fp);
    expect(songFingerprint([...notes.slice(0, 2), { midi: 67, startSeconds: 1.1 }])).not.toBe(fp);
    expect(songFingerprint(notes.slice(0, 2))).not.toBe(fp);
  });
});

describe("best scores", () => {
  it("keeps separate bests per hands and per section", () => {
    const fp = songFingerprint(notes);
    const keys = new Set([
      bestScoreKey(fp, ["left", "right"], null),
      bestScoreKey(fp, ["right", "left"], null), // same hands, other order
      bestScoreKey(fp, ["right"], null),
      bestScoreKey(fp, ["right"], { from: 0, to: 4 }),
    ]);
    expect(keys.size).toBe(3);
  });

  it("higher score wins; on a tie, the faster tempo", () => {
    const best = { score: 80, tempoPct: 90, date: "" };
    expect(isBetter({ score: 81, tempoPct: 50 }, best)).toBe(true);
    expect(isBetter({ score: 80, tempoPct: 100 }, best)).toBe(true);
    expect(isBetter({ score: 80, tempoPct: 90 }, best)).toBe(false);
    expect(isBetter({ score: 79, tempoPct: 100 }, best)).toBe(false);
    expect(isBetter({ score: 0, tempoPct: 100 }, null)).toBe(true);
  });

  it("records the first run, then reports the previous best", () => {
    const store = memoryStore();
    const first = recordTestResult("k", { score: 60, tempoPct: 100 }, store);
    expect(first).toEqual({ previousBest: null, isNewBest: true });

    const worse = recordTestResult("k", { score: 50, tempoPct: 100 }, store);
    expect(worse.isNewBest).toBe(false);
    expect(worse.previousBest).toMatchObject({ score: 60, tempoPct: 100 });

    const better = recordTestResult("k", { score: 75, tempoPct: 100 }, store);
    expect(better.isNewBest).toBe(true);
    expect(better.previousBest).toMatchObject({ score: 60 });

    expect(recordTestResult("k", { score: 70, tempoPct: 100 }, store).previousBest).toMatchObject({
      score: 75,
    });
  });

  it("survives corrupt storage and works without storage", () => {
    const store = memoryStore();
    store.setItem("b2b-best-scores", "not json");
    expect(recordTestResult("k", { score: 10, tempoPct: 100 }, store).isNewBest).toBe(true);
    expect(recordTestResult("k", { score: 10, tempoPct: 100 }, null)).toEqual({
      previousBest: null,
      isNewBest: false,
    });
  });
});
