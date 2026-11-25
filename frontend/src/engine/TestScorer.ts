/**
 * TestScorer - scores one Test Mode run.
 *
 * Pure (no event bus, no clock): callers pass timestamps in ms, so it can be
 * driven by real playback or by tests.
 *
 * A note counts as correct when its key is pressed within WINDOW_MS of the
 * note's start, before OR after (a key pressed slightly early is held as
 * "unmatched" and claimed when the note arrives). A note nobody played within
 * the window is missed; a key press that matches nothing is wrong.
 *
 * Notes of hands that aren't being tested are tracked but not scored, so
 * playing along with them is neither rewarded nor counted as wrong.
 */

export const TEST_WINDOW_MS = 300;

export type TestHand = "left" | "right";

interface Expected {
  midi: number;
  hand: TestHand | "unknown";
  at: number;
  hit: boolean;
  scored: boolean;
}

export interface TestTotals {
  correct: number;
  missed: number;
  wrong: number;
  /** correct / (correct + missed + wrong), 0-100 */
  score: number;
}

export interface TestResult extends TestTotals {
  /** Scored notes per hand (notes with no hand assigned only count in the totals) */
  byHand: Record<TestHand, { correct: number; total: number }>;
}

export class TestScorer {
  private expected: Expected[] = [];
  private unmatched: { midi: number; at: number }[] = [];
  private correct = 0;
  private missed = 0;
  private wrong = 0;
  private byHand: Record<TestHand, { correct: number; total: number }> = {
    left: { correct: 0, total: 0 },
    right: { correct: 0, total: 0 },
  };

  constructor(private readonly windowMs = TEST_WINDOW_MS) {}

  /** A note of the piece starts sounding (or would, for the player's own notes). */
  noteStarted(note: { midi: number; hand: TestHand | "unknown" }, at: number, scored: boolean) {
    this.advance(at);
    const e: Expected = { midi: note.midi, hand: note.hand, at, hit: false, scored };
    // Claim a key pressed just before this note arrived
    const early = this.unmatched.findIndex(
      (u) => u.midi === note.midi && at - u.at <= this.windowMs
    );
    if (early !== -1) {
      this.unmatched.splice(early, 1);
      this.markHit(e);
    }
    this.expected.push(e);
  }

  /** The player pressed a key. */
  input(midi: number, at: number) {
    this.advance(at);
    let best: Expected | null = null;
    for (const e of this.expected) {
      if (e.hit || e.midi !== midi) continue;
      if (Math.abs(at - e.at) > this.windowMs) continue;
      if (!best || Math.abs(at - e.at) < Math.abs(at - best.at)) best = e;
    }
    if (best) this.markHit(best);
    else this.unmatched.push({ midi, at });
  }

  /** Settle everything whose window has closed by `now`. */
  advance(now: number) {
    this.unmatched = this.unmatched.filter((u) => {
      if (now - u.at <= this.windowMs) return true;
      this.wrong++;
      return false;
    });
    this.expected = this.expected.filter((e) => {
      if (now - e.at <= this.windowMs) return true;
      if (!e.hit && e.scored) {
        this.missed++;
        this.countHand(e, false);
      }
      return false;
    });
  }

  /** End of the run: settle everything still open. */
  finish(): TestResult {
    this.advance(Infinity);
    return { ...this.totals, byHand: structuredClone(this.byHand) };
  }

  get totals(): TestTotals {
    const total = this.correct + this.missed + this.wrong;
    return {
      correct: this.correct,
      missed: this.missed,
      wrong: this.wrong,
      score: total === 0 ? 0 : Math.round((this.correct / total) * 100),
    };
  }

  private markHit(e: Expected) {
    e.hit = true;
    if (!e.scored) return;
    this.correct++;
    this.countHand(e, true);
  }

  private countHand(e: Expected, correct: boolean) {
    if (e.hand === "unknown") return;
    this.byHand[e.hand].total++;
    if (correct) this.byHand[e.hand].correct++;
  }
}
