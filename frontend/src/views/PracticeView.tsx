import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { FallingNotesView } from "../components/FallingNotes/FallingNotesView";
import { PianoKeyboardView } from "../components/PianoKeyboard/PianoKeyboardView";
import { SheetMusicView } from "../components/SheetMusic/SheetMusicView";
import { TransportControls } from "../components/Transport/TransportControls";
import { SettingsPanel } from "../components/Transport/SettingsPanel";
import { DevicePanel } from "../components/DevicePanel/DevicePanel";
import { useAppStore } from "../store/useAppStore";
import type { LayoutMode } from "../store/useAppStore";
import bus from "../engine/EventBus";
import { midiToPitch, keySignatureToLabel } from "@bach-to-basics/shared";
import { syncEngine } from "../engine/SyncEngine";

const TAB_LABELS: Record<LayoutMode, string> = {
  piano: "Piano",
  falling: "Notes",
  sheet: "Sheet",
  all: "All",
};

const TAB_TITLES: Record<LayoutMode, string> = {
  piano: "Show only the piano keyboard view",
  falling: "Show only the falling notes view",
  sheet: "Show only the sheet music view",
  all: "Show all views at once",
};

export function PracticeView() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const {
    loadMidiFile,
    loadMusicXmlFile,
    loadPdfFile,
    settings,
    updateSettings,
    status,
    play,
    pause,
    seek,
    loadError,
    clearLoadError,
    document: doc,
    isLoadingDocument,
  } = useAppStore();

  // Pre-warm sample loading so piano keys respond with minimal latency.
  // Sample fetch (CDN) does NOT need a user gesture - just creates an
  // AudioContext (suspended) and downloads samples in the background.
  useEffect(() => {
    syncEngine.audio.load().catch(() => {});
    const preWarm = () => syncEngine.audio.load().catch(() => {});
    document.addEventListener("pointermove", preWarm, { once: true });
    return () => document.removeEventListener("pointermove", preWarm);
  }, []);

  // Wake both audio contexts (Tone.js + smplr) on the FIRST real user gesture.
  // The pre-warm above creates contexts before any gesture, so browser autoplay
  // policy keeps them suspended. Without this, no sound ever plays.
  useEffect(() => {
    let woken = false;
    const wake = () => {
      if (woken) return;
      woken = true;
      syncEngine.wakeAudio();
    };
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  // Apply theme to <html> element
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  // Spacebar: play / pause
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.code !== "Space" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      e.preventDefault();
      if (status === "playing") pause();
      else play();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [status, play, pause]);

  // ArrowLeft / ArrowRight: seek to prev / next note onset
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code !== "ArrowLeft" && e.code !== "ArrowRight") return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      e.preventDefault();
      const { document: d, currentSeconds } = useAppStore.getState();
      if (!d?.notes.length) return;
      const onsets = [...new Set(d.notes.map((n) => n.startSeconds))].sort((a, b) => a - b);
      if (e.code === "ArrowRight") {
        const next = onsets.find((t) => t > currentSeconds + 0.05);
        if (next !== undefined) seek(next);
      } else {
        const prev = [...onsets].reverse().find((t) => t < currentSeconds - 0.05);
        if (prev !== undefined) seek(prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [seek]);

  const loadFile = useCallback(
    (file: File) => {
      if (file.name.match(/\.midi?$/i)) loadMidiFile(file);
      else if (file.name.match(/\.mxl?$/i)) loadMusicXmlFile(file);
      else if (file.name.match(/\.pdf$/i)) loadPdfFile(file);
    },
    [loadMidiFile, loadMusicXmlFile, loadPdfFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) loadFile(file);
    },
    [loadFile]
  );

  const { layoutMode } = settings;
  const setLayout = (mode: LayoutMode) => updateSettings({ layoutMode: mode });

  return (
    <div
      className="flex flex-col h-screen"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      {/* Flex layout with absolutely-centered tabs:
          - Left group: flex, takes natural width (never truncates)
          - Center tabs: position:absolute left:50% transform:translateX(-50%) - true viewport center
          - Right group: marginLeft:auto, pushes to far right
          This pattern is immune to left/right asymmetry that breaks grid-based centering. */}
      <header
        className="flex-shrink-0 flex items-center"
        style={{
          position: "relative",
          height: 44,
          background: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
          paddingLeft: 10,
          paddingRight: 10,
        }}
      >
        {/* Left: gradient logo + app name → links to GitHub repo */}
        <a
          href="https://github.com/gigliof/bach-to-basics"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 shrink-0"
          style={{ textDecoration: "none" }}
        >
          <div
            role="img"
            aria-hidden="true"
            className="flex items-center justify-center shrink-0 select-none"
            style={{
              width: 32,
              height: 32,
              background: "linear-gradient(135deg, #7c3aed 0%, #9333ea 100%)",
              borderRadius: 8,
              boxShadow: "0 3px 10px rgba(147,51,234,0.45)",
            }}
          >
            <PianoKeysIcon />
          </div>
          {/* Typographic pun: "Bach" and "Basics" bold, "to" muted */}
          <span
            style={{ fontSize: 15, whiteSpace: "nowrap", letterSpacing: "-0.3px", lineHeight: 1 }}
          >
            <span style={{ fontWeight: 700, color: "var(--color-text)" }}>Bach</span>
            <span style={{ fontWeight: 400, color: "var(--color-text-muted)", margin: "0 3px" }}>
              to
            </span>
            <span style={{ fontWeight: 700, color: "var(--color-text)" }}>Basics</span>
            <span className="sr-only"> on GitHub</span>
          </span>
        </a>

        {/* Center: layout mode tabs - absolutely centered in the header */}
        <div
          className="flex items-center"
          style={{ position: "absolute", left: "50%", transform: "translateX(-50%)" }}
        >
          <div
            className="flex items-center"
            style={{
              padding: 3,
              background: "var(--color-surface-2)",
              borderRadius: 999,
              border: "1px solid var(--color-border)",
            }}
          >
            {(["piano", "falling", "sheet", "all"] as LayoutMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setLayout(mode)}
                title={TAB_TITLES[mode]}
                aria-label={TAB_TITLES[mode]}
                className="transition-all font-semibold"
                style={{
                  padding: "4px 12px",
                  fontSize: 12,
                  borderRadius: 999,
                  border: "none",
                  background: layoutMode === mode ? "var(--color-accent)" : "transparent",
                  color: layoutMode === mode ? "#ffffff" : "var(--color-text-muted)",
                  boxShadow: layoutMode === mode ? "0 0 12px rgba(147,51,234,0.35)" : "none",
                  cursor: "pointer",
                }}
              >
                {TAB_LABELS[mode]}
              </button>
            ))}
          </div>
        </div>

        {/* Right: MIDI device chip + theme toggle + settings gear */}
        <div className="flex items-center gap-1.5" style={{ marginLeft: "auto" }}>
          <DevicePanel />
          <button
            onClick={() => updateSettings({ theme: settings.theme === "dark" ? "light" : "dark" })}
            title={settings.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={settings.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="flex items-center justify-center rounded transition-colors shrink-0"
            style={{
              width: 30,
              height: 30,
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-muted)",
            }}
          >
            {settings.theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Open settings"
            className="flex items-center justify-center rounded transition-colors shrink-0"
            style={{
              width: 30,
              height: 30,
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-muted)",
            }}
          >
            <GearIcon />
          </button>
        </div>
      </header>

      {/* ── Main content - layout-aware ────────────────────────────────────── */}
      <main className="flex flex-1 overflow-hidden min-h-0 relative">
        {layoutMode === "piano" && (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <PianoModeBackground />
            <PianoKeyboardView />
          </div>
        )}
        {layoutMode === "falling" && (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <FallingNotesView />
            <PianoKeyboardView />
          </div>
        )}
        {layoutMode === "sheet" && (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <SheetMusicView />
            <PianoKeyboardView />
          </div>
        )}
        {layoutMode === "all" && (
          <>
            <div
              className="flex flex-col flex-shrink-0 min-h-0 overflow-hidden relative"
              style={{ flex: "0 0 42%", minWidth: 260, maxWidth: 440 }}
            >
              <SheetMusicView />
            </div>
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <FallingNotesView />
              <PianoKeyboardView />
            </div>
          </>
        )}
      </main>

      {/* ── Empty state overlay ────────────────────────────────────────────── */}
      {!doc && !isLoadingDocument && <EmptyState onImport={loadFile} />}

      {/* ── Error toast ────────────────────────────────────────────────────── */}
      {loadError && <ErrorToast message={loadError} onDismiss={clearLoadError} />}

      {/* ── Transport bar ──────────────────────────────────────────────────── */}
      <TransportControls />

      {/* ── Status bar ─────────────────────────────────────────────────────── */}
      <StatusBar />

      {/* ── Settings panel (managed here, gear is in header) ───────────────── */}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onImport }: { onImport: (file: File) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        textAlign: "center",
        padding: 40,
        pointerEvents: "none",
      }}
    >
      {/* Illustration */}
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 18,
          background:
            "linear-gradient(135deg, rgba(147,51,234,0.25) 0%, rgba(147,51,234,0.10) 100%), var(--color-notes-bg)",
          border: "1px solid rgba(147,51,234,0.25)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-accent-text)",
        }}
      >
        <MusicNoteIcon />
      </div>

      <div style={{ maxWidth: 300 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", marginBottom: 8 }}>
          No file loaded
        </div>
        <div style={{ fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.6 }}>
          Import a MIDI, MusicXML, or PDF sheet music file to start practicing
        </div>
      </div>

      {/* Primary CTA */}
      <button
        onClick={() => fileInputRef.current?.click()}
        style={{
          pointerEvents: "all",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "11px 28px",
          background: "var(--color-accent)",
          color: "#fff",
          border: "none",
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 0 24px rgba(147,51,234,0.45)",
          fontFamily: "inherit",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 34px rgba(147,51,234,0.6)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 24px rgba(147,51,234,0.45)";
        }}
      >
        <UploadIconLg />
        Import a file
      </button>

      <span style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: -10 }}>
        or drag &amp; drop anywhere
      </span>

      <input
        ref={fileInputRef}
        type="file"
        accept=".mid,.midi,.xml,.mxl,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImport(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

