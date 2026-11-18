import type { NoteEvent } from "@bach-to-basics/shared";

/**
 * Decide which hand each MIDI track belongs to.
 *
 * Only tracks that contain notes count: many Type-1 MIDI files start with a
 * tempo/meta track that has none, and indexing raw tracks used to label BOTH
 * hands "left" for such files.
 *
 * - 0-1 note tracks → "unknown" (one track can't tell hands apart)
 * - 2 note tracks   → the higher-pitched one is the right hand (some files
 *                     put the left hand first)
 * - 3+ note tracks  → first note track = right, the rest = left
 */
export function assignHandsToTracks(trackPitches: number[][]): NoteEvent["hand"][] {
  const noteTracks = trackPitches
    .map((pitches, idx) => ({ idx, pitches }))
    .filter((t) => t.pitches.length > 0);

  const hands: NoteEvent["hand"][] = trackPitches.map(() => "unknown");
  if (noteTracks.length < 2) return hands;

  if (noteTracks.length === 2) {
    const avg = (p: number[]) => p.reduce((s, m) => s + m, 0) / p.length;
    const [a, b] = noteTracks;
    const aIsRight = avg(a.pitches) >= avg(b.pitches);
    hands[a.idx] = aIsRight ? "right" : "left";
    hands[b.idx] = aIsRight ? "left" : "right";
    return hands;
  }

  noteTracks.forEach((t, i) => (hands[t.idx] = i === 0 ? "right" : "left"));
  return hands;
}
