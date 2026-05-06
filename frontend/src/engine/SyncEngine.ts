import * as Tone from "tone";
import bus from "./EventBus";
import { MidiClock } from "./MidiClock";
import { AudioEngine } from "./AudioEngine";
import type { InstrumentId } from "./AudioEngine";
import type { MusicDocument, NoteEvent, PlaybackStatus } from "@bach-to-basics/shared";

interface YTPlayer {
  getCurrentTime(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
}

interface SpeedTrainerOpts {
  enabled:    boolean;
  startPct:   number;
  endPct:     number;
  stepPct:    number;
  currentPct: number;
}

// How many doc-seconds ahead to emit "note:upcoming" for FallingNotes pre-rendering.
const LOOKAHEAD_DOC_SECONDS = 5.0;
const YT_DRIFT_THRESHOLD = 0.25;

export interface SyncEngineState {
  status: PlaybackStatus;
  currentSeconds: number;
  tempoMultiplier: number;
  loopStart: number | null;
  loopEnd: number | null;
  waitMode: boolean;
  activeHands: Set<"left" | "right">;
  metronomeEnabled: boolean;
  handVolume: { left: number; right: number };
  /** Which hand(s) trigger wait-mode pauses. Only relevant when waitMode is on. */
  waitForHand: "left" | "right" | "both";
}

class SyncEngine {
  private clock = new MidiClock();
  readonly audio = new AudioEngine();

  private doc: MusicDocument | null = null;
  private noteIndex = 0;
  private activeNotes = new Set<string>();

  private _state: SyncEngineState = {
    status: "stopped",
    currentSeconds: 0,
    tempoMultiplier: 1.0,
    loopStart: null,
    loopEnd: null,
    waitMode: false,
    activeHands: new Set(["left", "right"]),
    metronomeEnabled: false,
    handVolume: { left: 1, right: 1 },
    waitForHand: "both",
  };

  private ytPlayer: YTPlayer | null = null;
  private animFrameId: number | null = null;
  private stateListeners = new Set<(s: SyncEngineState) => void>();

  // Metronome
  private metronome: Tone.Synth | null = null;
  private lastBeatCrossed = -1;

  // ── Virtual keyboard pending-play tracking ──────────────────────────────────
  // Tracks MIDI notes that are awaiting audio-load before playing.
  // If the user releases a key before the load completes, the entry is removed
  // so the note never fires - preventing stuck/echoing notes.
  private pendingMidiPlays = new Set<number>();

  // ── Practice features ───────────────────────────────────────────────────────
  private renderOffsetMs = 0;
  private transposeSemitones = 0;
  private countInBars: 0 | 1 | 2 = 0;
  private countInTimeouts: ReturnType<typeof setTimeout>[] = [];
  private speedTrainer: SpeedTrainerOpts = {
    enabled: false, startPct: 60, endPct: 100, stepPct: 5, currentPct: 60,
  };

