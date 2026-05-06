import { useEffect, useRef, useMemo } from "react";
import bus from "../../engine/EventBus";
import { FallingNotesRenderer } from "./FallingNotesRenderer";
import { useAppStore } from "../../store/useAppStore";
import { computeMeasureSeconds, computeBeatSeconds } from "@bach-to-basics/shared";
import type { NoteEvent } from "@bach-to-basics/shared";
import { useAccuracy } from "../../hooks/useAccuracy";

export function FallingNotesView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<FallingNotesRenderer | null>(null);
  const lastSecondsRef = useRef(0);
  const { settings, document: doc, midiEnabled, status, seek } = useAppStore();

  // Accuracy scoring - active when MIDI device connected
  const accuracy = useAccuracy(midiEnabled && (status === "playing" || status === "paused"));

  const measureStarts = useMemo(
    () => doc ? computeMeasureSeconds(doc.timeSignatures, doc.tempoMap, doc.ppq, doc.totalDuration) : [],
    [doc]
  );

  const beatStarts = useMemo(
    () => doc ? computeBeatSeconds(doc.timeSignatures, doc.tempoMap, doc.ppq, doc.totalDuration) : [],
    [doc]
  );

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || 400;

    const renderer = new FallingNotesRenderer({
      width,
      height,
      viewportSeconds: settings.viewportSeconds,
      fallingNotesLabelMode: settings.fallingNotesLabelMode,
      showFingering: settings.showFingering,
      showHandColors: settings.showHandColors,
      useFlats: settings.useFlats,
      noteFilter: settings.noteFilter,
      colorTheme: settings.colorTheme,
      customColors: settings.customColors,
      showGrid: settings.showGrid,
      showMeasureNums: settings.showMeasureNums,
      measureStarts,
      impactStyle: settings.impactStyle,
      minNoteHeight: settings.minNoteHeight,
      noteCornerRadius: settings.noteCornerRadius,
      showBeatLines: settings.showBeatLines,
      beatStarts,
      showSustainPedal: settings.showSustainPedal,
      sustainRanges: doc?.sustainRanges,
      showNoteOutline: settings.showNoteOutline,
      showSustainedNotes: settings.showSustainedNotes,
      darkMode: settings.theme === "dark",
    });
    rendererRef.current = renderer;
    renderer.init(canvasRef.current);

    const onUpcoming = (note: NoteEvent) => renderer.addNote(note, lastSecondsRef.current);
    const onTick = ({ seconds }: { seconds: number; tick: number }) => {
      lastSecondsRef.current = seconds;
      renderer.tick(seconds);
    };
    let prevStatus = "stopped";
    const onStateChange = ({ status }: { status: string }) => {
      if (status === "stopped") renderer.reset();
      if (status === "playing" && prevStatus === "stopped") renderer.fadeIn();
      prevStatus = status;
    };
    const onSeek = () => renderer.reset();

    bus.on("note:upcoming", onUpcoming as never);
    bus.on("transport:tick", onTick as never);
    bus.on("transport:stateChange", onStateChange as never);
    bus.on("transport:seek", onSeek as never);

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0 && rendererRef.current) rendererRef.current.resize(w, h);
    });
    ro.observe(container);

    return () => {
      bus.off("note:upcoming", onUpcoming as never);
      bus.off("transport:tick", onTick as never);
      bus.off("transport:stateChange", onStateChange as never);
      bus.off("transport:seek", onSeek as never);
      ro.disconnect();
      renderer.destroy();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push setting changes into the renderer without remounting
  useEffect(() => {
    rendererRef.current?.setOptions({
      viewportSeconds: settings.viewportSeconds,
      fallingNotesLabelMode: settings.fallingNotesLabelMode,
      showFingering: settings.showFingering,
      showHandColors: settings.showHandColors,
      useFlats: settings.useFlats,
      noteFilter: settings.noteFilter,
      colorTheme: settings.colorTheme,
      customColors: settings.customColors,
      showGrid: settings.showGrid,
      showMeasureNums: settings.showMeasureNums,
      measureStarts,
      impactStyle: settings.impactStyle,
      minNoteHeight: settings.minNoteHeight,
      noteCornerRadius: settings.noteCornerRadius,
      showBeatLines: settings.showBeatLines,
      beatStarts,
      showSustainPedal: settings.showSustainPedal,
      sustainRanges: doc?.sustainRanges,
      showNoteOutline: settings.showNoteOutline,
      showSustainedNotes: settings.showSustainedNotes,
      darkMode: settings.theme === "dark",
    });
  }, [
    settings.viewportSeconds,
    settings.fallingNotesLabelMode,
    settings.showFingering,
    settings.showHandColors,
    settings.useFlats,
    settings.noteFilter,
    settings.colorTheme,
    settings.customColors,
    settings.showGrid,
    settings.showMeasureNums,
    settings.impactStyle,
    measureStarts,
    settings.minNoteHeight,
    settings.noteCornerRadius,
    settings.showBeatLines,
    beatStarts,
    settings.showSustainPedal,
    doc?.sustainRanges,
    settings.showNoteOutline,
    settings.showSustainedNotes,
    settings.theme,
  ]);

  const handleWheel = (e: React.WheelEvent) => {
    if (!doc || !settings.scrollToSeek) return;
    // Seek forward/backward by 30% of the viewport window per scroll tick
    const delta = (e.deltaY > 0 ? 1 : -1) * settings.viewportSeconds * 0.3;
    const next = Math.max(0, Math.min(doc.totalDuration, useAppStore.getState().currentSeconds + delta));
    seek(next);
  };

  return (
    <div
      ref={containerRef}
      className="w-full flex-1 relative"
      onWheel={handleWheel}
      style={{
        minHeight: 200,
        background: "radial-gradient(ellipse at 50% 100%, rgba(147,51,234,0.07) 0%, transparent 65%), var(--color-notes-bg)",
        borderTop: "1px solid var(--color-notes-border)",
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />

      {midiEnabled && (accuracy.correct + accuracy.wrong + accuracy.missed) > 0 && (
        <div
          className="absolute top-2 left-2 z-10 pointer-events-none text-xs px-2 py-0.5 rounded-full font-medium"
          style={{
            background: accuracy.score >= 80 ? "rgba(34,197,94,0.12)" : accuracy.score >= 50 ? "rgba(234,179,8,0.12)" : "rgba(239,68,68,0.12)",
            color:      accuracy.score >= 80 ? "#4ade80"               : accuracy.score >= 50 ? "#eab308"              : "#ef4444",
            border:     "1px solid currentColor",
          }}
        >
          <TargetIcon /> {accuracy.score}%
        </div>
      )}
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const TargetIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: "inline", verticalAlign: "middle", marginBottom: 1 }} aria-hidden="true">
    <circle cx="12" cy="12" r="9"/>
    <circle cx="12" cy="12" r="5"/>
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>
  </svg>
);
