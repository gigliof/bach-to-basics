import type { NoteEvent } from "@bach-to-basics/shared";

// ── Instrument catalogue ──────────────────────────────────────────────────────

export type InstrumentId =
  | "grand" // Splendid Grand Piano (SplendidGrandPiano)
  | "bright" // Bright Acoustic Piano (Soundfont)
  | "electric" // CP80 Electric Grand (ElectricPiano)
  | "harpsichord" // Harpsichord (Soundfont)
  | "honkytonk"; // Honky-Tonk Piano (Soundfont)

export const INSTRUMENT_LABELS: Record<InstrumentId, string> = {
  grand: "Grand",
  bright: "Bright",
  electric: "E-Piano",
  harpsichord: "Harpsi",
  honkytonk: "Honky",
};

// Minimal common interface shared by all smplr players. Exported so the
// MP3 export pipeline can type the offline-rendering player the same way.
export type Player = {
  load: Promise<unknown>;
  /** `time` (seconds, relative to ctx.currentTime) + `duration` enable
   *  offline batch rendering - if omitted, the note plays immediately. */
  start(opts: {
    note: number;
    velocity?: number;
    stopId?: number | string;
    time?: number;
    duration?: number;
  }): unknown;
  stop(opts?: { stopId?: number | string }): void;
};

/**
 * Build a smplr player for the given instrument against any AudioContext-like.
 *
 * smplr is imported DYNAMICALLY here (not at module top level) so it lands in
 * its own lazy chunk instead of the main bundle. The piano keyboard (PixiJS),
 * falling notes, and sheet music don't need smplr to render, so keeping it out
 * of the critical path lets the first paint happen much sooner. smplr only
 * loads on the first audio interaction (pre-warm on mount, or first note).
 *
 * Accepts `BaseAudioContext` (the common parent of both AudioContext and
 * OfflineAudioContext) so callers can pass an offline context for batch
 * rendering. The smplr classes accept either.
 */
export async function createPlayer(id: InstrumentId, ctx: BaseAudioContext): Promise<Player> {
  const { SplendidGrandPiano, Soundfont, ElectricPiano } = await import("smplr");
  switch (id) {
    case "grand":
      return new SplendidGrandPiano(ctx as AudioContext) as unknown as Player;
    case "bright":
      return new Soundfont(ctx as AudioContext, {
        instrument: "bright_acoustic_piano",
      }) as unknown as Player;
    case "electric":
      return new ElectricPiano(ctx as AudioContext, { instrument: "CP80" }) as unknown as Player;
    case "harpsichord":
      return new Soundfont(ctx as AudioContext, { instrument: "harpsichord" }) as unknown as Player;
    case "honkytonk":
      return new Soundfont(ctx as AudioContext, {
        instrument: "honkytonk_piano",
      }) as unknown as Player;
  }
}

// ── AudioEngine ───────────────────────────────────────────────────────────────

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private player: Player | null = null;
  private _currentId: InstrumentId = "grand";
  private _loaded = false;
  // Dedup: all callers await the same promise so we never create two AudioContexts
  private _loadPromise: Promise<void> | null = null;

  async load() {
    if (this._loaded) return;
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = (async () => {
      try {
        if (!this.ctx) this.ctx = new AudioContext();
        this.player = await createPlayer(this._currentId, this.ctx);
        await this.player.load;
        this._loaded = true;
      } catch (err) {
        // Reset the cached promise so the next call can retry. Without this,
        // a one-time failure (CDN hiccup, blocked sample fetch, etc.) would
        // leave _loaded=false and ALL audio permanently silent.
        this._loadPromise = null;
        this.player = null;
        console.error("AudioEngine.load failed:", err);
        throw err;
      }
    })();
    return this._loadPromise;
  }

  /**
   * Switch to a different instrument. If the AudioContext already exists the
   * new instrument is pre-loaded immediately so the next note plays without delay.
   */
  async setInstrument(id: InstrumentId): Promise<void> {
    if (id === this._currentId && this._loaded) return;
    this._currentId = id;
    this._loaded = false;
    this._loadPromise = null;
    // Silence any ongoing audio before swapping the player
    try {
      this.player?.stop?.();
    } catch {
      /* ignore */
    }
    this.player = null;
    // Pre-load the new instrument if an AudioContext already exists
    if (this.ctx) await this.load();
  }

  get loaded() {
    return this._loaded;
  }

  /**
   * Resume the AudioContext after a user gesture. Safe to call repeatedly.
   *
   * Browsers' autoplay policy keeps a freshly-created AudioContext in
   * "suspended" state until a real user gesture. Our `load()` is invoked on
   * mount (before any gesture) so the context exists but produces no sound
   * until this is called from a click/keydown handler.
   */
  async wake() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        /* ignore */
      }
    }
  }

  playNote(note: NoteEvent) {
    if (!this.player || !this._loaded) return;
    // Resume in case the AudioContext was created before a user gesture (browser
    // autoplay policy starts it suspended). Fire-and-forget, resolves quickly.
    this.ctx?.resume();
    this.player.start({ note: note.midi, velocity: note.velocity, stopId: note.midi });
  }

  /** Play a single MIDI note by number - for virtual keyboard clicks. */
  playMidi(midi: number, velocity = 90) {
    if (!this.player || !this._loaded) return;
    // Resume in case the AudioContext was created before a user gesture.
    this.ctx?.resume();
    this.player.start({ note: midi, velocity, stopId: midi });
  }

  stopNote(midi: number) {
    if (!this.player || !this._loaded) return;
    this.player.stop({ stopId: midi });
  }

  stopAll() {
    try {
      this.player?.stop?.();
    } catch {
      /* ignore */
    }
  }
}
