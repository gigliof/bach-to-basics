/**
 * Note-name labels for the sheet music view.
 *
 * Pure helpers: which notes get a label (same rules as the piano and falling
 * notes: all / white keys / black keys / C only) and how each is spelled.
 * Spelling follows the score, not the app-wide sharps/flats preference:
 * an accidental written on the note wins, then the key signature, and only
 * in C major / A minor with no written accidental does the preference decide.
 */
import { isBlackKey } from "@bach-to-basics/shared";
import type { NoteLabelMode } from "../store/useAppStore";

const SHARPS = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLATS = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

/** alphaTab's NoteAccidentalMode values (only the ones that decide spelling). */
export const ACCIDENTAL = {
  ForceSharp: 3,
  ForceDoubleSharp: 4,
  ForceFlat: 5,
  ForceDoubleFlat: 6,
} as const;

export interface SheetNote {
  /** Sounding MIDI pitch */
  midi: number;
  /** alphaTab NoteAccidentalMode (0 = default) */
  accidentalMode: number;
  /** Key signature of the bar: sharps > 0, flats < 0 */
  keySignature: number;
}

function preferFlats(n: SheetNote, useFlats: boolean): boolean {
  if (n.accidentalMode === ACCIDENTAL.ForceFlat || n.accidentalMode === ACCIDENTAL.ForceDoubleFlat)
    return true;
  if (
    n.accidentalMode === ACCIDENTAL.ForceSharp ||
    n.accidentalMode === ACCIDENTAL.ForceDoubleSharp
  )
    return false;
  if (n.keySignature !== 0) return n.keySignature < 0;
  return useFlats;
}

/** The label for one note, or "" when the mode hides it. */
export function sheetNoteLabel(n: SheetNote, mode: NoteLabelMode, useFlats: boolean): string {
  if (mode === "none") return "";
  const black = isBlackKey(n.midi);
  if (mode === "white" && black) return "";
  if (mode === "black" && !black) return "";
  if (mode === "c_only" && n.midi % 12 !== 0) return "";
  const name = (preferFlats(n, useFlats) ? FLATS : SHARPS)[n.midi % 12];
  return mode === "c_only" ? `${name}${Math.floor(n.midi / 12) - 1}` : name;
}

/** Black or white text, whichever reads better on `hex` (#rrggbb). */
export function textColorOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#fff";
  const v = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(v >> 16) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
  // Contrast with black vs white; pick the higher
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? "#111" : "#fff";
}

/** One notehead as laid out by alphaTab, in the score container's pixel space. */
export interface SheetNoteBox extends SheetNote {
  x: number;
  y: number;
  w: number;
  h: number;
  hand: "left" | "right" | "unknown";
  /** Half or whole note (open notehead): drawn as a ring so rhythm stays readable */
  open: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- alphaTab's model types aren't exported in a usable form */
/** Read every notehead position from alphaTab's bounds lookup (needs core.includeNoteBounds). */
export function collectNoteBoxes(lookup: any): SheetNoteBox[] {
  const boxes: SheetNoteBox[] = [];
  for (const system of lookup?.staffSystems ?? []) {
    for (const masterBar of system.bars ?? []) {
      for (const barBounds of masterBar.bars ?? []) {
        const bar = barBounds.bar;
        const staff = bar?.staff;
        const track = staff?.track;
        const hand: SheetNoteBox["hand"] =
          (track?.staves?.length ?? 0) >= 2
            ? staff.index === 0
              ? "right"
              : "left"
            : (track?.score?.tracks?.length ?? 0) >= 2
              ? track.index === 0
                ? "right"
                : "left"
              : "unknown";
        const keySignature = Number(bar?.masterBar?.keySignature ?? 0);
        for (const beatBounds of barBounds.beats ?? []) {
          for (const nb of beatBounds.notes ?? []) {
            const note = nb?.note;
            const head = nb?.noteHeadBounds;
            if (!note || !head || note.isPercussion || note.isTieDestination) continue;
            boxes.push({
              x: head.x,
              y: head.y,
              w: head.w,
              h: head.h,
              midi: note.realValue,
              accidentalMode: Number(note.accidentalMode ?? 0),
              keySignature,
              hand,
              open: Number(beatBounds.beat?.duration ?? 4) <= 2,
            });
          }
        }
      }
    }
  }
  return boxes;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Where chord names go: one anchor per moment (alphaTab ticks), above its line of music. */
export interface ChordLayout {
  notes: import("./chordNames").TimedNote[];
  /** x of the beat, y of the top of its line of music; rank = which staff it came from */
  anchors: Map<number, { x: number; y: number; rank: number }>;
  /** The file has its own chord symbols (alphaTab draws those): don't detect */
  fileHasChords: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- alphaTab model types */
export function collectChordLayout(lookup: any): ChordLayout {
  const notes: ChordLayout["notes"] = [];
  const anchors: ChordLayout["anchors"] = new Map();
  let fileHasChords = false;
  for (const system of lookup?.staffSystems ?? []) {
    const top = Number(system.realBounds?.y ?? system.visualBounds?.y ?? 0);
    for (const masterBar of system.bars ?? []) {
      for (const barBounds of masterBar.bars ?? []) {
        const bar = barBounds.bar;
        const keySignature = Number(bar?.masterBar?.keySignature ?? 0);
        const staffIndex = Number(bar?.staff?.index ?? 0);
        const trackIndex = Number(bar?.staff?.track?.index ?? 0);
        for (const beatBounds of barBounds.beats ?? []) {
          const beat = beatBounds.beat;
          if (!beat) continue;
          if (beat.hasChord) fileHasChords = true;
          const duration = Number(beat.playbackDuration ?? 0);
          if (!beat.notes?.length || duration <= 0) continue; // rests, grace notes
          const start = Number(beat.absolutePlaybackStart ?? 0);
          for (const note of beat.notes) {
            if (note.isPercussion) continue;
            notes.push({
              midi: note.realValue,
              start,
              end: start + duration,
              tied: !!note.isTieDestination,
              keySignature,
            });
          }
          // Anchor on the top staff when there is one at this moment
          const prev = anchors.get(start);
          const rank = trackIndex * 10 + staffIndex;
          if (!prev || rank < prev.rank) {
            const x = Number(beatBounds.onNotesX ?? beatBounds.realBounds?.x ?? 0);
            anchors.set(start, { x, y: top, rank });
          }
        }
      }
    }
  }
  return { notes, anchors, fileHasChords };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
