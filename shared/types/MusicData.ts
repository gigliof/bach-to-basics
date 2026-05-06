// ─── Core music data model ────────────────────────────────────────────────────
// All views (SheetMusic, PianoKeyboard, FallingNotes) are driven by these types.
// NoteEvent arrays are computed ONCE at import time and never mutated during playback.

export type Hand = "left" | "right" | "unknown";
export type Finger = 1 | 2 | 3 | 4 | 5;
export type SourceType = "midi" | "musicxml" | "guitarpro" | "mp3" | "youtube";
export type FingeringVersion = "auto" | "manual" | "none";
export type PlaybackStatus = "stopped" | "playing" | "paused" | "waiting";

export interface NoteEvent {
  id: string;
  /** MIDI note number 0-127 */
  midi: number;
  /** Human-readable pitch e.g. "C4", "F#5" */
  pitch: string;
  startTick: number;
  durationTick: number;
  /** Wall-clock start time at tempo multiplier 1.0 (seconds) */
  startSeconds: number;
  /** Wall-clock end time at tempo multiplier 1.0 (seconds) */
  endSeconds: number;
  hand: Hand;
  finger: Finger | null;
  /** MIDI velocity 0-127 */
  velocity: number;
  channel: number;
}

export interface TempoEvent {
  tick: number;
  bpm: number;
}

export interface TimeSignatureEvent {
  tick: number;
  numerator: number;
  denominator: number;
}

export interface KeySignature {
  /** Root note name: "C" | "G" | "D" | "A" | "E" | "B" | "F#" | "C#" | "F" | "Bb" | "Eb" | "Ab" | "Db" | "Gb" | "Cb" */
  key: string;
  scale: "major" | "minor";
}

export interface SustainRange {
  startSeconds: number;
  endSeconds: number;
}

export interface MusicDocument {
  id: string;
  title: string;
  sourceType: SourceType;
  /** MusicXML string - drives AlphaTab sheet music view */
  musicXml: string | null;
  /** Raw .mxl bytes (ZIP-compressed MusicXML) - present only for direct .mxl imports */
  mxlBuffer?: ArrayBuffer;
  /** Raw MIDI binary - drives Tone.js playback */
  midiBuffer: ArrayBuffer | null;
  /** Flat sorted array of all note events, pre-computed at import time */
  notes: NoteEvent[];
  tempoMap: TempoEvent[];
  timeSignatures: TimeSignatureEvent[];
  /** Total duration in seconds at tempo multiplier 1.0 */
  totalDuration: number;
  /** Ticks per quarter note (PPQ) */
  ppq: number;
  /** Key signature - null if not present in the source file */
  keySignature: KeySignature | null;
  /** YouTube video ID if source is YouTube */
  youtubeId: string | null;
  /** User-adjustable sync offset for YouTube (seconds) */
  youtubeSyncOffset: number;
  fingeringVersion: FingeringVersion;
  /** Sustain pedal (CC64) on/off ranges, pre-converted to seconds */
  sustainRanges?: SustainRange[];
}

export interface PlaybackState {
  status: PlaybackStatus;
  /** Current position in seconds (scaled by tempo multiplier) */
  currentSeconds: number;
  /** Tempo multiplier: 0.25 = 25%, 1.0 = 100%, 2.0 = 200% */
  tempoMultiplier: number;
  /** Loop start in seconds (tempo-scaled), null = no loop */
  loopStart: number | null;
  /** Loop end in seconds (tempo-scaled), null = no loop */
  loopEnd: number | null;
  /** Which hands are active for playback and wait-mode evaluation */
  activeHands: Set<Hand>;
  /** When true, transport pauses until user plays the expected note */
  waitMode: boolean;
}

// ─── Utility: key signature to display label ─────────────────────────────────
export function keySignatureToLabel(ks: KeySignature): string {
  return `${ks.key} ${ks.scale}`;
}

// ─── Utility: MIDI ticks to seconds using a tempo map ────────────────────────
function tickToSeconds(tick: number, tempoMap: TempoEvent[], ppq: number): number {
  let sec = 0;
  let prevTick = 0;
  for (let i = 0; i < tempoMap.length; i++) {
    const ev = tempoMap[i];
    if (ev.tick > tick) break;
    const next = tempoMap[i + 1];
    const endTick = (next && next.tick <= tick) ? next.tick : tick;
    sec += (endTick - prevTick) * (60 / (ev.bpm * ppq));
    prevTick = endTick;
    if (!next || next.tick > tick) break;
  }
  return sec;
}

// ─── Utility: compute measure start times in seconds ─────────────────────────
export function computeMeasureSeconds(
  timeSignatures: TimeSignatureEvent[],
  tempoMap: TempoEvent[],
  ppq: number,
  totalDuration: number,
): number[] {
  if (!timeSignatures.length || !tempoMap.length) return [];

  const measures: number[] = [];
  let measureTick = 0;
  let tsIdx = 0;

  while (true) {
    // Advance to the right time signature segment
    while (tsIdx + 1 < timeSignatures.length && timeSignatures[tsIdx + 1].tick <= measureTick) {
      tsIdx++;
    }
    const ts = timeSignatures[tsIdx];
    const ticksPerMeasure = Math.round(ppq * 4 * ts.numerator / ts.denominator);
    const sec = tickToSeconds(measureTick, tempoMap, ppq);
    if (sec > totalDuration + 1) break;
    measures.push(sec);
    measureTick += ticksPerMeasure;
    if (measures.length > 2000) break; // safety cap
  }

  return measures;
}

// ─── Utility: compute every beat start time in seconds ───────────────────────
export function computeBeatSeconds(
  timeSignatures: TimeSignatureEvent[],
  tempoMap: TempoEvent[],
  ppq: number,
  totalDuration: number,
): number[] {
  if (!timeSignatures.length || !tempoMap.length) return [];

  const beats: number[] = [];
  let beatTick = 0;
  let tsIdx = 0;

  while (true) {
    while (tsIdx + 1 < timeSignatures.length && timeSignatures[tsIdx + 1].tick <= beatTick) {
      tsIdx++;
    }
    const ts = timeSignatures[tsIdx];
    // One beat = one denominator unit relative to the quarter note
    const ticksPerBeat = Math.round(ppq * 4 / ts.denominator);
    const sec = tickToSeconds(beatTick, tempoMap, ppq);
    if (sec > totalDuration + 1) break;
    beats.push(sec);
    beatTick += ticksPerBeat;
    if (beats.length > 20000) break; // safety cap
  }

  return beats;
}

// ─── Utility: scale stored seconds by tempo multiplier ───────────────────────
export function scaleTime(storedSeconds: number, tempoMultiplier: number): number {
  return storedSeconds / tempoMultiplier;
}

// ─── Utility: MIDI note number to pitch string ────────────────────────────────
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES  = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

export function midiToPitch(midi: number, useFlats = false): string {
  const names = useFlats ? FLAT_NAMES : SHARP_NAMES;
  const octave = Math.floor(midi / 12) - 1;
  return `${names[midi % 12]}${octave}`;
}

export function midiToNoteName(midi: number, useFlats = false): string {
  const names = useFlats ? FLAT_NAMES : SHARP_NAMES;
  return names[midi % 12];
}

export function isBlackKey(midi: number): boolean {
  const mod = midi % 12;
  return [1, 3, 6, 8, 10].includes(mod);
}
