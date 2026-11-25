import { describe, expect, it } from "vitest";
import { TestScorer } from "../engine/TestScorer";

const R = (midi: number) => ({ midi, hand: "right" as const });
const L = (midi: number) => ({ midi, hand: "left" as const });

describe("TestScorer", () => {
  it("counts a key pressed within the window after the note as correct", () => {
    const s = new TestScorer(300);
    s.noteStarted(R(60), 1000, true);
    s.input(60, 1200);
    expect(s.finish()).toMatchObject({ correct: 1, missed: 0, wrong: 0, score: 100 });
  });

  it("counts a key pressed slightly BEFORE the note as correct", () => {
    const s = new TestScorer(300);
    s.input(60, 900);
    s.noteStarted(R(60), 1000, true);
    expect(s.finish()).toMatchObject({ correct: 1, wrong: 0, missed: 0 });
  });

  it("a key pressed too early is wrong, and the note is then missed", () => {
    const s = new TestScorer(300);
    s.input(60, 500);
    s.noteStarted(R(60), 1000, true);
    expect(s.finish()).toMatchObject({ correct: 0, wrong: 1, missed: 1 });
  });

  it("a key pressed too late is wrong, and the note missed", () => {
    const s = new TestScorer(300);
    s.noteStarted(R(60), 1000, true);
    s.input(60, 1400);
    expect(s.finish()).toMatchObject({ correct: 0, wrong: 1, missed: 1 });
  });

  it("a wrong key is wrong and the note missed", () => {
    const s = new TestScorer(300);
    s.noteStarted(R(60), 1000, true);
    s.input(61, 1000);
    expect(s.finish()).toMatchObject({ correct: 0, wrong: 1, missed: 1, score: 0 });
  });

  it("each note can only be hit once", () => {
    const s = new TestScorer(300);
    s.noteStarted(R(60), 1000, true);
    s.input(60, 1000);
    s.input(60, 1050);
    expect(s.finish()).toMatchObject({ correct: 1, wrong: 1 });
  });

  it("scores every note of a chord", () => {
    const s = new TestScorer(300);
    [60, 64, 67].forEach((m) => s.noteStarted(R(m), 1000, true));
    s.input(60, 1010);
    s.input(64, 1020);
    expect(s.finish()).toMatchObject({ correct: 2, missed: 1, score: 67 });
  });

  it("matches a repeated pitch to the closest note", () => {
    const s = new TestScorer(300);
    s.noteStarted(R(60), 1000, true);
    s.noteStarted(R(60), 1200, true);
    s.input(60, 1190); // closer to the second
    s.input(60, 1210); // the first note is the only one left, 210 ms away: still in the window
    expect(s.finish()).toMatchObject({ correct: 2, wrong: 0, missed: 0 });
  });

  it("doesn't score the other hand's notes, or penalise playing them", () => {
    const s = new TestScorer(300);
    s.noteStarted(R(72), 1000, true);
    s.noteStarted(L(48), 1000, false); // left hand isn't being tested
    s.input(72, 1000);
    s.input(48, 1000); // playing along with the app's part
    const r = s.finish();
    expect(r).toMatchObject({ correct: 1, wrong: 0, missed: 0, score: 100 });
    expect(r.byHand).toEqual({ left: { correct: 0, total: 0 }, right: { correct: 1, total: 1 } });
  });

  it("breaks results down per hand", () => {
    const s = new TestScorer(300);
    s.noteStarted(R(72), 1000, true);
    s.noteStarted(L(48), 1000, true);
    s.input(72, 1000);
    s.input(48, 1000);
    s.noteStarted(L(50), 2000, true); // not played
    expect(s.finish().byHand).toEqual({
      left: { correct: 1, total: 2 },
      right: { correct: 1, total: 1 },
    });
  });

  it("live totals settle as time passes", () => {
    const s = new TestScorer(300);
    s.noteStarted(R(60), 1000, true);
    expect(s.totals.missed).toBe(0); // window still open
    s.advance(1301);
    expect(s.totals.missed).toBe(1);
  });

  it("scores 0 when nothing happened", () => {
    expect(new TestScorer().finish()).toMatchObject({ correct: 0, missed: 0, wrong: 0, score: 0 });
  });
});