  constructor() {
    this.clock.onTick(this.onTick.bind(this));
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async loadDocument(doc: MusicDocument) {
    this.stop();
    this.doc = doc;
    this.noteIndex = 0;
    this.activeNotes.clear();
    this._state.currentSeconds = 0;
    bus.emit("document:loaded", { id: doc.id, title: doc.title, totalDuration: doc.totalDuration });
    this.emitState("stopped");
  }

  async play(fromSeconds?: number) {
    if (!this.doc) return;
    await this.audio.load();

    const startFrom = fromSeconds ?? this._state.currentSeconds;

    // Speed trainer: reset currentPct when starting from the very beginning
    if (this.speedTrainer.enabled && startFrom === 0) {
      this.speedTrainer.currentPct = this.speedTrainer.startPct;
      this._state.tempoMultiplier = this.speedTrainer.startPct / 100;
      this.clock.tempoMultiplier = this._state.tempoMultiplier;
      bus.emit("speedTrainer:stepped", { currentPct: this.speedTrainer.startPct });
    }

    if (this.countInBars > 0) {
      await this._playWithCountIn(startFrom);
    } else {
      this.seekTo(startFrom);
      await this.clock.start(startFrom);
      this.startAnimLoop();
      this.emitState("playing");
    }
  }

  private async _playWithCountIn(startFrom: number) {
    const bpm = this.doc!.tempoMap[0]?.bpm ?? 120;
    const timeSig = this.doc!.timeSignatures[0] ?? { numerator: 4, denominator: 4 };
    const beatsPerBar = timeSig.numerator;
    // Beat duration respects current tempo multiplier so count-in matches playback speed
    const beatDurMs = (60 / bpm) / this._state.tempoMultiplier * 1000;
    const totalBeats = this.countInBars * beatsPerBar;

    // Ensure metronome synth exists
    if (!this.metronome) {
      this.metronome = new Tone.Synth({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.02 },
        volume: -8,
      }).toDestination();
    }

    this.emitState("playing"); // Show as playing during count-in

    // Schedule one click per beat
    for (let b = 0; b < totalBeats; b++) {
      const isAccent = b % beatsPerBar === 0;
      const id = setTimeout(() => {
        try { this.metronome!.triggerAttackRelease(isAccent ? "C6" : "G5", "32n"); }
        catch { /* AudioContext not ready */ }
      }, b * beatDurMs);
      this.countInTimeouts.push(id);
    }

    // After count-in, start actual playback
    const startId = setTimeout(async () => {
      this.countInTimeouts = [];
      this.seekTo(startFrom);
      await this.clock.start(startFrom);
      this.startAnimLoop();
      // status stays "playing"
    }, totalBeats * beatDurMs);
    this.countInTimeouts.push(startId);
  }

  private _cancelCountIn() {
    for (const id of this.countInTimeouts) clearTimeout(id);
    this.countInTimeouts = [];
  }

  pause() {
    this._cancelCountIn();
    this.clock.pause();
    this.stopAnimLoop();
    this.emitState("paused");
  }

  stop() {
    this._cancelCountIn();
    this.clock.stop();
    this.audio.stopAll();
    this.stopAnimLoop();
    this.noteIndex = 0;
    this.activeNotes.clear();
    this._state.currentSeconds = 0;
    this.lastBeatCrossed = -1;
    this.emitState("stopped");
    bus.emit("transport:tick", { seconds: 0, tick: 0 });
  }

  seek(seconds: number) {
    const wasPlaying = this._state.status === "playing" || this._state.status === "waiting";
    if (wasPlaying) this.clock.pause();

    // Tell the UI to release all visually-pressed keys before we cancel Tone events.
    // Without this, any note whose note:on fired but note:off was still scheduled
    // (and then cancelled below) leaves the key stuck in a pressed state.
    bus.emit("transport:seek", { seconds });

    // Cancel pending Tone events so notes don't fire from the old position
    Tone.getTransport().cancel();

    this.seekTo(seconds);
    this.audio.stopAll();
    bus.emit("transport:tick", { seconds, tick: 0 });

    if (wasPlaying) {
      // cancel() above killed the scheduleRepeat - rebuild it before resuming
      this.clock.reschedule(seconds);
      this.clock.resume();
      this._state.status = "playing";
    }
    this.emitState(this._state.status);
  }

  skipBy(delta: number) {
    const total = this.doc?.totalDuration ?? 0;
    const next = Math.max(0, Math.min(total, this._state.currentSeconds + delta));
    this.seek(next);
  }

