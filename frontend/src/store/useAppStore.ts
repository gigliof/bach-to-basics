import { create } from "zustand";
import { syncEngine } from "../engine/SyncEngine";
import bus from "../engine/EventBus";
import type { MusicDocument, PlaybackStatus } from "@bach-to-basics/shared";
import type { InstrumentId } from "../engine/AudioEngine";
export { computeMeasureSeconds, keySignatureToLabel } from "@bach-to-basics/shared";
export type { InstrumentId } from "../engine/AudioEngine";
export { INSTRUMENT_LABELS } from "../engine/AudioEngine";

/** Which visual effect plays when a note reaches the hit line. */
export type ImpactStyle = "off" | "bloom" | "side" | "trail";

/** Which pitch classes to show in the falling-notes view */
export type NoteFilter = "all" | "white" | "black" | "c_only";

/** Layout mode - which panels are visible */
export type LayoutMode = "falling" | "sheet" | "piano" | "all";

/**
 * Color theme for falling notes (and keyboard highlights).
 * - violet  : all notes violet (default, no hand separation)
 * - classic : left=blue, right=red (hand-aware)
 * - ocean   : cyan palette
 * - forest  : green palette
 * - custom  : user-defined colors via CustomColors
 */
export type ColorTheme = "violet" | "classic" | "ocean" | "forest" | "cascade" | "custom";

/** Per-channel colors for the custom theme (hex strings, e.g. "#3b82f6"). */
export interface CustomColors {
  leftHand:  string;
  rightHand: string;
  unknown:   string;
}

/** Pre-built color values matching each named preset (used to seed the custom picker). */
export const COLOR_PRESET_VALUES: Record<Exclude<ColorTheme, "custom">, CustomColors> = {
  violet:  { leftHand: "#7c3aed", rightHand: "#f59e0b", unknown: "#a78bfa" }, // purple + amber
  classic: { leftHand: "#2563eb", rightHand: "#dc2626", unknown: "#7c3aed" }, // blue + red
  ocean:   { leftHand: "#0284c7", rightHand: "#f97316", unknown: "#0ea5e9" }, // blue + coral
  forest:  { leftHand: "#16a34a", rightHand: "#a855f7", unknown: "#4ade80" }, // green + purple
  cascade: { leftHand: "#9333ea", rightHand: "#22d3ee", unknown: "#a855f7" }, // purple + cyan
};

/** Which keys receive note-name labels on the piano keyboard */
export type NoteLabelMode = "none" | "c_only" | "white" | "black" | "all";

export interface SpeedTrainerSettings {
  enabled:    boolean;
  startPct:   number;   // 0-100
  endPct:     number;   // 0-100
  stepPct:    number;   // increment per loop
  currentPct: number;   // current ramp position
}

export interface AppSettings {
  showFingering: boolean;
  showHandColors: boolean;
  useFlats: boolean;
  viewportSeconds: number; // FallingNotes lookahead window
  theme: "dark" | "light";
  activeHands: Set<"left" | "right">;
  volume: number; // 0-1
  noteFilter: NoteFilter;
  colorTheme: ColorTheme;
  customColors: CustomColors;
  layoutMode: LayoutMode;
  metronomeEnabled: boolean;
  // ── New settings ──────────────────────────────────────────────────────────
  /** Note labels on the piano keyboard */
  noteLabelMode:            NoteLabelMode;
  /** Note labels on the falling notes bars */
  fallingNotesLabelMode:    NoteLabelMode;
  pianoTheme:          "white" | "ivory";
  showGrid:            boolean;
  showMeasureNums:     boolean;
  showKeySignature:    boolean;
  transposeSemitones:  number;  // -6..+6
  speedTrainer:        SpeedTrainerSettings;
  countInBars:         0 | 1 | 2;
  /** Which visual effect plays when a note reaches the hit line */
  impactStyle:         ImpactStyle;
  sheetMusicWhiteBackground: boolean;
  // ── MIDIano-inspired additions ────────────────────────────────────────────
  /** Scroll wheel on the falling notes canvas seeks playback position */
  scrollToSeek:        boolean;
  /** Minimum pixel height for note bars (prevents staccato notes becoming invisible) */
  minNoteHeight:       number;   // 4-24
  /** Border-radius for note bar corners (0 = sharp, 12 = pill) */
  noteCornerRadius:    number;   // 0-12
  /** Draw faint horizontal lines at each beat and measure boundary */
  showBeatLines:       boolean;
  /** Show sustain pedal (CC64) regions as semi-transparent bands */
  showSustainPedal:    boolean;
  /** Per-hand volume multiplier (0 = silent, 1 = full) */
  handVolume:          { left: number; right: number };
  /** Active instrument for audio playback */
  instrument:          InstrumentId;
  /** Which hand(s) trigger wait-mode pauses ("both" = default, all hands) */
  waitForHand:         "left" | "right" | "both";
  /** Draw a colored outline stroke around falling note bars */
  showNoteOutline:     boolean;
  // ── MIDIano live-app additions ────────────────────────────────────────────
  /** Shift audio scheduling by ±ms to compensate for audio interface latency (positive = play earlier) */
  renderOffset:        number;   // -200..+200 ms
  /** Keep a ghost indicator for notes that have ended while sustain pedal is held */
  showSustainedNotes:  boolean;
}

