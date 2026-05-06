// ─── EventBus typed event map ─────────────────────────────────────────────────
// All inter-component communication flows through these events.
// Views subscribe; only SyncEngine emits (except input:note from MIDI/WebMidi).

import type { NoteEvent, PlaybackStatus } from "./MusicData";

export interface SyncEventMap {
  // ── Playback events ──────────────────────────────────────────────────────────

  /**
   * Emitted LOOKAHEAD_SECONDS before a note plays.
   * FallingNotes pre-renders the bar so it's ready when it enters the viewport.
   */
  "note:upcoming": NoteEvent;

  /**
   * Emitted at the exact moment a note begins playing.
   * PianoKeyboard highlights the key; Tone.js triggers the sample.
   */
  "note:on": NoteEvent;

  /**
   * Emitted at the exact moment a note stops playing.
   * PianoKeyboard un-highlights the key.
   */
  "note:off": NoteEvent;

  /**
   * Emitted every animation frame (~16ms) with the current playback position.
   * SheetMusicView drives the AlphaTab cursor; FallingNotesView moves bars.
   */
  "transport:tick": { seconds: number; tick: number };

  /**
   * Emitted when transport status changes (play/pause/stop/loop/waiting).
   */
  "transport:stateChange": { status: PlaybackStatus; seconds: number };

  // ── User input events ────────────────────────────────────────────────────────

  /**
   * Emitted when the user plays a note on the physical piano or virtual keyboard.
   * SyncEngine uses this for wait-mode comparison.
   * PianoKeyboard echoes the key highlight with a different color.
   */
  "input:note:on": { midi: number; velocity: number };

  /**
   * Emitted when the user releases a note.
   */
  "input:note:off": { midi: number };

  // ── Document events ──────────────────────────────────────────────────────────

  /**
   * Emitted when a new MusicDocument is loaded and all views should reset.
   */
  "document:loaded": { id: string; title: string; totalDuration: number };

  /**
   * Emitted when settings change that affect all views (e.g., toggle labels,
   * change hand colors, toggle fingering).
   */
  "settings:changed": { key: string; value: unknown };

  // ── Transport ────────────────────────────────────────────────────────────────

  /**
   * Emitted at the start of every seek/skip so UI can release pressed keys
   * before Tone cancels pending note:off callbacks.
   */
  "transport:seek": { seconds: number };

  // ── Practice features ────────────────────────────────────────────────────────

  /**
   * Emitted by SyncEngine when the speed trainer advances one step.
   * The store updates settings.speedTrainer.currentPct to keep UI in sync.
   */
  "speedTrainer:stepped": { currentPct: number };

  /**
   * Emitted by AccuracyTracker after each note event with running totals.
   */
  "accuracy:update": { correct: number; wrong: number; missed: number; score: number };
}

export type SyncEventName = keyof SyncEventMap;
export type SyncEventPayload<K extends SyncEventName> = SyncEventMap[K];