  setTempoMultiplier(v: number) {
    const clamped = Math.max(0.25, Math.min(2.0, v));
    this._state.tempoMultiplier = clamped;
    // Update clock rate - its setter recalculates _startOffset so currentSeconds
    // stays the same despite the new multiplier.
    this.clock.tempoMultiplier = clamped;

    // If playing, all Tone.js note:on/note:off callbacks were scheduled at the
    // OLD tempo rate and will now fire at the wrong wall-clock time.
    // Solution: same as seek() - cancel pending Tone events, reset the note
    // cursor, and reschedule everything at the new rate from the current position.
    const isActive = this._state.status === "playing" || this._state.status === "waiting";
    if (isActive) {
      const currentSec = this._state.currentSeconds;
      this.clock.pause();
      bus.emit("transport:seek", { seconds: currentSec }); // release pressed keys
      Tone.getTransport().cancel();
      this.audio.stopAll();
      this.seekTo(currentSec); // resets noteIndex + activeNotes
      this.clock.reschedule(currentSec);
      this.clock.resume();
      this._state.status = "playing";
    }

    this.emitState(this._state.status);
  }

  setLoopPoints(start: number | null, end: number | null) {
    this._state.loopStart = start;
    this._state.loopEnd = end;
    this.emitState(this._state.status);
  }

  setWaitMode(on: boolean) {
    this._state.waitMode = on;
    this.emitState(this._state.status);
  }

  setMetronome(on: boolean) {
    this._state.metronomeEnabled = on;
    if (on && !this.metronome) {
      // Lazy-create the synth so AudioContext is already started
      this.metronome = new Tone.Synth({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.02 },
        volume: -8,
      }).toDestination();
    }
    if (!on) this.lastBeatCrossed = -1;
    this.emitState(this._state.status);
  }

  setActiveHands(hands: Set<"left" | "right">) {
    this._state.activeHands = hands;
    this.emitState(this._state.status);
  }

  setHandVolume(vol: { left: number; right: number }) {
    this._state.handVolume = { left: Math.max(0, Math.min(1, vol.left)), right: Math.max(0, Math.min(1, vol.right)) };
  }

  setWaitForHand(hand: "left" | "right" | "both") {
    this._state.waitForHand = hand;
  }

  async setInstrument(id: InstrumentId): Promise<void> {
    await this.audio.setInstrument(id);
  }

  setYouTubePlayer(player: YTPlayer | null) { this.ytPlayer = player; }

  // ── Practice feature setters ────────────────────────────────────────────────

  setTranspose(semitones: number) {
    this.transposeSemitones = Math.round(Math.max(-12, Math.min(12, semitones)));
  }

  setCountInBars(n: 0 | 1 | 2) {
    this.countInBars = n;
  }

  setSpeedTrainer(opts: SpeedTrainerOpts) {
    this.speedTrainer = { ...opts };
  }

  setRenderOffset(ms: number) {
    this.renderOffsetMs = Math.max(-200, Math.min(200, ms));
  }

  // ── MIDI input ──────────────────────────────────────────────────────────────

  /** Called by WebMidi.js, virtual keyboard click, etc. */
  onMidiInput(midi: number, velocity: number) {
    bus.emit("input:note:on", { midi, velocity });

    if (this._state.status === "waiting") {
      const expected = this.waitingNote();
      if (expected && midi === expected.midi) {
        this._state.status = "playing";
        this.clock.resume();
        this.emitState("playing");
      }
    }
  }

  /** Play a note through the audio engine immediately (for virtual keyboard clicks). */
  async playMidi(midi: number, velocity = 90) {
    // Emit input:note:on synchronously so the key lights up with no delay.
    this.onMidiInput(midi, velocity);
    // Register this MIDI as pending. If stopMidi() fires before audio loads
    // (user tapped quickly), the entry is removed and we skip the play call -
    // preventing the "echo" where a note sustains after the key was released.
    this.pendingMidiPlays.add(midi);
    await this.audio.load();
    if (this.pendingMidiPlays.has(midi)) {
      this.pendingMidiPlays.delete(midi);
      this.audio.playMidi(midi, velocity);
    }
  }

  stopMidi(midi: number) {
    this.pendingMidiPlays.delete(midi); // cancel play if still loading
    this.audio.stopNote(midi);
    this.onMidiInputOff(midi);
  }

