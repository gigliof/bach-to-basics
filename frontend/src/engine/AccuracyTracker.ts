/**
 * AccuracyTracker - real-time scoring of user input vs. expected notes.
 *
 * Strategy:
 *   - When a note:on fires, record it in a "window" of expected notes.
 *   - When the user plays (input:note:on), check if any expected note in the
 *     ±HIT_WINDOW_MS tolerance matches the MIDI number. If yes: correct hit.
 *   - When a note's off-time passes without a matching input: missed.
 *   - If the user plays a MIDI that doesn't match any expected note: wrong.
 *
 * Emits bus event "accuracy:update" with running totals after every event.
 */

import bus from "./EventBus";
import type { NoteEvent } from "@bach-to-basics/shared";

/** How many milliseconds before/after note start counts as a "hit" */
const HIT_WINDOW_MS = 300;

interface PendingNote {
  note: NoteEvent;
  startMs: number;  // performance.now() when note:on fired
  hit: boolean;
}

class AccuracyTracker {
  private enabled = false;
  private pending: PendingNote[] = [];

  private correct = 0;
  private wrong   = 0;
  private missed  = 0;

  constructor() {
    bus.on("note:on", (note) => this.onNoteOn(note as NoteEvent));
    bus.on("note:off", (note) => this.onNoteOff(note as NoteEvent));
    bus.on("input:note:on", ({ midi }) => this.onInput(midi));
    bus.on("transport:stateChange", ({ status }) => {
      if (status === "stopped") this.reset();
    });
    bus.on("transport:seek", () => {
      // Clear pending notes on seek - they're no longer relevant
      this.pending = [];
    });
  }

  enable(on: boolean) {
    this.enabled = on;
    if (!on) this.reset();
  }

  reset() {
    this.pending = [];
    this.correct = 0;
    this.wrong   = 0;
    this.missed  = 0;
    this.emit();
  }

  get score(): number {
    const total = this.correct + this.wrong + this.missed;
    return total === 0 ? 0 : Math.round((this.correct / total) * 100);
  }

  private onNoteOn(note: NoteEvent) {
    if (!this.enabled) return;
    this.pending.push({ note, startMs: performance.now(), hit: false });
  }

  private onNoteOff(note: NoteEvent) {
    if (!this.enabled) return;
    const idx = this.pending.findIndex((p) => p.note.id === note.id);
    if (idx === -1) return;
    const [pending] = this.pending.splice(idx, 1);
    if (!pending.hit) {
      this.missed++;
      this.emit();
    }
  }

  private onInput(midi: number) {
    if (!this.enabled) return;
    const now = performance.now();

    // Find the closest pending note matching this MIDI within the hit window
    let bestIdx = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < this.pending.length; i++) {
      const p = this.pending[i];
      if (p.hit) continue;
      if (p.note.midi !== midi) continue;
      const delta = Math.abs(now - p.startMs);
      if (delta <= HIT_WINDOW_MS && delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      this.pending[bestIdx].hit = true;
      this.correct++;
    } else {
      this.wrong++;
    }
    this.emit();
  }

  private emit() {
    bus.emit("accuracy:update", {
      correct: this.correct,
      wrong:   this.wrong,
      missed:  this.missed,
      score:   this.score,
    });
  }
}

export const accuracyTracker = new AccuracyTracker();
export default accuracyTracker;
