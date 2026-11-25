import { describe, expect, it } from "vitest";
import { chordName, detectChords, spreadLabels, type TimedNote } from "../utils/chordNames";
import { collectChordLayout } from "../utils/sheetNoteLabels";

// MIDI helpers: C4 = 60
const C3 = 48,
  E3 = 52,
  F2 = 41,
  G2 = 43,
  A2 = 45,
  D3 = 50;
const C4 = 60,
  D4 = 62,
  E4 = 64,
  F4 = 65,
  G4 = 67,
  A4 = 69,
  B3 = 59,
  C5 = 72,
  Bb3 = 58;

describe("chordName", () => {
  it("names triads in root position", () => {
    expect(chordName([C4, E4, G4], false)).toBe("C");
    expect(chordName([A2, C4, E4], false)).toBe("Am");
    expect(chordName([B3, D4, F4], false)).toBe("Bdim");
    expect(chordName([C4, E4, 68], false)).toBe("Caug");
    expect(chordName([C4, F4, G4], false)).toBe("Csus4");
  });

  it("shows inversions with a slash bass", () => {
    expect(chordName([E3, G4, C5], false)).toBe("C/E");
    expect(chordName([G2, C4, E4], false)).toBe("C/G");
  });

  it("names sevenths, sixths and ninths", () => {
    expect(chordName([G2, B3, D4, F4], false)).toBe("G7");
    expect(chordName([C4, E4, G4, 71], false)).toBe("Cmaj7");
    expect(chordName([D3, F4, A4, C5], false)).toBe("Dm7");
    expect(chordName([G2, B3, F4], false)).toBe("G7"); // fifth left out
    expect(chordName([C3, E4, G4, A4], false)).toBe("C6");
    expect(chordName([C3, D4, E4, G4, Bb3], false)).toBe("C9");
  });

  it("an ambiguous set takes the reading with its root in the bass", () => {
    expect(chordName([C3, E4, G4, A4], false)).toBe("C6"); // same notes as Am7
    expect(chordName([A2, C4, E4, G4], false)).toBe("Am7");
  });

  it("gives no name to fewer than 3 pitch classes or unknown shapes", () => {
    expect(chordName([C4, C5, G4], false)).toBeNull(); // only C and G
    expect(chordName([C4, D4, E4], false)).toBeNull(); // cluster
    expect(chordName([], false)).toBeNull();
  });

  it("spells roots with sharps or flats as asked", () => {
    expect(chordName([Bb3, D4, F4], true)).toBe("B♭");
    expect(chordName([Bb3, D4, F4], false)).toBe("A♯");
  });
});

const nt = (
  midi: number,
  start: number,
  end: number,
  extra: Partial<TimedNote> = {}
): TimedNote => ({
  midi,
  start,
  end,
  tied: false,
  keySignature: 0,
  ...extra,
});

