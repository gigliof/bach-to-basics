import { describe, expect, it } from "vitest";
import {
  ACCIDENTAL,
  collectNoteBoxes,
  sheetNoteLabel,
  textColorOn,
} from "../utils/sheetNoteLabels";

const note = (midi: number, keySignature = 0, accidentalMode = 0) => ({
  midi,
  keySignature,
  accidentalMode,
});

describe("sheet note labels: which notes", () => {
  it("'none' hides everything", () => {
    expect(sheetNoteLabel(note(60), "none", false)).toBe("");
  });

  it("'all' names every note, without octave", () => {
    expect(sheetNoteLabel(note(60), "all", false)).toBe("C");
    expect(sheetNoteLabel(note(66), "all", false)).toBe("F♯");
  });

  it("'white' and 'black' filter by key colour", () => {
    expect(sheetNoteLabel(note(64), "white", false)).toBe("E");
    expect(sheetNoteLabel(note(66), "white", false)).toBe("");
    expect(sheetNoteLabel(note(66), "black", false)).toBe("F♯");
    expect(sheetNoteLabel(note(64), "black", false)).toBe("");
  });

  it("'c_only' names Cs with their octave", () => {
    expect(sheetNoteLabel(note(60), "c_only", false)).toBe("C4");
    expect(sheetNoteLabel(note(72), "c_only", false)).toBe("C5");
    expect(sheetNoteLabel(note(62), "c_only", false)).toBe("");
  });
});

describe("sheet note labels: spelling follows the score", () => {
  it("uses the key signature: sharps in G major, flats in F major", () => {
    expect(sheetNoteLabel(note(66, 1), "all", true)).toBe("F♯"); // G major, even with flats preferred
    expect(sheetNoteLabel(note(70, -1), "all", false)).toBe("B♭"); // F major, even with sharps preferred
  });

  it("a written accidental beats the key signature", () => {
    expect(sheetNoteLabel(note(70, 1, ACCIDENTAL.ForceFlat), "all", false)).toBe("B♭");
    expect(sheetNoteLabel(note(68, -2, ACCIDENTAL.ForceSharp), "all", true)).toBe("G♯");
  });

  it("in C major with nothing written, the app's sharps/flats setting decides", () => {
    expect(sheetNoteLabel(note(61), "all", false)).toBe("C♯");
    expect(sheetNoteLabel(note(61), "all", true)).toBe("D♭");
  });
});

describe("label text colour", () => {
  it("picks dark text on light colours and white on dark ones", () => {
    expect(textColorOn("#22d3ee")).toBe("#111"); // light cyan
    expect(textColorOn("#ffffff")).toBe("#111");
    expect(textColorOn("#9333ea")).toBe("#fff"); // purple
    expect(textColorOn("#000000")).toBe("#fff");
    expect(textColorOn("not-a-colour")).toBe("#fff");
  });
});

describe("collecting noteheads from alphaTab's layout", () => {
  // A fake bounds lookup: one system, one bar per staff of a two-staff piano track
  const track: Record<string, unknown> = { index: 0, staves: [{}, {}], score: { tracks: [{}] } };
  const staff = (index: number) => ({ index, track });
  const masterBar = { keySignature: 1 };
  const nb = (realValue: number, extra: Record<string, unknown> = {}) => ({
    note: { realValue, accidentalMode: 0, isPercussion: false, isTieDestination: false, ...extra },
    noteHeadBounds: { x: 10, y: 20, w: 8, h: 7 },
  });
  const lookup = {
    staffSystems: [
      {
        bars: [
          {
            bars: [
              {
                bar: { staff: staff(0), masterBar },
                beats: [
                  { beat: { duration: 4 }, notes: [nb(67)] },
                  { beat: { duration: 2 }, notes: [nb(71), nb(74)] },
                  { beat: { duration: 1 }, notes: [nb(71, { isTieDestination: true })] },
                  { beat: { duration: 4 }, notes: null }, // rest
                ],
              },
              {
                bar: { staff: staff(1), masterBar },
                beats: [{ beat: { duration: 1 }, notes: [nb(43)] }],
              },
            ],
          },
        ],
      },
    ],
  };

  it("reads position, pitch, key, hand and open noteheads; skips tied continuations and rests", () => {
    const boxes = collectNoteBoxes(lookup);
    expect(boxes.map((b) => [b.midi, b.hand, b.open, b.keySignature])).toEqual([
      [67, "right", false, 1],
      [71, "right", true, 1],
      [74, "right", true, 1],
      [43, "left", true, 1],
    ]);
    expect(boxes[0]).toMatchObject({ x: 10, y: 20, w: 8, h: 7 });
  });

  it("uses track order when each hand is its own part", () => {
    const right = { index: 0, staves: [{}], score: { tracks: [{}, {}] } };
    const left = { index: 1, staves: [{}], score: { tracks: [{}, {}] } };
    const two = {
      staffSystems: [
        {
          bars: [
            {
              bars: [
                {
                  bar: { staff: { index: 0, track: right }, masterBar },
                  beats: [{ beat: { duration: 4 }, notes: [nb(72)] }],
                },
                {
                  bar: { staff: { index: 0, track: left }, masterBar },
                  beats: [{ beat: { duration: 4 }, notes: [nb(48)] }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(collectNoteBoxes(two).map((b) => b.hand)).toEqual(["right", "left"]);
  });

  it("copes with an empty or missing layout", () => {
    expect(collectNoteBoxes(null)).toEqual([]);
    expect(collectNoteBoxes({ staffSystems: [] })).toEqual([]);
  });
});
