import { useEffect, useRef } from "react";
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
  const { settings } = useAppStore();

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || window.innerWidth;

    const themeColors = settings.colorTheme === "custom"
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
    kb.init(canvasRef.current);

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
      customColors: settings.colorTheme === "custom"
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
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}