export interface AppState {
  // ── Document ─────────────────────────────────────────────────────────────
  document: MusicDocument | null;
  isLoadingDocument: boolean;
  loadError: string | null;
  /** Non-null during slow imports (e.g. OMR) to show a descriptive message */
  loadingMessage: string | null;

  // ── Playback ─────────────────────────────────────────────────────────────
  status: PlaybackStatus;
  currentSeconds: number;
  tempoMultiplier: number;
  loopStart: number | null;
  loopEnd: number | null;
  waitMode: boolean;

  // ── Settings ─────────────────────────────────────────────────────────────
  settings: AppSettings;

  // ── MIDI device ──────────────────────────────────────────────────────────
  midiDeviceName: string | null;
  midiEnabled: boolean;

  // ── Actions ──────────────────────────────────────────────────────────────
  loadMidiFile: (file: File) => Promise<void>;
  loadMusicXmlFile: (file: File) => Promise<void>;
  loadPdfFile: (file: File) => Promise<void>;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (seconds: number) => void;
  setTempoMultiplier: (v: number) => void;
  setLoopPoints: (start: number | null, end: number | null) => void;
  setWaitMode: (on: boolean) => void;
  setActiveHands: (hands: Set<"left" | "right">) => void;
  setMetronome: (on: boolean) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  resetSettings: () => void;
  setMidiDevice: (name: string | null) => void;
  clearLoadError: () => void;
  syncEngineState: () => void;
}

export const DEFAULT_SETTINGS: AppSettings = {
  showFingering: false,
  showHandColors: true,
  useFlats: false,
  viewportSeconds: 4.0,
  theme: "light",
  activeHands: new Set(["left", "right"]),
  volume: 0.8,
  noteFilter: "all",
  colorTheme: "cascade",
  customColors: { leftHand: "#9333ea", rightHand: "#22d3ee", unknown: "#a855f7" },
  layoutMode: "falling",
  metronomeEnabled: false,
  // ── New defaults ──────────────────────────────────────────────────────────
  noteLabelMode:            "c_only",
  fallingNotesLabelMode:    "all",
  pianoTheme:          "white",
  showGrid:            false,
  showMeasureNums:     true,
  showKeySignature:    true,
  transposeSemitones:  0,
  speedTrainer: { enabled: false, startPct: 60, endPct: 100, stepPct: 5, currentPct: 60 },
  countInBars:         0,
  impactStyle:         "bloom" as ImpactStyle,
  sheetMusicWhiteBackground: false,
  // ── MIDIano-inspired additions ────────────────────────────────────────────
  scrollToSeek:        false,
  minNoteHeight:       8,
  noteCornerRadius:    4,
  showBeatLines:       false,
  showSustainPedal:    false,
  handVolume:          { left: 1, right: 1 },
  // ── "Consider later" additions ────────────────────────────────────────────
  instrument:          "grand" as InstrumentId,
  waitForHand:         "both" as "left" | "right" | "both",
  showNoteOutline:     false,
  // ── MIDIano live-app additions ────────────────────────────────────────────
  renderOffset:        0,
  showSustainedNotes:  false,
};

