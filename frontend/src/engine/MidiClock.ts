import * as Tone from "tone";

export type TickCallback = (docSeconds: number) => void;

/**
 * MidiClock tracks position in "doc-time" (the song's native seconds, same
 * unit as NoteEvent.startSeconds). Playing at tempoMultiplier 0.5 means the
 * song advances at half speed relative to real time:
 *
 *   docSeconds = _startOffset + Transport.seconds * tempoMultiplier
 *
 * This keeps progress-bar / seek values always in doc-time (0..totalDuration).
 * Audio scheduling converts doc-time differences to real-time via / multiplier.
 */
export class MidiClock {
  private onTickCb: TickCallback | null = null;
  private _tempoMultiplier = 1.0;
  private _startOffset = 0; // doc-seconds we started / seeked from

  get tempoMultiplier() { return this._tempoMultiplier; }

  set tempoMultiplier(v: number) {
    const current = this.currentSeconds; // preserve position
    this._tempoMultiplier = Math.max(0.25, Math.min(2.0, v));
    // Recompute offset so currentSeconds stays the same after the change
    this._startOffset = current - Tone.getTransport().seconds * this._tempoMultiplier;
  }

  onTick(cb: TickCallback) { this.onTickCb = cb; }

  async start(offsetDocSeconds = 0) {
    await Tone.start();
    this._startOffset = offsetDocSeconds;
    Tone.getTransport().cancel();
    Tone.getTransport().seconds = 0;
    // BPM at 120, 16n fires every 0.125 real seconds. Fine for tight ticks.
    Tone.getTransport().bpm.value = 120;

    Tone.getTransport().scheduleRepeat(() => {
      this.onTickCb?.(this.currentSeconds);
    }, "16n");

    Tone.getTransport().start();
  }

  pause()  { Tone.getTransport().pause(); }
  resume() { Tone.getTransport().start(); }

  stop() {
    Tone.getTransport().stop();
    Tone.getTransport().cancel();
  }

  /**
   * Called after an external Tone.getTransport().cancel() to rebuild the
   * scheduleRepeat that drives onTick(). Must be called before resume().
   */
  reschedule(docSeconds: number) {
    this._startOffset = docSeconds;
    Tone.getTransport().seconds = 0;
    Tone.getTransport().scheduleRepeat(() => {
      this.onTickCb?.(this.currentSeconds);
    }, "16n");
  }

  seek(docSeconds: number) {
    this._startOffset = docSeconds;
    Tone.getTransport().seconds = 0;
  }

  get currentSeconds(): number {
    // Real Transport.seconds * tempo = how far we've advanced through the song
    return this._startOffset + Tone.getTransport().seconds * this._tempoMultiplier;
  }

  get state(): "started" | "stopped" | "paused" {
    return Tone.getTransport().state as "started" | "stopped" | "paused";
  }
}
