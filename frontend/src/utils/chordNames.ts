/**
 * Chord names for the sheet music view, detected from the notes.
 *
 * Deliberately conservative: a name is given only where 3 or more notes are
 * struck at the same moment, and only when the sounding pitches EXACTLY match
 * a known chord shape. Anything else (broken chords, passing notes, unusual
 * voicings) gets no name, because a wrong chord name misleads a learner more
 * than a missing one.
 */

const SHARPS = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLATS = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

/** Chord shapes as semitones above the root, in order of preference. */
const SHAPES: [suffix: string, intervals: number[]][] = [
  ["", [0, 4, 7]],
  ["m", [0, 3, 7]],
  ["dim", [0, 3, 6]],
  ["aug", [0, 4, 8]],
  ["sus4", [0, 5, 7]],
  ["sus2", [0, 2, 7]],
  ["7", [0, 4, 7, 10]],
  ["maj7", [0, 4, 7, 11]],
  ["m7", [0, 3, 7, 10]],
  ["m7♭5", [0, 3, 6, 10]],
  ["dim7", [0, 3, 6, 9]],
  ["mMaj7", [0, 3, 7, 11]],
  ["6", [0, 4, 7, 9]],
  ["m6", [0, 3, 7, 9]],
  ["add9", [0, 2, 4, 7]],
  ["m(add9)", [0, 2, 3, 7]],
  ["7sus4", [0, 5, 7, 10]],
  ["9", [0, 2, 4, 7, 10]],
  ["maj9", [0, 2, 4, 7, 11]],
  ["m9", [0, 2, 3, 7, 10]],
  // Sevenths with the fifth left out, as pianists often voice them
  ["7", [0, 4, 10]],
  ["maj7", [0, 4, 11]],
  ["m7", [0, 3, 10]],
];

const key = (a: number[]) => a.join(",");
const SHAPE_INDEX = new Map(SHAPES.map(([suffix, iv], i) => [key(iv), { suffix, rank: i }]));

/**
 * Name the chord formed by these pitches, or null if they don't form a known
 * chord. `midis` are all notes sounding at the moment (any octave, duplicates
 * allowed); the lowest one is the bass, shown after a slash when it isn't the
 * root (C/E).
 */
export function chordName(midis: number[], preferFlats: boolean): string | null {
  if (midis.length === 0) return null;
  const pcs = [...new Set(midis.map((m) => ((m % 12) + 12) % 12))];
  if (pcs.length < 3) return null;
  const bass = ((Math.min(...midis) % 12) + 12) % 12;

  let best: { root: number; suffix: string; rank: number } | null = null;
  for (const root of pcs) {
    const shape = SHAPE_INDEX.get(key(pcs.map((p) => (p - root + 12) % 12).sort((a, b) => a - b)));
    if (!shape) continue;
    // Prefer the reading whose root is in the bass (C6 over Am7/C), then the simpler shape
    const better =
      !best ||
      (root === bass && best.root !== bass) ||
      ((root === bass) === (best.root === bass) && shape.rank < best.rank);
    if (better) best = { root, ...shape };
  }
  if (!best) return null;
  const names = preferFlats ? FLATS : SHARPS;
  const name = names[best.root] + best.suffix;
  return best.root === bass ? name : `${name}/${names[bass]}`;
}

/** A note as placed on the sheet, with its timing (alphaTab ticks). */
export interface TimedNote {
  midi: number;
  start: number;
  end: number;
  /** A tied continuation: sounding, but not struck again */
  tied: boolean;
  /** Key signature of the bar (sharps > 0, flats < 0), for spelling the chord */
  keySignature: number;
}

/** One moment where a chord was struck, with the notes that sound then. */
export interface ChordMoment {
  start: number;
  name: string;
}

/**
 * Find the chords in a passage: at every moment where 3+ notes are struck
 * together, name the notes sounding then (struck ones plus ones still held).
 * Only changes are kept, like a lead sheet: a repeated chord isn't renamed.
 */
export function detectChords(notes: TimedNote[], useFlats: boolean): ChordMoment[] {
  // One pass in time order, keeping the notes that are still sounding
  const byStart = [...notes].sort((a, b) => a.start - b.start);
  const starts = [...new Set(byStart.filter((n) => !n.tied).map((n) => n.start))];
  const out: ChordMoment[] = [];
  let active: TimedNote[] = [];
  let next = 0;
  let last: string | null = null;
  for (const t of starts) {
    while (next < byStart.length && byStart[next].start <= t) active.push(byStart[next++]);
    active = active.filter((n) => n.end > t);
    const struck = active.filter((n) => !n.tied && n.start === t);
    if (struck.length < 3) continue;
    // Spell like the note names: the key signature decides, the app setting only in C
    const ks = struck[0].keySignature;
    const name = chordName(
      active.map((n) => n.midi),
      ks !== 0 ? ks < 0 : useFlats
    );
    if (name && name !== last) out.push({ start: t, name });
    if (name) last = name;
  }
  return out;
}

/**
 * Lay out labels left to right on each line (same y) so none overlaps the one
 * before it: a crowded label moves right just enough to clear its neighbour.
 */
export function spreadLabels<T extends { x: number; y: number; width: number }>(
  items: T[],
  gap: number
): T[] {
  const lastRight = new Map<number, number>();
  return [...items]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((it) => {
      const prev = lastRight.get(it.y);
      const x = prev === undefined ? it.x : Math.max(it.x, prev + gap);
      lastRight.set(it.y, x + it.width);
      return { ...it, x };
    });
}