export const useAppStore = create<AppState>((set, get) => {
  // Subscribe to SyncEngine state changes --> push into Zustand
  syncEngine.onStateChange((s) => {
    set({
      status: s.status,
      currentSeconds: s.currentSeconds,
      tempoMultiplier: s.tempoMultiplier,
      loopStart: s.loopStart,
      loopEnd: s.loopEnd,
      waitMode: s.waitMode,
    });
  });

  // Speed trainer: keep currentPct in sync when the engine steps the tempo
  bus.on("speedTrainer:stepped", ({ currentPct }) => {
    set((s) => ({
      tempoMultiplier: currentPct / 100,
      settings: {
        ...s.settings,
        speedTrainer: { ...s.settings.speedTrainer, currentPct },
      },
    }));
  });

  return {
    document: null,
    isLoadingDocument: false,
    loadError: null,
    loadingMessage: null,
    status: "stopped",
    currentSeconds: 0,
    tempoMultiplier: 1.0,
    loopStart: null,
    loopEnd: null,
    waitMode: false,
    settings: DEFAULT_SETTINGS,
    midiDeviceName: null,
    midiEnabled: false,

    loadMidiFile: async (file: File) => {
      set({ isLoadingDocument: true, loadError: null });

      try {
        const rawBuffer = await file.arrayBuffer();
        const id = crypto.randomUUID();
        // M4 - strip path separators, control chars; cap length
        const rawTitle = file.name.replace(/\.midi?$/i, "");
        const title = rawTitle.replace(/[\x00-\x1f\x7f/\\]/g, "").slice(0, 200) || "Untitled";

        // Slice a copy BEFORE transferring - postMessage() detaches (empties) the original
        const bufferForXml = rawBuffer.slice(0);

        // Parse in Web Worker (transfers rawBuffer ownership)
        const doc = await parseMidiInWorker(rawBuffer, id, title);
        set({ document: doc });
        await syncEngine.loadDocument(doc);

        // Request MusicXML from backend (non-blocking), using the copy
        fetchMusicXml(bufferForXml, doc, id).catch(console.warn);
      } catch (err) {
        set({ loadError: String(err) });
      } finally {
        set({ isLoadingDocument: false });
      }
    },

    loadMusicXmlFile: async (file: File) => {
      set({ isLoadingDocument: true, loadError: null });
      try {
        const id = crypto.randomUUID();
        // M4 - strip path separators, control chars; cap length
        const rawTitle = file.name.replace(/\.(xml|mxl)$/i, "");
        const title = rawTitle.replace(/[\x00-\x1f\x7f/\\]/g, "").slice(0, 200) || "Untitled";
        const xmlBytes = await file.arrayBuffer();

        // For .mxl (ZIP-compressed MusicXML) decompress in the browser so we
        // always end up with a plain XML string.  This is more reliable than
        // relying on AlphaTab's internal ZIP reader (errors are swallowed there
        // and produce a silent blank sheet view).
        let musicXml: string | null;
        if (file.name.toLowerCase().endsWith(".mxl")) {
          const { extractXmlFromMxl } = await import("../utils/mxlExtract");
          musicXml = await extractXmlFromMxl(xmlBytes);
        } else {
          musicXml = new TextDecoder().decode(xmlBytes);
        }

        // Stub document - sheet music renders immediately via musicXml string
        const doc: import("@bach-to-basics/shared").MusicDocument = {
          id, title,
          sourceType: "musicxml",
          musicXml,
          midiBuffer: null,
          notes: [],
          tempoMap: [{ tick: 0, bpm: 120 }],
          timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
          totalDuration: 0,
          ppq: 480,
          keySignature: null,
          youtubeId: null,
          youtubeSyncOffset: 0,
          fingeringVersion: "none",
        };

        set({ document: doc });
        await syncEngine.loadDocument(doc);

        // Fetch MIDI from backend for playback + falling notes (non-blocking).
        // For .mxl files we send the already-extracted plain XML string (re-encoded
        // to UTF-8) with a .xml extension, so the backend gets clean MusicXML rather
        // than the ZIP container. This avoids cross-staff voice-duplication artefacts
        // that music21 can produce when it parses a compressed .mxl directly.
        const xmlBytesForBackend = (musicXml && file.name.toLowerCase().endsWith(".mxl"))
          ? new TextEncoder().encode(musicXml).buffer
          : xmlBytes;
        const filenameForBackend = file.name.toLowerCase().endsWith(".mxl")
          ? file.name.replace(/\.mxl$/i, ".xml")
          : file.name;
        fetchMidiFromXml(xmlBytesForBackend, filenameForBackend, doc, id).catch(console.warn);
      } catch (err) {
        set({ loadError: String(err) });
      } finally {
        set({ isLoadingDocument: false });
      }
    },

    loadPdfFile: async (file: File) => {
      const id = crypto.randomUUID();
      // M4 - strip path separators and control chars; cap length
      const rawTitle = file.name.replace(/\.pdf$/i, "");
      const title = rawTitle.replace(/[\x00-\x1f\x7f/\\]/g, "").slice(0, 200) || "Untitled";

      set({ isLoadingDocument: true, loadingMessage: "Reading sheet music\u2026", loadError: null });

      try {
        const form = new FormData();
        form.append("file", file, file.name);

        // OMR can take 10-120 s; no client-side fetch timeout -
        // the server's subprocess timeout is the effective limit.
        const res = await fetch("/api/omr/pdf2midi", { method: "POST", body: form });

        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { detail?: string };
          throw new Error(body.detail ?? `Server error ${res.status}`);
        }

        const { musicxml, midi_b64 } = await res.json() as {
          musicxml: string;
          midi_b64: string;
          filename: string;
        };

        // Decode base64 MIDI
        const binaryStr = atob(midi_b64);
        const midiBytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) midiBytes[i] = binaryStr.charCodeAt(i);
        const midiBuffer = midiBytes.buffer;
        const bufferForDoc = midiBuffer.slice(0);

        // Parse notes from MIDI (same Web Worker path as loadMidiFile)
        const doc = await parseMidiInWorker(midiBuffer, id, title);

        // Attach MusicXML so sheet music renders immediately alongside playback.
        // sourceType "musicxml" tells AlphaTab to render the score.
        doc.musicXml = musicxml;
        doc.sourceType = "musicxml";

        set({ document: { ...doc, midiBuffer: bufferForDoc } });
        await syncEngine.loadDocument({ ...doc, midiBuffer: bufferForDoc });

      } catch (err) {
        set({ loadError: String(err) });
      } finally {
        set({ isLoadingDocument: false, loadingMessage: null });
      }
    },

    play: () => {
      const { settings, status } = get();
      // Speed trainer: seed the engine's current state before play
      if (settings.speedTrainer.enabled) {
        const st = settings.speedTrainer;
        // If stopped (fresh start), reset to startPct; otherwise keep current
        const currentPct = status === "stopped" ? st.startPct : st.currentPct;
        syncEngine.setSpeedTrainer({ ...st, currentPct });
        syncEngine.setTempoMultiplier(currentPct / 100);
        set((s) => ({
          tempoMultiplier: currentPct / 100,
          settings: {
            ...s.settings,
            speedTrainer: { ...s.settings.speedTrainer, currentPct },
          },
        }));
      }
      syncEngine.play();
    },
    pause: () => syncEngine.pause(),
    stop: () => syncEngine.stop(),
    seek: (seconds) => syncEngine.seek(seconds),

    setTempoMultiplier: (v) => {
      syncEngine.setTempoMultiplier(v);
      set({ tempoMultiplier: v });
    },

    setLoopPoints: (start, end) => {
      syncEngine.setLoopPoints(start, end);
      set({ loopStart: start, loopEnd: end });
    },

    setWaitMode: (on) => {
      syncEngine.setWaitMode(on);
      set({ waitMode: on });
    },

    setMetronome: (on) => {
      syncEngine.setMetronome(on);
      set((s) => ({ settings: { ...s.settings, metronomeEnabled: on } }));
    },

    setActiveHands: (hands) => {
      syncEngine.setActiveHands(hands);
      set((s) => ({
        settings: { ...s.settings, activeHands: hands },
      }));
    },

    updateSettings: (patch) => {
      set((s) => ({ settings: { ...s.settings, ...patch } }));
      // Sync practice settings to the engine immediately
      if ("transposeSemitones" in patch && patch.transposeSemitones !== undefined)
        syncEngine.setTranspose(patch.transposeSemitones);
      if ("countInBars" in patch && patch.countInBars !== undefined)
        syncEngine.setCountInBars(patch.countInBars);
      if ("speedTrainer" in patch && patch.speedTrainer !== undefined)
        syncEngine.setSpeedTrainer(patch.speedTrainer);
      if ("handVolume" in patch && patch.handVolume !== undefined)
        syncEngine.setHandVolume(patch.handVolume);
      if ("instrument" in patch && patch.instrument !== undefined)
        syncEngine.setInstrument(patch.instrument).catch(console.warn);
      if ("waitForHand" in patch && patch.waitForHand !== undefined)
        syncEngine.setWaitForHand(patch.waitForHand);
      if ("renderOffset" in patch && patch.renderOffset !== undefined)
        syncEngine.setRenderOffset(patch.renderOffset);
    },

    resetSettings: () => {
      set({ settings: { ...DEFAULT_SETTINGS } });
      // Re-sync engine with defaults
      syncEngine.setTranspose(DEFAULT_SETTINGS.transposeSemitones);
      syncEngine.setCountInBars(DEFAULT_SETTINGS.countInBars);
      syncEngine.setSpeedTrainer(DEFAULT_SETTINGS.speedTrainer);
      syncEngine.setMetronome(DEFAULT_SETTINGS.metronomeEnabled);
      syncEngine.setActiveHands(DEFAULT_SETTINGS.activeHands);
      syncEngine.setHandVolume(DEFAULT_SETTINGS.handVolume);
      syncEngine.setWaitForHand(DEFAULT_SETTINGS.waitForHand);
      syncEngine.setInstrument(DEFAULT_SETTINGS.instrument).catch(console.warn);
      syncEngine.setRenderOffset(DEFAULT_SETTINGS.renderOffset);
    },

    setMidiDevice: (name) => set({ midiDeviceName: name, midiEnabled: name !== null }),

    clearLoadError: () => set({ loadError: null }),

    syncEngineState: () => {
      const s = syncEngine.state;
      set({
        status: s.status,
        currentSeconds: s.currentSeconds,
        tempoMultiplier: s.tempoMultiplier,
        loopStart: s.loopStart,
        loopEnd: s.loopEnd,
        waitMode: s.waitMode,
      });
    },
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseMidiInWorker(
  buffer: ArrayBuffer,
  id: string,
  title: string
): Promise<MusicDocument> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/midi.worker.ts", import.meta.url), {
      type: "module",
    });

    // M3 - kill the worker if it hangs (e.g. malformed MIDI, infinite loop)
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("MIDI parsing timed out"));
    }, 30_000);

    worker.onmessage = (e) => {
      clearTimeout(timeout);
      worker.terminate();
      if (e.data.ok) resolve(e.data.doc as MusicDocument);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(e);
    };
    worker.postMessage({ buffer, id, title }, [buffer]);
  });
}