const UploadIconLg = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z" />
  </svg>
);

// ── Piano-mode background ─────────────────────────────────────────────────────
// Mirrors the grid drawn by FallingNotesRenderer so the piano-only view has the
// same dark background + black-key lanes + octave separator lines.

const MIDI_MIN_BG = 21; // A0
const MIDI_MAX_BG = 108; // C8

/** Precompute whiteKeyIndex (cumulative white-key counter per MIDI note). */
function buildWhiteKeyIndex() {
  const isBlk = (m: number) => [1, 3, 6, 8, 10].includes(m % 12);
  const idx = new Array<number>(MIDI_MAX_BG + 1).fill(0);
  let wi = 0;
  for (let m = MIDI_MIN_BG; m <= MIDI_MAX_BG; m++) {
    idx[m] = wi;
    if (!isBlk(m)) wi++;
  }
  return { idx, totalWhite: wi };
}
const { idx: wkIdx, totalWhite: TOTAL_WHITE_BG } = buildWhiteKeyIndex();

function drawPianoGrid(canvas: HTMLCanvasElement) {
  const { width, height } = canvas;
  if (width === 0 || height === 0) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const isBlk = (m: number) => [1, 3, 6, 8, 10].includes(m % 12);
  const wW = width / TOTAL_WHITE_BG;

  // Clear to transparent - the CSS background on the parent div provides the colour.
  ctx.clearRect(0, 0, width, height);

  // Faint octave separator lines at every C - neutral, works on dark and light
  ctx.fillStyle = "rgba(128,128,144,0.2)";
  for (let m = MIDI_MIN_BG; m <= MIDI_MAX_BG; m++) {
    if (m % 12 === 0 && !isBlk(m)) {
      const x = wkIdx[m] * wW;
      ctx.fillRect(x, 0, 1, height);
    }
  }
}

function PianoModeBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { settings } = useAppStore();

  // Reusable draw callback
  const redraw = useMemo(
    () => () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      drawPianoGrid(canvas);
    },
    []
  );

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      canvas.width = Math.round(width);
      canvas.height = Math.round(height);
      if (settings.showGrid) redraw();
    });
    ro.observe(container);

    // Initial size
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    if (settings.showGrid) redraw();

    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redraw]);

  // Redraw when showGrid toggles
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (settings.showGrid) {
      redraw();
    } else {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [settings.showGrid, redraw]);

  return (
    <div
      ref={containerRef}
      className="flex-1 relative"
      style={{
        minHeight: 0,
        background:
          "radial-gradient(ellipse at 50% 100%, rgba(147,51,234,0.07) 0%, transparent 65%), var(--color-notes-bg)",
        borderTop: "1px solid var(--color-notes-border)",
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}

// ── Status bar ────────────────────────────────────────────────────────────────

function StatusBar() {
  const { document: doc, currentSeconds, tempoMultiplier, status } = useAppStore();
  const [lastNote, setLastNote] = useState<string>("");
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onNoteOn = ({ midi }: { midi: number; velocity: number }) => {
      setLastNote(midiToPitch(midi));
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => setLastNote(""), 2000);
    };
    bus.on("input:note:on", onNoteOn as never);
    return () => {
      bus.off("input:note:on", onNoteOn as never);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  const bpm = doc?.tempoMap[0]?.bpm ?? null;
  const effectiveBpm = bpm ? Math.round(bpm * tempoMultiplier) : null;
  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${Math.floor(s % 60)
      .toString()
      .padStart(2, "0")}`;
  const keySig = doc?.keySignature ? keySignatureToLabel(doc.keySignature) : null;
  const isActive = status === "playing" || status === "paused";

  return (
    <div
      className="flex items-center gap-3 border-t flex-shrink-0 min-w-0"
      style={{
        height: 26,
        background: "var(--color-surface)",
        borderColor: "var(--color-border-subtle)",
        fontSize: 11,
        color: "var(--color-text-muted)",
        fontVariantNumeric: "tabular-nums",
        paddingLeft: 10,
        paddingRight: 12,
      }}
    >
      {doc ? (
        <>
          {isActive && (
            <span style={{ color: "var(--color-accent)", fontWeight: 600, flexShrink: 0 }}>
              Playing
            </span>
          )}
          <span className="truncate" style={{ minWidth: 0 }}>
            {doc.title}
          </span>
          {keySig && (
            <>
              <Dot />
              <span className="shrink-0">{keySig}</span>
            </>
          )}
          {effectiveBpm !== null && (
            <>
              <Dot />
              <span className="shrink-0">{effectiveBpm} BPM</span>
            </>
          )}
          {lastNote && (
            <>
              <Dot />
              <span className="shrink-0" style={{ color: "var(--color-accent)" }}>
                {lastNote}
              </span>
            </>
          )}
        </>
      ) : (
        <span>No file loaded - drag &amp; drop or click ↑ Import</span>
      )}
      <div className="flex-1 min-w-0" />
      {doc && (
        <span className="shrink-0">
          {fmt(currentSeconds)} / {fmt(doc.totalDuration)}
        </span>
      )}
    </div>
  );
}

const Dot = () => <span style={{ color: "var(--color-text-dim)" }}>·</span>;

// ── Error toast ───────────────────────────────────────────────────────────────
// Shown whenever loadError is non-null. Dismissible with ✕ or auto-dismissed
// after 12 s so it doesn't block the UI forever.

function ErrorToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    // Longer timeout for multi-line messages (setup instructions, etc.)
    const delay = message.includes("\n") ? 30_000 : 12_000;
    const t = setTimeout(onDismiss, delay);
    return () => clearTimeout(t);
  }, [message, onDismiss]);

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        bottom: 68, // above the transport bar
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2000,
        maxWidth: 520,
        width: "calc(100% - 32px)",
        background: "var(--color-surface)",
        border: "1px solid rgba(239,68,68,0.5)",
        borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
        padding: "10px 14px",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        fontSize: 12,
        color: "var(--color-text)",
        lineHeight: 1.5,
      }}
    >
      {/* Warning icon */}
      <span style={{ color: "#f87171", fontSize: 16, lineHeight: 1.2, flexShrink: 0 }}>⚠</span>
      <span style={{ flex: 1, wordBreak: "break-word" }}>
        {message.split("\n").map((line, i) => (
          <span key={i}>
            {line}
            {i < message.split("\n").length - 1 && <br />}
          </span>
        ))}
      </span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss error"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--color-text-muted)",
          fontSize: 16,
          lineHeight: 1,
          flexShrink: 0,
          padding: "0 2px",
        }}
      >
        ✕
      </button>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const MusicNoteIcon = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
  </svg>
);

/** Piano keyboard icon: 5 white keys with 3 black keys (C-D-E-F-G pattern) */
const PianoKeysIcon = () => (
  <svg width="18" height="14" viewBox="0 0 17 14" fill="none" aria-hidden="true">
    {/* White keys */}
    <rect x="0" y="0" width="3" height="13" rx="0.5" fill="white" fillOpacity="0.95" />
    <rect x="3.5" y="0" width="3" height="13" rx="0.5" fill="white" fillOpacity="0.95" />
    <rect x="7" y="0" width="3" height="13" rx="0.5" fill="white" fillOpacity="0.95" />
    <rect x="10.5" y="0" width="3" height="13" rx="0.5" fill="white" fillOpacity="0.95" />
    <rect x="14" y="0" width="3" height="13" rx="0.5" fill="white" fillOpacity="0.95" />
    {/* Black keys */}
    <rect x="2" y="0" width="2.5" height="8.5" rx="0.5" fill="rgba(0,0,0,0.5)" />
    <rect x="5.5" y="0" width="2.5" height="8.5" rx="0.5" fill="rgba(0,0,0,0.5)" />
    <rect x="12.5" y="0" width="2.5" height="8.5" rx="0.5" fill="rgba(0,0,0,0.5)" />
  </svg>
);

const SunIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2v-2H2v2zm18 0h2v-2h-2v2zM11 2v2h2V2h-2zm0 18v2h2v-2h-2zM5.64 6.35 4.22 4.93a1 1 0 0 0-1.41 1.41l1.41 1.42 1.42-1.41zM18.36 17.65l1.42 1.41a1 1 0 0 0 1.41-1.41l-1.41-1.42-1.42 1.42zM5.64 17.66l-1.42 1.41a1 1 0 0 1-1.41-1.41l1.41-1.42 1.42 1.42zM19.78 4.93l-1.42 1.42-1.41-1.42 1.42-1.41a1 1 0 0 1 1.41 1.41z" />
  </svg>
);
const MoonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z" />
  </svg>
);
const GearIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
