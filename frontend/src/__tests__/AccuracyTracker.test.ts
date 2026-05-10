import { describe, it, expect, beforeEach, afterEach } from "vitest";
import bus from "../engine/EventBus";
import { accuracyTracker } from "../engine/AccuracyTracker";
import type { NoteEvent } from "../../../shared/types/MusicData";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNote(
  id: string,
  midi: number,
  hand: "left" | "right" | "unknown" = "right"
): NoteEvent {
  return {
    id,
    midi,
    pitch: "C4",
    startTick: 0,
    durationTick: 480,
    startSeconds: 0,
    endSeconds: 1,
    hand,
    finger: null,
    velocity: 80,
    channel: 0,
  };
}

type AccuracyUpdate = { correct: number; wrong: number; missed: number; score: number };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AccuracyTracker", () => {
  let updates: AccuracyUpdate[] = [];

  const listener = (data: AccuracyUpdate) => {
    updates.push(data);
  };

  beforeEach(() => {
    updates = [];
    bus.on("accuracy:update", listener);
    accuracyTracker.enable(true);
    accuracyTracker.reset();
  });

  afterEach(() => {
    bus.off("accuracy:update", listener);
    accuracyTracker.enable(false);
  });

  // ── Initial state ─────────────────────────────────────────────────────────

  it("starts with score 0 and no counts", () => {
    expect(accuracyTracker.score).toBe(0);
  });

  // ── Correct hit ───────────────────────────────────────────────────────────

  it("records a correct hit when input arrives within the window", () => {
    const note = makeNote("n1", 60);
    bus.emit("note:on", note);
    bus.emit("input:note:on", { midi: 60, velocity: 80 });

    const last = updates[updates.length - 1];
    expect(last.correct).toBe(1);
    expect(last.wrong).toBe(0);
    expect(last.missed).toBe(0);
    expect(last.score).toBe(100);
  });

  it("score is 100 after a single correct hit", () => {
    const note = makeNote("n1", 60);
    bus.emit("note:on", note);
    bus.emit("input:note:on", { midi: 60, velocity: 80 });

    expect(accuracyTracker.score).toBe(100);
  });

  // ── Miss ─────────────────────────────────────────────────────────────────

  it("records a miss when note:off fires without any input", () => {
    const note = makeNote("n1", 60);
    bus.emit("note:on", note);
    bus.emit("note:off", note);

    const last = updates[updates.length - 1];
    expect(last.missed).toBe(1);
    expect(last.correct).toBe(0);
    expect(last.score).toBe(0);
  });

  it("ignores note:off for a note that was already hit", () => {
    const note = makeNote("n1", 60);
    bus.emit("note:on", note);
    bus.emit("input:note:on", { midi: 60, velocity: 80 }); // correct hit
    const countBefore = updates.length;
    bus.emit("note:off", note); // already hit - should not emit again

    // No new accuracy:update should have been emitted for the note:off
    expect(updates.length).toBe(countBefore);
    const last = updates[updates.length - 1];
    expect(last.missed).toBe(0);
  });

  // ── Wrong ─────────────────────────────────────────────────────────────────

  it("records wrong when input MIDI does not match any pending note", () => {
    const note = makeNote("n1", 60);
    bus.emit("note:on", note);
    bus.emit("input:note:on", { midi: 61, velocity: 80 }); // wrong key

    const last = updates[updates.length - 1];
    expect(last.wrong).toBe(1);
    expect(last.correct).toBe(0);
  });

  it("records wrong when no notes are pending at all", () => {
    bus.emit("input:note:on", { midi: 60, velocity: 80 });

    const last = updates[updates.length - 1];
    expect(last.wrong).toBe(1);
  });

  it("second input for the same already-hit note counts as wrong", () => {
    const note = makeNote("n1", 60);
    bus.emit("note:on", note);
    bus.emit("input:note:on", { midi: 60, velocity: 80 }); // correct
    bus.emit("input:note:on", { midi: 60, velocity: 80 }); // note already marked hit → wrong

    const last = updates[updates.length - 1];
    expect(last.correct).toBe(1);
    expect(last.wrong).toBe(1);
  });

  // ── Score formula ─────────────────────────────────────────────────────────

  it("score = correct / total * 100, rounded", () => {
    // 2 correct + 1 wrong + 1 missed = 4 total → 50%
    const n1 = makeNote("n1", 60);
    const n2 = makeNote("n2", 62);
    const n3 = makeNote("n3", 64);

    bus.emit("note:on", n1);
    bus.emit("input:note:on", { midi: 60, velocity: 80 }); // correct

    bus.emit("note:on", n2);
    bus.emit("input:note:on", { midi: 62, velocity: 80 }); // correct

    bus.emit("note:on", n3);
    bus.emit("note:off", n3); // missed

    bus.emit("input:note:on", { midi: 99, velocity: 80 }); // wrong (no pending note)

    const last = updates[updates.length - 1];
    expect(last.correct).toBe(2);
    expect(last.missed).toBe(1);
    expect(last.wrong).toBe(1);
    expect(last.score).toBe(50);
  });

  it("score rounds to nearest integer", () => {
    // 2 correct + 1 wrong = 3 total → 66.67% → rounds to 67
    const n1 = makeNote("n1", 60);
    const n2 = makeNote("n2", 62);

    bus.emit("note:on", n1);
    bus.emit("input:note:on", { midi: 60, velocity: 80 }); // correct

    bus.emit("note:on", n2);
    bus.emit("input:note:on", { midi: 62, velocity: 80 }); // correct

    bus.emit("input:note:on", { midi: 99, velocity: 80 }); // wrong

    expect(accuracyTracker.score).toBe(67);
  });

  // ── Multiple simultaneous pending notes ───────────────────────────────────

  it("hits the correct note among multiple simultaneously pending notes", () => {
    const c = makeNote("n1", 60);
    const e = makeNote("n2", 64);
    const g = makeNote("n3", 67);

    bus.emit("note:on", c);
    bus.emit("note:on", e);
    bus.emit("note:on", g);

    bus.emit("input:note:on", { midi: 64, velocity: 80 }); // hits E
    bus.emit("input:note:on", { midi: 60, velocity: 80 }); // hits C
    bus.emit("note:off", g); // G not played → missed

    const last = updates[updates.length - 1];
    expect(last.correct).toBe(2);
    expect(last.missed).toBe(1);
    expect(last.wrong).toBe(0);
  });

  // ── Reset ─────────────────────────────────────────────────────────────────

  it("reset clears all counts and emits zeros", () => {
    const note = makeNote("n1", 60);
    bus.emit("note:on", note);
    bus.emit("note:off", note); // missed

    accuracyTracker.reset();

    const last = updates[updates.length - 1];
    expect(last.correct).toBe(0);
    expect(last.wrong).toBe(0);
    expect(last.missed).toBe(0);
    expect(last.score).toBe(0);
    expect(accuracyTracker.score).toBe(0);
  });

  // ── Disabled ─────────────────────────────────────────────────────────────

  it("emits nothing and records nothing when disabled", () => {
    accuracyTracker.enable(false);
    const countBefore = updates.length;

    const note = makeNote("n1", 60);
    bus.emit("note:on", note);
    bus.emit("input:note:on", { midi: 60, velocity: 80 });
    bus.emit("note:off", note);

    expect(updates.length).toBe(countBefore);
    expect(accuracyTracker.score).toBe(0);
  });

  // ── Transport events ──────────────────────────────────────────────────────

  it("resets when transport stops", () => {
    const note = makeNote("n1", 60);
    bus.emit("note:on", note);
    bus.emit("note:off", note); // missed → score 0%

    bus.emit("transport:stateChange", { status: "stopped", seconds: 0 });

    expect(accuracyTracker.score).toBe(0);
    const last = updates[updates.length - 1];
    expect(last.missed).toBe(0);
  });

  it("seek clears pending notes so subsequent note:off does not count as missed", () => {
    const note = makeNote("n1", 60);
    bus.emit("note:on", note); // enters pending
    bus.emit("transport:seek", { seconds: 5 }); // clears pending

    const countBefore = updates.length;
    bus.emit("note:off", note); // pending was cleared - should be a no-op

    // No new accuracy:update should have fired
    expect(updates.length).toBe(countBefore);
    expect(accuracyTracker.score).toBe(0);
  });
});
