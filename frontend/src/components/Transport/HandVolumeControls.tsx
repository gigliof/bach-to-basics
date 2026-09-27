import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../../store/useAppStore";
import "./hand-volume.css";

export function HandVolumeControls() {
  const { settings, updateSettings } = useAppStore();
  const linked = settings.handVolumesLinked;
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => { setPosition(null); button.current?.focus(); };
  const adjust = (hand: "left" | "right", value: number) => {
    const volume = Math.max(0, Math.min(1, value));
    const current = useAppStore.getState().settings.handVolume;
    updateSettings({ handVolume: linked ? { left: volume, right: volume } : { ...current, [hand]: volume } });
  };
  useEffect(() => {
    if (!position) return;
    panel.current?.querySelector<HTMLInputElement>('input')?.focus();
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setPosition(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setPosition(null); button.current?.focus(); }
    };
    const resize = () => setPosition(null);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", resize);
    };
  }, [position]);

  return <>
    <button ref={button} className="hand-volume-button" aria-label="Adjust hand volumes" aria-expanded={!!position} aria-haspopup="dialog" title="Adjust left and right hand volume" onClick={() => {
      if (position) { close(); return; }
      const rect = button.current!.getBoundingClientRect();
      setPosition({ left: Math.max(12, Math.min(window.innerWidth - 252, rect.left - 102)), bottom: window.innerHeight - rect.top + 10 });
    }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 3v18M12 3v18M19 3v18"/><path d="M2 8h6M9 16h6M16 7h6" strokeWidth="4" strokeLinecap="round"/></svg>
    </button>
    {position && createPortal(<div ref={panel} className="hand-volume-panel" role="dialog" aria-label="Hand volumes" style={position}>
      <div className="hand-volume-heading"><strong>Hand volume</strong><button onClick={close} aria-label="Close hand volumes">✕</button></div>
      <div className="hand-volume-sliders">
        {(["left", "right"] as const).map((hand) => <div className="hand-volume-column" key={hand}>
          <label htmlFor={`quick-${hand}-volume`} style={{ color: `var(--color-${hand}-hand-text)` }}>{hand === "left" ? "Left" : "Right"}</label>
          <div className="hand-volume-rail">
            <input id={`quick-${hand}-volume`} aria-label={`${hand === "left" ? "Left" : "Right"} hand volume slider`} aria-orientation="vertical" aria-valuetext={`${Math.round(settings.handVolume[hand] * 100)}%`} type="range" min={0} max={1} step={.01} value={settings.handVolume[hand]} onChange={(event) => adjust(hand, Number(event.target.value))} style={{ accentColor: `var(--color-${hand}-hand-text)` }} />
          </div>
          <output aria-label={`${hand} hand volume level`}>{Math.round(settings.handVolume[hand] * 100)}%</output>
          <span className="hand-volume-mute-state">{settings.activeHands.has(hand) ? "" : "Muted"}</span>
        </div>)}
      </div>
      <button className={`hand-volume-link ${linked ? "is-linked" : ""}`} aria-label="Link hand volumes" aria-pressed={linked} onClick={() => updateSettings({ handVolumesLinked: !linked })}>{linked ? "↔ Hands linked" : "↔ Link hands"}</button>
      <p>{linked ? "Move either slider to adjust both hands." : "Adjust each hand independently."}</p>
    </div>, document.body)}
  </>;
}
