import type { Finger, NoteEvent } from "@bach-to-basics/shared";

/** One sounding note read from annotated MusicXML, in document order. */
export interface FingeringMark {
  hand: "left" | "right";
  midi: number;
  finger: Finger | null;
}

/**
 * Hand used to match a note against MusicXML staves. Notes from single-track
 * MIDI have hand "unknown"; the backend splits those onto staves at middle C
 * (see _apply_piano_split in music21_svc.py), so mirror that split here.
 */
export function staffHandFor(note: NoteEvent): "left" | "right" {
  if (note.hand !== "unknown") return note.hand;
  return note.midi >= 60 ? "right" : "left";
}

/**
 * Copy fingerings from MusicXML marks onto the playback notes.
 *
 * Matching is per (hand, pitch) in order of appearance, so chord-note order
 * differences between the XML and the MIDI can't shift fingers onto the wrong
 * key. Notes without a matching mark keep finger: null.
 */
export function applyFingeringMarks(notes: NoteEvent[], marks: FingeringMark[]): NoteEvent[] {
  const queues = new Map<string, (Finger | null)[]>();
  for (const m of marks) {
    const key = `${m.hand}:${m.midi}`;
    const q = queues.get(key);
    if (q) q.push(m.finger);
    else queues.set(key, [m.finger]);
  }
  return notes.map((note) => {
    const q = queues.get(`${staffHandFor(note)}:${note.midi}`);
    if (!q || q.length === 0) return { ...note };
    return { ...note, finger: q.shift() ?? null };
  });
}