  onMidiInputOff(midi: number) {
    bus.emit("input:note:off", { midi });
  }

  onStateChange(cb: (s: SyncEngineState) => void) {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  get state(): Readonly<SyncEngineState> { return this._state; }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * seekTo positions the note-cursor for doc-time `seconds`.
   * All note.startSeconds are in doc-time (same unit as currentSeconds).
   */
  private seekTo(seconds: number) {
    if (!this.doc) return;
    this._state.currentSeconds = seconds;
    this.noteIndex = this.doc.notes.findIndex((n) => n.startSeconds >= seconds);
    if (this.noteIndex === -1) this.noteIndex = this.doc.notes.length;
    this.activeNotes.clear();
    // Reset metronome so the first beat at new position doesn't double-fire
    const bpm = this.doc.tempoMap[0]?.bpm ?? 120;
    this.lastBeatCrossed = Math.floor(seconds / (60 / bpm));
  }

  private waitingNote(): NoteEvent | null {
    if (!this.doc || this.noteIndex >= this.doc.notes.length) return null;
    const note = this.doc.notes[this.noteIndex];
    const { activeHands, waitForHand } = this._state;
    if (note.hand !== "unknown" && !activeHands.has(note.hand as "left" | "right")) return null;
    // When waitForHand restricts to one hand, ignore notes from the other hand
    if (waitForHand !== "both" && note.hand !== "unknown" && note.hand !== waitForHand) return null;
    return note;
  }

  /**
   * Applies transposition to a note, clamping to the 88-key range (A0-C8).
   * Returns the original note object unchanged if transposeSemitones is 0.
   */
  private transposeNote(note: NoteEvent): NoteEvent {
    if (this.transposeSemitones === 0) return note;
    const tMidi = Math.max(21, Math.min(108, note.midi + this.transposeSemitones));
    return { ...note, midi: tMidi };
  }

  /**
   * Called by MidiClock every ~125ms.
   * `docSeconds` is in doc-time (same unit as note.startSeconds).
   *
   * To schedule Tone.js events in real-time:
   *   realDelay = docTimeDiff / tempoMultiplier
   */
  private onTick(docSeconds: number) {
    if (!this.doc) return;
    this._state.currentSeconds = docSeconds;

    // ── Metronome ─────────────────────────────────────────────────────────────
    if (this._state.metronomeEnabled && this.doc && this.metronome) {
      const bpm = this.doc.tempoMap[0]?.bpm ?? 120;
      const beat = Math.floor(docSeconds / (60 / bpm));
      if (beat !== this.lastBeatCrossed) {
        this.lastBeatCrossed = beat;
        try { this.metronome.triggerAttackRelease("C6", "64n"); } catch { /* ignore */ }
      }
    }

    // ── Loop ──────────────────────────────────────────────────────────────────
    const { loopStart, loopEnd, tempoMultiplier } = this._state;
    if (loopStart !== null && loopEnd !== null && docSeconds >= loopEnd) {
      // Speed trainer: bump tempo on each loop wrap (only while below target)
      if (this.speedTrainer.enabled) {
        const st = this.speedTrainer;
        if (st.currentPct < st.endPct) {
          const nextPct = Math.min(st.endPct, st.currentPct + st.stepPct);
          st.currentPct = nextPct;
          // setTempoMultiplier calls emitState internally
          this.setTempoMultiplier(nextPct / 100);
          bus.emit("speedTrainer:stepped", { currentPct: nextPct });
        }
      }
      this.seek(loopStart);
      return;
    }

    // ── End of song auto-stop ─────────────────────────────────────────────────
    // When no loop is active and playback reaches the end, stop and reset to 0.
    if ((loopStart === null || loopEnd === null) && docSeconds >= this.doc.totalDuration - 0.05) {
      this.stop();
      return;
    }

    // ── Schedule upcoming notes ───────────────────────────────────────────────
    const notes = this.doc.notes;
    while (this.noteIndex < notes.length) {
      const note = notes[this.noteIndex];

      // note.startSeconds is in doc-time; compare directly to docSeconds
      if (note.startSeconds > docSeconds + LOOKAHEAD_DOC_SECONDS) break;
      if (this.activeNotes.has(note.id)) { this.noteIndex++; continue; }

      // Apply transposition (creates a new NoteEvent if needed, preserves original id)
      const tNote = this.transposeNote(note);

      bus.emit("note:upcoming", tNote);
      this.activeNotes.add(note.id);

      // Convert doc-time offset to real-time for Tone.js scheduling.
      // renderOffsetMs > 0 means audio plays earlier (compensates for delayed output).
      const offsetSec = this.renderOffsetMs / 1000;
      const onDelay  = Math.max(0, (note.startSeconds - docSeconds) / tempoMultiplier - offsetSec);
      const offDelay = Math.max(0, (note.endSeconds   - docSeconds) / tempoMultiplier - offsetSec);

      Tone.getTransport().scheduleOnce(() => {
        // Read activeHands at fire-time so hand toggles take effect immediately
        // (not at schedule-time, which would lag up to LOOKAHEAD_DOC_SECONDS).
        const isActive = note.hand === "unknown" || this._state.activeHands.has(note.hand as "left" | "right");
        if (isActive) {
          bus.emit("note:on", tNote);
          // Apply per-hand volume multiplier (also read at fire-time for instant effect)
          const handVol = note.hand === "left"  ? this._state.handVolume.left
                        : note.hand === "right" ? this._state.handVolume.right
                        : 1;
          const scaledNote = handVol === 1 ? tNote
            : { ...tNote, velocity: Math.max(1, Math.round(tNote.velocity * handVol)) };
          this.audio.playNote(scaledNote);
        }
      }, `+${onDelay}`);

      Tone.getTransport().scheduleOnce(() => {
        bus.emit("note:off", tNote);
        this.audio.stopNote(tNote.midi);
      }, `+${offDelay}`);

      // Wait mode
      if (this._state.waitMode && this._state.status === "playing") {
        const isActive = note.hand === "unknown" || this._state.activeHands.has(note.hand as "left" | "right");
        // Only pause for the targeted hand (waitForHand); "both" = current behavior
        const isWaited = this._state.waitForHand === "both"
          || note.hand === "unknown"
          || note.hand === this._state.waitForHand;
        if (isActive && isWaited && onDelay <= 0.05) {
          this.clock.pause();
          this._state.status = "waiting";
          this.emitState("waiting");
        }
      }

      this.noteIndex++;
    }

    // ── YouTube sync ──────────────────────────────────────────────────────────
    if (this.ytPlayer && this.doc.youtubeId) {
      const expectedYtTime = docSeconds + this.doc.youtubeSyncOffset;
      try {
        const actual = this.ytPlayer.getCurrentTime();
        if (Math.abs(actual - expectedYtTime) > YT_DRIFT_THRESHOLD) {
          this.ytPlayer.seekTo(expectedYtTime, true);
        }
      } catch { /* not ready yet */ }
    }
  }

  // rAF loop: emits transport:tick at 60fps for smooth visuals.
  // State listeners throttled to ~10fps to avoid React re-renders.
  private startAnimLoop() {
    let lastStateMs = 0;
    const loop = () => {
      const seconds = this.clock.currentSeconds;
      this._state.currentSeconds = seconds;
      bus.emit("transport:tick", { seconds, tick: 0 });

      const now = performance.now();
      if (now - lastStateMs >= 100) {
        lastStateMs = now;
        for (const cb of this.stateListeners) cb({ ...this._state });
      }

      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  private stopAnimLoop() {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private emitState(status: PlaybackStatus) {
    this._state.status = status;
    bus.emit("transport:stateChange", { status, seconds: this._state.currentSeconds });
    for (const cb of this.stateListeners) cb({ ...this._state });
  }
}

export const syncEngine = new SyncEngine();
export default syncEngine;