async function fetchMidiFromXml(
  xmlBytes: ArrayBuffer,
  filename: string,
  doc: import("@bach-to-basics/shared").MusicDocument,
  id: string
): Promise<void> {
  const blob = new Blob([xmlBytes], { type: "application/xml" });
  const form = new FormData();
  form.append("file", blob, filename);

  const res = await fetch("/api/transcribe/musicxml2midi", { method: "POST", body: form });
  if (!res.ok) return;

  const midiBuffer = await res.arrayBuffer();
  const bufferForDoc = midiBuffer.slice(0);

  // Parse notes from the returned MIDI
  const updatedDoc = await parseMidiInWorker(midiBuffer, id, doc.title);
  updatedDoc.musicXml = doc.musicXml;
  updatedDoc.sourceType = "musicxml";

  const { document: currentDoc } = useAppStore.getState();
  if (currentDoc?.id === id) {
    useAppStore.setState({ document: { ...updatedDoc, midiBuffer: bufferForDoc } });
    await syncEngine.loadDocument({ ...updatedDoc, midiBuffer: bufferForDoc });
  }
}

async function fetchMusicXml(
  buffer: ArrayBuffer,
  doc: MusicDocument,
  _id: string
): Promise<void> {
  const blob = new Blob([buffer], { type: "audio/midi" });
  const form = new FormData();
  form.append("file", blob, "track.mid");

  const titleParam = encodeURIComponent(doc.title ?? "");
  const res = await fetch(`/api/transcribe/midi2musicxml?title=${titleParam}`, { method: "POST", body: form });
  if (!res.ok) return;

  const { musicxml } = await res.json() as { musicxml: string };
  doc.musicXml = musicxml;

  // Notify sheet view that MusicXML is now available
  const { document: currentDoc } = useAppStore.getState();
  if (currentDoc?.id === doc.id) {
    useAppStore.setState({ document: { ...doc } });
  }
}
