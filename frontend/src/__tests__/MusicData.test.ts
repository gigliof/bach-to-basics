import { describe, it, expect } from "vitest";
import {
  midiToPitch,
  midiToNoteName,
  isBlackKey,
  keySignatureToLabel,
  scaleTime,
  computeMeasureSeconds,
  computeBeatSeconds,
} from "../../../shared/types/MusicData";
import type { TempoEvent, TimeSignatureEvent } from "../../../shared/types/MusicData";

// ── midiToPitch ───────────────────────────────────────────────────────────────

describe("midiToPitch", () => {
  it("returns correct pitch for middle C (MIDI 60)", () => {
    expect(midiToPitch(60)).toBe("C4");
  });

  it("returns correct pitch for A4 (MIDI 69)", () => {
    expect(midiToPitch(69)).toBe("A4");
  });

  it("uses sharps by default", () => {
    expect(midiToPitch(61)).toBe("C#4");
  });

  it("uses flats when useFlats=true", () => {
    expect(midiToPitch(61, true)).toBe("D♭4");
  });

  it("handles the lowest MIDI note (0 = C-1)", () => {
    expect(midiToPitch(0)).toBe("C-1");
  });

  it("handles the highest MIDI note (127 = G9)", () => {
    expect(midiToPitch(127)).toBe("G9");
  });

  it("returns correct octave for B3 (MIDI 59)", () => {
    expect(midiToPitch(59)).toBe("B3");
  });
});

// ── midiToNoteName ────────────────────────────────────────────────────────────

describe("midiToNoteName", () => {
  it("returns note name without octave", () => {
    expect(midiToNoteName(60)).toBe("C");
    expect(midiToNoteName(69)).toBe("A");
  });

  it("uses sharps by default", () => {
    expect(midiToNoteName(61)).toBe("C#");
  });

  it("uses flats when useFlats=true", () => {
    expect(midiToNoteName(70, true)).toBe("B♭");
  });

  it("octave boundary: 12 notes apart have the same name", () => {
    expect(midiToNoteName(60)).toBe(midiToNoteName(72)); // C4 and C5
  });
});

// ── isBlackKey ────────────────────────────────────────────────────────────────

describe("isBlackKey", () => {
  it("identifies black keys correctly", () => {
    // C#/Db, D#/Eb, F#/Gb, G#/Ab, A#/Bb
    [1, 3, 6, 8, 10].forEach((mod) => {
      expect(isBlackKey(mod), `mod ${mod} should be black`).toBe(true);
      expect(isBlackKey(mod + 12), `midi ${mod + 12} should be black`).toBe(true);
    });
  });

  it("identifies white keys correctly", () => {
    // C, D, E, F, G, A, B
    [0, 2, 4, 5, 7, 9, 11].forEach((mod) => {
      expect(isBlackKey(mod), `mod ${mod} should be white`).toBe(false);
    });
  });

  it("middle C (MIDI 60) is a white key", () => {
    expect(isBlackKey(60)).toBe(false);
  });

  it("C# (MIDI 61) is a black key", () => {
    expect(isBlackKey(61)).toBe(true);
  });
});

// ── keySignatureToLabel ───────────────────────────────────────────────────────

describe("keySignatureToLabel", () => {
  it("formats a major key signature", () => {
    expect(keySignatureToLabel({ key: "C", scale: "major" })).toBe("C major");
  });

  it("formats a minor key signature", () => {
    expect(keySignatureToLabel({ key: "A", scale: "minor" })).toBe("A minor");
  });

  it("handles sharp key names", () => {
    expect(keySignatureToLabel({ key: "F#", scale: "major" })).toBe("F# major");
  });
});

// ── scaleTime ─────────────────────────────────────────────────────────────────

describe("scaleTime", () => {
  it("at 1.0x tempo, returns the original time", () => {
    expect(scaleTime(10, 1.0)).toBe(10);
  });

  it("at 2.0x tempo, halves the time (piece plays faster)", () => {
    expect(scaleTime(10, 2.0)).toBe(5);
  });

  it("at 0.5x tempo, doubles the time (piece plays slower)", () => {
    expect(scaleTime(10, 0.5)).toBe(20);
  });

  it("handles zero", () => {
    expect(scaleTime(0, 1.5)).toBe(0);
  });
});

// ── computeMeasureSeconds ────────────────────────────────────────────────────

describe("computeMeasureSeconds", () => {
  const tempo120: TempoEvent[] = [{ tick: 0, bpm: 120 }];
  const ts4_4: TimeSignatureEvent[] = [{ tick: 0, numerator: 4, denominator: 4 }];

  it("returns empty array when no time signatures", () => {
    expect(computeMeasureSeconds([], tempo120, 480, 10)).toEqual([]);
  });

  it("returns empty array when no tempo map", () => {
    expect(computeMeasureSeconds(ts4_4, [], 480, 10)).toEqual([]);
  });

  it("first measure always starts at 0", () => {
    const measures = computeMeasureSeconds(ts4_4, tempo120, 480, 10);
    expect(measures[0]).toBe(0);
  });

  it("at 120 BPM, 4/4: each measure is 2 seconds apart", () => {
    // 120 BPM = 0.5s per beat; 4 beats = 2s per measure
    const measures = computeMeasureSeconds(ts4_4, tempo120, 480, 8);
    expect(measures[0]).toBeCloseTo(0);
    expect(measures[1]).toBeCloseTo(2);
    expect(measures[2]).toBeCloseTo(4);
    expect(measures[3]).toBeCloseTo(6);
  });

  it("at 120 BPM, 3/4: each measure is 1.5 seconds apart", () => {
    const ts3_4: TimeSignatureEvent[] = [{ tick: 0, numerator: 3, denominator: 4 }];
    const measures = computeMeasureSeconds(ts3_4, tempo120, 480, 6);
    expect(measures[0]).toBeCloseTo(0);
    expect(measures[1]).toBeCloseTo(1.5);
    expect(measures[2]).toBeCloseTo(3);
  });

  it("stops before totalDuration + 1s safety buffer", () => {
    const measures = computeMeasureSeconds(ts4_4, tempo120, 480, 4);
    // 4s total: should have measures at 0, 2, 4 but not 6
    expect(measures.every((t) => t <= 5)).toBe(true);
  });
});

// ── computeBeatSeconds ───────────────────────────────────────────────────────

describe("computeBeatSeconds", () => {
  const tempo120: TempoEvent[] = [{ tick: 0, bpm: 120 }];
  const ts4_4: TimeSignatureEvent[] = [{ tick: 0, numerator: 4, denominator: 4 }];

  it("returns empty array when no time signatures", () => {
    expect(computeBeatSeconds([], tempo120, 480, 4)).toEqual([]);
  });

  it("at 120 BPM, beats are 0.5s apart", () => {
    const beats = computeBeatSeconds(ts4_4, tempo120, 480, 2);
    expect(beats[0]).toBeCloseTo(0);
    expect(beats[1]).toBeCloseTo(0.5);
    expect(beats[2]).toBeCloseTo(1.0);
    expect(beats[3]).toBeCloseTo(1.5);
  });

  it("has more beats than measures in 4/4", () => {
    const measures = computeMeasureSeconds(ts4_4, tempo120, 480, 8);
    const beats = computeBeatSeconds(ts4_4, tempo120, 480, 8);
    // Each measure has 4 beats; beats may include one extra due to boundary rounding
    expect(beats.length).toBeGreaterThanOrEqual(measures.length * 4 - 1);
    expect(beats.length).toBeLessThanOrEqual(measures.length * 4 + 1);
  });
});
