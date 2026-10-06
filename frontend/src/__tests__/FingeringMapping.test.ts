import { describe, expect, it } from "vitest";
import type { NoteEvent } from "@bach-to-basics/shared";
import { applyFingeringMarks, type FingeringMark } from "../utils/fingeringMapping";

function note(
  id: string,
  midi: number,
  hand: "left" | "right" | "unknown",
  startSeconds: number
): NoteEvent {
  return {
    id,
    midi,
    pitch: "C4",
    startTick: 0,
    durationTick: 480,
    startSeconds,
    endSeconds: startSeconds + 0.5,
    hand,
    finger: null,
    velocity: 80,
    channel: 0,
  };
}

describe("applyFingeringMarks", () => {
  it("maps generated fingerings onto single-track MIDI notes with unknown hand", () => {
    const notes = [
      note("n1", 60, "unknown", 0),
      note("n2", 64, "unknown", 0.5),
      note("n3", 48, "unknown", 1),
    ];
    const marks: FingeringMark[] = [
      { midi: 60, hand: "right", finger: 1 },
      { midi: 64, hand: "right", finger: 3 },
      { midi: 48, hand: "left", finger: 5 },
    ];

    expect(applyFingeringMarks(notes, marks).map((n) => n.finger)).toEqual([1, 3, 5]);
  });

  it("keeps left/right occurrences separated when MIDI already has hand metadata", () => {
    const notes = [
      note("r1", 60, "right", 0),
      note("l1", 60, "left", 0),
    ];
    const marks: FingeringMark[] = [
      { midi: 60, hand: "right", finger: 1 },
      { midi: 60, hand: "left", finger: 5 },
    ];

    expect(applyFingeringMarks(notes, marks).map((n) => n.finger)).toEqual([1, 5]);
  });

  it("preserves repeated-pitch occurrence order including unannotated marks", () => {
    const notes = [
      note("n1", 60, "unknown", 0),
      note("n2", 60, "unknown", 1),
      note("n3", 60, "unknown", 2),
    ];
    const marks: FingeringMark[] = [
      { midi: 60, hand: "right", finger: 1 },
      { midi: 60, hand: "right", finger: null },
      { midi: 60, hand: "right", finger: 3 },
    ];

    expect(applyFingeringMarks(notes, marks).map((n) => n.finger)).toEqual([1, null, 3]);
  });
});
