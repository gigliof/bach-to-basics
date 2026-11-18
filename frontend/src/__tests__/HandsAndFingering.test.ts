import { describe, expect, it } from "vitest";
import type { NoteEvent } from "@bach-to-basics/shared";
import { assignHandsToTracks } from "../utils/handAssignment";
import { applyFingeringMarks, staffHandFor } from "../utils/fingeringMarks";

describe("assignHandsToTracks", () => {
  it("ignores a leading tempo track with no notes", () => {
    // [tempo, RH, LH] used to come out as [right, left, left]
    expect(assignHandsToTracks([[], [72, 76], [48, 52]])).toEqual(["unknown", "right", "left"]);
  });

  it("picks the right hand by pitch when the left-hand track comes first", () => {
    expect(
      assignHandsToTracks([
        [48, 52],
        [72, 76],
      ])
    ).toEqual(["left", "right"]);
  });

  it("keeps a single note track as unknown", () => {
    expect(assignHandsToTracks([[], [60, 64]])).toEqual(["unknown", "unknown"]);
  });

  it("with 3+ note tracks: first is right, the rest left", () => {
    expect(assignHandsToTracks([[72], [60], [48]])).toEqual(["right", "left", "left"]);
  });
});

const n = (id: string, midi: number, hand: NoteEvent["hand"]): NoteEvent => ({
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
});

describe("applyFingeringMarks", () => {
  it("fingers single-track MIDI (hand unknown) using the middle-C staff split", () => {
    const notes = [n("a", 64, "unknown"), n("b", 48, "unknown")];
    const out = applyFingeringMarks(notes, [
      { hand: "right", midi: 64, finger: 3 },
      { hand: "left", midi: 48, finger: 5 },
    ]);
    expect(out.map((x) => x.finger)).toEqual([3, 5]);
    expect(staffHandFor(notes[0])).toBe("right");
  });

  it("matches chord notes by pitch, not by their order in the XML", () => {
    const notes = [n("c", 60, "right"), n("e", 64, "right"), n("g", 67, "right")];
    const out = applyFingeringMarks(notes, [
      { hand: "right", midi: 67, finger: 5 },
      { hand: "right", midi: 60, finger: 1 },
      { hand: "right", midi: 64, finger: 3 },
    ]);
    expect(out.map((x) => x.finger)).toEqual([1, 3, 5]);
  });

  it("consumes repeated pitches in order and leaves unmatched notes empty", () => {
    const notes = [n("a", 60, "right"), n("b", 60, "right"), n("c", 62, "right")];
    const out = applyFingeringMarks(notes, [
      { hand: "right", midi: 60, finger: 1 },
      { hand: "right", midi: 60, finger: 2 },
    ]);
    expect(out.map((x) => x.finger)).toEqual([1, 2, null]);
  });

  it("keeps the two hands apart on the same pitch", () => {
    const notes = [n("r", 60, "right"), n("l", 60, "left")];
    const out = applyFingeringMarks(notes, [
      { hand: "left", midi: 60, finger: 1 },
      { hand: "right", midi: 60, finger: 2 },
    ]);
    expect(out.map((x) => x.finger)).toEqual([2, 1]);
  });
});