describe("detectChords", () => {
  it("names block chords and keeps only changes", () => {
    const notes = [
      ...[C4, E4, G4].map((m) => nt(m, 0, 1)),
      ...[C4, E4, G4].map((m) => nt(m, 1, 2)), // same chord again: not repeated
      ...[B3, D4, G4].map((m) => nt(m, 2, 3)),
    ];
    expect(detectChords(notes, false)).toEqual([
      { start: 0, name: "C" },
      { start: 2, name: "G/B" }, // B is the lowest note
    ]);
  });

  it("includes a held bass note (for inversions) but needs 3 notes struck together", () => {
    const notes = [
      nt(E3, 0, 4), // held bass
      ...[G4, C5].map((m) => nt(m, 0, 1)), // 3 struck with the bass: C/E
      ...[G4, C5, 76].map((m) => nt(m, 2, 3)), // 3 struck, bass still held: C/E again (no repeat)
      ...[D4, F4].map((m) => nt(m, 3, 4)), // only 2 struck: ignored
    ];
    expect(detectChords(notes, false)).toEqual([{ start: 0, name: "C/E" }]);
  });

  it("ignores broken chords (one note at a time)", () => {
    const notes = [C4, E4, G4, C5].map((m, i) => nt(m, i, i + 1));
    expect(detectChords(notes, false)).toEqual([]);
  });

  it("tied continuations sound but aren't struck again", () => {
    const notes = [
      ...[C4, E4, G4].map((m) => nt(m, 0, 2)),
      ...[C4, E4, G4].map((m) => nt(m, 2, 4, { tied: true })),
    ];
    expect(detectChords(notes, false)).toEqual([{ start: 0, name: "C" }]);
  });

  it("spells by key signature, falling back to the app setting in C", () => {
    const bb = [Bb3, D4, F4];
    expect(
      detectChords(
        bb.map((m) => nt(m, 0, 1, { keySignature: -1 })),
        false
      )[0].name
    ).toBe("B♭");
    expect(
      detectChords(
        bb.map((m) => nt(m, 0, 1, { keySignature: 2 })),
        true
      )[0].name
    ).toBe("A♯");
    expect(
      detectChords(
        bb.map((m) => nt(m, 0, 1)),
        true
      )[0].name
    ).toBe("B♭");
  });

  it("handles a real progression with bass notes", () => {
    const notes = [
      nt(C3, 0, 1),
      ...[C4, E4, G4].map((m) => nt(m, 0, 1)),
      nt(F2, 1, 2),
      ...[C4, F4, A4].map((m) => nt(m, 1, 2)),
      nt(G2, 2, 3),
      ...[B3, D4, G4].map((m) => nt(m, 2, 3)),
    ];
    expect(detectChords(notes, false).map((c) => c.name)).toEqual(["C", "F", "G"]);
  });
});

describe("spreadLabels", () => {
  it("nudges overlapping labels right on the same line only", () => {
    const out = spreadLabels(
      [
        { x: 0, y: 10, width: 30 },
        { x: 20, y: 10, width: 10 }, // overlaps the first: moves to 34
        { x: 100, y: 10, width: 10 }, // clear: stays
        { x: 5, y: 50, width: 10 }, // another line: unaffected
      ],
      4
    );
    expect(out.map((o) => [o.x, o.y])).toEqual([
      [0, 10],
      [34, 10],
      [100, 10],
      [5, 50],
    ]);
  });
});

describe("collectChordLayout", () => {
  const beat = (
    start: number,
    duration: number,
    midis: number[],
    extra: Record<string, unknown> = {}
  ) => ({
    beat: {
      absolutePlaybackStart: start,
      playbackDuration: duration,
      notes: midis.map((m) => ({ realValue: m, isPercussion: false, isTieDestination: false })),
      hasChord: false,
      ...extra,
    },
    onNotesX: start / 10,
    notes: [],
  });
  const lookup = (beats: unknown[], staffIndex = 0) => ({
    staffSystems: [
      {
        realBounds: { y: 100 },
        bars: [
          {
            bars: [
              {
                bar: {
                  staff: { index: staffIndex, track: { index: 0 } },
                  masterBar: { keySignature: 1 },
                },
                beats,
              },
            ],
          },
        ],
      },
    ],
  });

  it("collects timed notes and one anchor per moment; skips rests and grace notes", () => {
    const layout = collectChordLayout(
      lookup([beat(0, 960, [C4, E4]), beat(960, 0, [D4]), beat(960, 960, [])])
    );
    expect(layout.notes.map((n) => [n.midi, n.start, n.end, n.keySignature])).toEqual([
      [C4, 0, 960, 1],
      [E4, 0, 960, 1],
    ]);
    expect(layout.anchors.get(0)).toEqual({ x: 0, y: 100, rank: 0 });
    expect(layout.fileHasChords).toBe(false);
  });

  it("notices chord symbols written in the file", () => {
    expect(collectChordLayout(lookup([beat(0, 960, [C4], { hasChord: true })])).fileHasChords).toBe(
      true
    );
  });
});
