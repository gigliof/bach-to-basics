import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { syncEngine } from "../../engine/SyncEngine";

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;
}

export function TransportControls() {
  const {
    status,
    currentSeconds,
    tempoMultiplier,
    loopStart,
    loopEnd,
    waitMode,
    document: doc,
    play,
    pause,
    stop,
    seek,
    setTempoMultiplier,
    setLoopPoints,
    setWaitMode,
    setMetronome,
    settings,
    loadMidiFile,
    loadMusicXmlFile,
    loadPdfFile,
    isLoadingDocument,
    loadingMessage,
  } = useAppStore();

  const [speedOpen, setSpeedOpen] = useState(false);
  const [speedRect, setSpeedRect] = useState<{ bottom: number; right: number } | null>(null);
  const speedContainerRef = useRef<HTMLDivElement>(null);

  // When opening, capture fixed position so popover escapes the overflow:auto container
  const toggleSpeed = () => {
    if (!speedOpen && speedContainerRef.current) {
      const r = speedContainerRef.current.getBoundingClientRect();
      setSpeedRect({ bottom: window.innerHeight - r.top + 8, right: window.innerWidth - r.right });
    }
    setSpeedOpen((v) => !v);
  };

  // Close speed popover on outside click
  useEffect(() => {
    if (!speedOpen) return;
    const handler = (e: MouseEvent) => {
      if (!speedContainerRef.current?.contains(e.target as Node)) setSpeedOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [speedOpen]);

  const openFile = (file: File) => {
    if (file.name.match(/\.midi?$/i)) loadMidiFile(file);
    else if (file.name.match(/\.(xml|mxl)$/i)) loadMusicXmlFile(file);
    else if (file.name.match(/\.pdf$/i)) loadPdfFile(file);
  };

  const total = doc?.totalDuration ?? 0;
  const progress = total > 0 ? Math.min(1, currentSeconds / total) : 0;
  const loopActive = loopStart !== null && loopEnd !== null;
  const isPlaying = status === "playing";
  const isPaused = status === "paused";
  const isStopped = status === "stopped";

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!total) return;
    const rect = e.currentTarget.getBoundingClientRect();
    seek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * total);
  };

  const toggleHand = (hand: "left" | "right") => {
    const next = new Set(settings.activeHands);
    if (next.has(hand)) {
      if (next.size > 1) next.delete(hand);
    } else next.add(hand);
    useAppStore.getState().setActiveHands(next);
  };

  const startLoop = () => {
    const start = currentSeconds;
    const end = Math.min(total, start + 30);
    setLoopPoints(start, end > start ? end : total);
  };
  const clearLoop = () => setLoopPoints(null, null);
  const setLoopA = () => {
    if (loopEnd !== null) setLoopPoints(Math.min(currentSeconds, loopEnd - 1), loopEnd);
  };
  const setLoopB = () => {
    if (loopStart !== null) setLoopPoints(loopStart, Math.max(currentSeconds, loopStart + 1));
  };

  return (
    <div
      className="flex flex-col gap-1.5 pt-2 pb-2 flex-shrink-0 select-none"
      style={{
        borderTop: "1px solid var(--color-border)",
        background: "var(--color-surface)",
        paddingLeft: 12,
        paddingRight: 12,
      }}
    >
      {/* ── Progress bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2" style={{ marginLeft: -12, marginRight: -12 }}>
        <span
          className="text-xs tabular-nums w-9 shrink-0 text-right"
          style={{ color: "var(--color-text-muted)", paddingLeft: 12 }}
          aria-label="current time"
        >
          {formatTime(currentSeconds)}
        </span>

        {/* Enlarged hit area (vertical padding) around the visual bar */}
        <div
          className="flex-1 relative cursor-pointer"
          style={{ padding: "8px 0", margin: "-8px 0" }}
          onClick={handleProgressClick}
          role="slider"
          aria-label="Playback position"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="relative rounded-full"
            style={{ height: 6, background: "var(--color-surface-3)" }}
          >
            {/* Loop region */}
            {loopActive && total > 0 && (
              <div
                className="absolute top-0 h-full"
                style={{
                  left: `${(loopStart! / total) * 100}%`,
                  width: `${((loopEnd! - loopStart!) / total) * 100}%`,
                  background: "var(--color-accent)",
                  opacity: 0.25,
                }}
              />
            )}
            {/* Playhead fill */}
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${progress * 100}%`, background: "var(--color-accent)" }}
            />
            {/* Thumb - clamped so it never bleeds outside the track */}
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: `clamp(7px, ${progress * 100}%, calc(100% - 7px))`,
                transform: "translate(-50%, -50%)",
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: "white",
                boxShadow: "0 0 0 2px var(--color-accent), 0 1px 4px rgba(0,0,0,0.3)",
                pointerEvents: "none",
              }}
            />
          </div>
        </div>

        <span
          className="text-xs tabular-nums w-9 shrink-0"
          style={{ color: "var(--color-text-muted)", paddingRight: 12 }}
          aria-label="total duration"
        >
          {formatTime(total)}
        </span>
      </div>

      {/* ── Controls row ──────────────────────────────────────────────────── */}
      <div
        className="flex items-center min-w-0"
        style={{ gap: 6, overflowX: "auto", scrollbarWidth: "none" }}
      >
        {/* ── Zone 1: File import - accent-styled to stand out ── */}
        <label
          title="Open MIDI, MusicXML, or PDF sheet music"
          aria-label="Import MIDI, MusicXML, or PDF file"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            height: 32,
            padding: "0 12px",
            borderRadius: 7,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "inherit",
            flexShrink: 0,
            background: "rgba(147,51,234,0.14)",
            border: "1px solid rgba(147,51,234,0.35)",
            color: "var(--color-accent-text)",
            transition: "background 0.12s",
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLElement).style.background = "rgba(147,51,234,0.24)")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLElement).style.background = "rgba(147,51,234,0.14)")
          }
        >
          {isLoadingDocument ? <SpinnerIcon /> : <UploadIcon />}
          {isLoadingDocument && loadingMessage ? (
            <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{loadingMessage}</span>
          ) : (
            <span>Import</span>
          )}
          <input
            type="file"
            accept=".mid,.midi,.xml,.mxl,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) openFile(f);
              e.target.value = "";
            }}
          />
        </label>

        <Divider />

        {/* ── Zone 2: Playback controls ───────────────────────── */}
        <div className="flex items-center shrink-0" style={{ gap: 4 }}>
          <Btn
            onClick={stop}
            title="Stop and return to start"
            aria-label="Stop"
            disabled={isStopped}
          >
            <StopIcon />
          </Btn>
          <Btn
            onClick={() => syncEngine.skipBy(-10)}
            title="Skip back 10 seconds"
            aria-label="Skip back 10 seconds"
            disabled={!doc}
          >
            <SkipBackIcon />
          </Btn>
          <Btn
            primary
            onClick={isPlaying ? pause : () => play()}
            title={isPlaying ? "Pause" : isPaused ? "Resume" : "Play"}
            aria-label={isPlaying ? "Pause" : isPaused ? "Resume playback" : "Play"}
            disabled={!doc}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </Btn>
          <Btn
            onClick={() => syncEngine.skipBy(10)}
            title="Skip forward 10 seconds"
            aria-label="Skip forward 10 seconds"
            disabled={!doc}
          >
            <SkipFwdIcon />
          </Btn>
        </div>

        <Divider />

        {/* ── Zone 4: Hands ───────────────────────────────────── */}
        <div className="flex items-center shrink-0" style={{ gap: 5 }}>
          {(["left", "right"] as const).map((h) => {
            const active = settings.activeHands.has(h);
            const isLeft = h === "left";
            return (
              <button
                key={h}
                onClick={() => toggleHand(h)}
                title={`${active ? "Mute" : "Unmute"} ${h} hand`}
                aria-label={`${active ? "Mute" : "Unmute"} ${h} hand`}
                aria-pressed={active}
                className="rounded text-xs font-bold transition-all"
                style={{
                  width: 28,
                  height: 28,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  ...(active
                    ? {
                        background: isLeft
                          ? "var(--color-left-hand-subtle)"
                          : "var(--color-right-hand-subtle)",
                        color: isLeft
                          ? "var(--color-left-hand-text)"
                          : "var(--color-right-hand-text)",
                        border: isLeft
                          ? "1px solid var(--color-left-hand-subtle-border)"
                          : "1px solid var(--color-right-hand-subtle-border)",
                      }
                    : {
                        background: "var(--color-surface-2)",
                        color: "var(--color-text-muted)",
                        border: "1px solid var(--color-border)",
                        opacity: 0.5,
                      }),
                }}
              >
                {isLeft ? "L" : "R"}
              </button>
            );
          })}
        </div>

        {/* Spacer */}
        <div className="flex-1 min-w-0" />

        {/* ── Zone 5: Practice tools ──────────────────────────── */}
        <div className="flex items-center shrink-0" style={{ gap: 4 }}>
          <ChipBtn
            active={waitMode}
            onClick={() => setWaitMode(!waitMode)}
            title="Pause until you play the correct note"
            aria-label="Wait mode"
            aria-pressed={waitMode}
          >
            <WaitIcon /> Wait
          </ChipBtn>

          {/* ── A / Loop / B - single compound grouped control ── */}
          <div
            className="flex items-center shrink-0"
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: 7,
              overflow: "hidden",
              background: "var(--color-surface-2)",
            }}
          >
            {/* A marker */}
            <button
              onClick={setLoopA}
              disabled={!loopActive}
              title="Set loop start (A) to current position"
              aria-label="Set loop start to current position"
              style={{
                height: 28,
                padding: "0 8px",
                background: "transparent",
                border: "none",
                borderRight: "1px solid var(--color-border)",
                color: loopActive ? "var(--color-accent-text)" : "var(--color-text-muted)",
                fontSize: 11,
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: loopActive ? "pointer" : "default",
                opacity: loopActive ? 1 : 0.5,
                transition: "all 0.12s",
              }}
            >
              A
            </button>

            {/* Loop toggle (middle) */}
            <button
              onClick={loopActive ? clearLoop : startLoop}
              disabled={!doc}
              title={loopActive ? "Clear loop" : "Start A/B loop from current position"}
              aria-label={loopActive ? "Clear loop" : "Start loop"}
              aria-pressed={loopActive}
              style={{
                height: 28,
                padding: "0 9px",
                background: loopActive ? "var(--color-accent-subtle)" : "transparent",
                border: "none",
                color: loopActive ? "var(--color-accent-text)" : "var(--color-text-muted)",
                fontSize: 11,
                fontWeight: 500,
                fontFamily: "inherit",
                cursor: doc ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                gap: 4,
                transition: "all 0.12s",
              }}
            >
              <LoopIcon />
              {loopActive ? `${formatTime(loopStart!)}-${formatTime(loopEnd!)}` : "Loop"}
            </button>

            {/* B marker */}
            <button
              onClick={setLoopB}
              disabled={!loopActive}
              title="Set loop end (B) to current position"
              aria-label="Set loop end to current position"
              style={{
                height: 28,
                padding: "0 8px",
                background: "transparent",
                border: "none",
                borderLeft: "1px solid var(--color-border)",
                color: loopActive ? "var(--color-accent-text)" : "var(--color-text-muted)",
                fontSize: 11,
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: loopActive ? "pointer" : "default",
                opacity: loopActive ? 1 : 0.5,
                transition: "all 0.12s",
              }}
            >
              B
            </button>
          </div>

          <ChipBtn
            active={settings.metronomeEnabled}
            onClick={() => setMetronome(!settings.metronomeEnabled)}
            title="Metronome (auto-syncs to MIDI BPM)"
            aria-label="Toggle metronome"
            aria-pressed={settings.metronomeEnabled}
          >
            <MetronomeIcon /> Metronome
          </ChipBtn>

          {/* ── Speed chip with popover ─────────────────────────── */}
          <div className="relative shrink-0" ref={speedContainerRef}>
            <ChipBtn
              active={tempoMultiplier !== 1.0 || speedOpen}
              onClick={toggleSpeed}
              title="Playback speed"
              aria-label="Playback speed"
              aria-pressed={speedOpen}
            >
              <SpeedIcon />
              {tempoMultiplier !== 1.0 ? `${Math.round(tempoMultiplier * 100)}%` : "Speed"}
            </ChipBtn>

            {speedOpen && speedRect && (
              <div
                style={{
                  position: "fixed",
                  bottom: speedRect.bottom,
                  right: speedRect.right,
                  width: 220,
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 10,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                  zIndex: 100,
                  padding: "12px 14px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 10,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>
                    Playback Speed
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--color-accent-text)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {Math.round(tempoMultiplier * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={25}
                  max={200}
                  step={5}
                  value={Math.round(tempoMultiplier * 100)}
                  onChange={(e) => setTempoMultiplier(Number(e.target.value) / 100)}
                  aria-label="Playback speed"
                  style={{ width: "100%", accentColor: "var(--color-accent)" }}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 10,
                    color: "var(--color-text-muted)",
                    marginTop: 4,
                  }}
                >
                  <span>25%</span>
                  <span>100%</span>
                  <span>200%</span>
                </div>
                {tempoMultiplier !== 1.0 && (
                  <button
                    onClick={() => setTempoMultiplier(1.0)}
                    style={{
                      marginTop: 10,
                      width: "100%",
                      background: "var(--color-surface-2)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 6,
                      color: "var(--color-accent-text)",
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: "inherit",
                      padding: "5px 0",
                      cursor: "pointer",
                    }}
                  >
                    Reset to 100%
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Waiting status pill */}
        {status === "waiting" && (
          <span
            className="text-xs animate-pulse ml-1 shrink-0"
            style={{ color: "var(--color-accent)" }}
            aria-live="polite"
            aria-label="Waiting for you to play the correct note"
          >
            ● Waiting…
          </span>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Btn({
  onClick,
  title,
  "aria-label": ariaLabel,
  children,
  primary,
  disabled,
}: {
  onClick: () => void;
  title?: string;
  "aria-label"?: string;
  children: React.ReactNode;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`t-btn${primary ? " primary" : ""}`}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function ChipBtn({
  active,
  onClick,
  title,
  "aria-label": ariaLabel,
  "aria-pressed": ariaPressed,
  children,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  "aria-label"?: string;
  "aria-pressed"?: boolean;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      aria-pressed={ariaPressed}
      disabled={disabled}
      className="flex items-center gap-1 rounded text-xs font-medium transition-all shrink-0"
      style={{
        height: 28,
        padding: "0 8px",
        cursor: disabled ? "default" : "pointer",
        fontFamily: "inherit",
        ...(active
          ? {
              background: "var(--color-accent-subtle)",
              color: "var(--color-accent-text)",
              border: "1px solid var(--color-accent-subtle-border)",
            }
          : {
              background: "var(--color-surface-2)",
              color: "var(--color-text-muted)",
              border: "1px solid var(--color-border)",
            }),
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return (
    <div
      className="shrink-0"
      style={{ width: 1, height: 20, background: "var(--color-border)", margin: "0 2px" }}
    />
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const PlayIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const PauseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);
const StopIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
    <rect x="5" y="5" width="14" height="14" rx="1" />
  </svg>
);
const SkipBackIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
    <text x="12" y="16" fontSize="7" fontWeight="bold" textAnchor="middle" fontFamily="inherit">
      10
    </text>
  </svg>
);
const SkipFwdIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6v4l5-5-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8h-2z" />
    <text x="12" y="16" fontSize="7" fontWeight="bold" textAnchor="middle" fontFamily="inherit">
      10
    </text>
  </svg>
);
const UploadIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z" />
  </svg>
);
const SpinnerIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="currentColor"
    style={{ animation: "spin 1s linear infinite" }}
  >
    <path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z" />
  </svg>
);

const WaitIcon = () => (
  <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor">
    <rect x="3.5" y="10" width="13" height="7" rx="1.5" />
    <rect x="4" y="2.5" width="2.5" height="9" rx="1.25" />
    <rect x="7.5" y="1" width="2.5" height="10.5" rx="1.25" />
    <rect x="11" y="1.5" width="2.5" height="10" rx="1.25" />
    <rect x="14" y="4" width="2.5" height="7.5" rx="1.25" />
  </svg>
);

const LoopIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.68 14.72 20 13.41 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.32 9.28 4 10.59 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" />
  </svg>
);

const SpeedIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
    <path d="M7 2v11h3v9l7-12h-4l4-8z" />
  </svg>
);

const MetronomeIcon = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10 2L2 18h16L10 2z" />
    <line x1="10" y1="15" x2="13.5" y2="6" />
  </svg>
);
