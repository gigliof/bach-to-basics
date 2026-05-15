import { useEffect, useRef, useState } from "react";
import bus from "../../engine/EventBus";
import { PianoKeyboard } from "./PianoKeyboard";
import { useAppStore, COLOR_PRESET_VALUES } from "../../store/useAppStore";
import { syncEngine } from "../../engine/SyncEngine";
import type { NoteEvent } from "@bach-to-basics/shared";

const KEYBOARD_HEIGHT = 160;

export function PianoKeyboardView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const kbRef = useRef<PianoKeyboard | null>(null);
  /** Flips true once PixiJS has finished drawing the keys; we fade the canvas in
   *  and the skeleton out at that point. Avoids the brief "black bar" flash. */
  const [pianoReady, setPianoReady] = useState(false);
  const { settings } = useAppStore();

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || window.innerWidth;

    const themeColors =
      settings.colorTheme === "custom"
        ? settings.customColors
        : COLOR_PRESET_VALUES[settings.colorTheme];

    const kb = new PianoKeyboard(canvasRef.current, {
      width,
      height: KEYBOARD_HEIGHT,
      noteLabelMode: settings.noteLabelMode,
      pianoTheme: settings.pianoTheme,
      showFingering: settings.showFingering,
      showHandColors: settings.showHandColors,
      useFlats: settings.useFlats,
      customColors: themeColors,
      onKeyPress: (midi) => {
        // playMidi loads audio if needed, plays sound, and emits input:note:on
        syncEngine.playMidi(midi, 90);
      },
      onKeyRelease: (midi) => {
        syncEngine.stopMidi(midi);
      },
    });
    kbRef.current = kb;
    // init() is async (awaits PIXI.Application.init() internally).
    // Flip the ready flag once it resolves so the skeleton can fade out.
    kb.init(canvasRef.current).then(() => setPianoReady(true));

    const onNoteOn = (note: NoteEvent) => kb.noteOn(note, "playback");
    const onNoteOff = (note: NoteEvent) => kb.noteOff(note, "playback");
    const onInputOn = ({ midi }: { midi: number; velocity: number }) => kb.inputNoteOn(midi);
    const onInputOff = ({ midi }: { midi: number }) => kb.inputNoteOff(midi);
    const onStateChange = ({ status }: { status: string; seconds: number }) => {
      if (status === "stopped") kb.reset();
    };
    const onSeek = () => kb.reset();

    bus.on("note:on", onNoteOn as never);
    bus.on("note:off", onNoteOff as never);
    bus.on("input:note:on", onInputOn as never);
    bus.on("input:note:off", onInputOff as never);
    bus.on("transport:stateChange", onStateChange as never);
    bus.on("transport:seek", onSeek as never);

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      if (w > 0 && kbRef.current) kbRef.current.resize(w, KEYBOARD_HEIGHT);
    });
    ro.observe(container);

    return () => {
      bus.off("note:on", onNoteOn as never);
      bus.off("note:off", onNoteOff as never);
      bus.off("input:note:on", onInputOn as never);
      bus.off("input:note:off", onInputOff as never);
      bus.off("transport:stateChange", onStateChange as never);
      bus.off("transport:seek", onSeek as never);
      ro.disconnect();
      kb.destroy();
      kbRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    kbRef.current?.setOptions({
      noteLabelMode: settings.noteLabelMode,
      pianoTheme: settings.pianoTheme,
      showFingering: settings.showFingering,
      showHandColors: settings.showHandColors,
      useFlats: settings.useFlats,
      customColors:
        settings.colorTheme === "custom"
          ? settings.customColors
          : COLOR_PRESET_VALUES[settings.colorTheme],
    });
  }, [
    settings.noteLabelMode,
    settings.pianoTheme,
    settings.showFingering,
    settings.showHandColors,
    settings.useFlats,
    settings.colorTheme,
    settings.customColors,
  ]);

  return (
    <div
      ref={containerRef}
      className="w-full"
      style={{
        height: KEYBOARD_HEIGHT,
        // Dark keybed: shows through key gaps and as the pressed-key hinge -
        // matches the look of a real piano's wooden frame regardless of app theme.
        background: "#0d0d10",
        flexShrink: 0,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Skeleton: matches the falling-notes pane above so the piano slot looks
          like one continuous panel until PixiJS finishes drawing the keys.
          We replicate the falling-notes background EXACTLY (base color + the same
          purple radial gradient), but mirror the gradient anchor to `50% 0%` so the
          brightest tint is at the TOP of the skeleton - meeting the brightest tint
          at the BOTTOM of the falling-notes pane. Result: no color seam at the boundary.
          Note: only this overlay's color matches the falling-notes pane - the piano
          container's `#0d0d10` background (the dark "wooden frame" that shows through
          key gaps after init) is intentionally NOT changed. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(147,51,234,0.07) 0%, transparent 65%), " +
            (settings.theme === "dark" ? "#141428" : "#eef1fa"),
          opacity: pianoReady ? 0 : 1,
          transition: "opacity 0.2s ease-out",
          pointerEvents: "none",
        }}
      />
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          position: "relative",
          opacity: pianoReady ? 1 : 0,
          transition: "opacity 0.15s ease-in",
        }}
      />
    </div>
  );
}
