import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../../store/useAppStore";
import { loopTime } from "../../utils/loopRange";
import "./loop-controls.css";

export function LoopControls() {
  const { document: doc, loopStart, loopEnd, currentSeconds, setLoopPoints } = useAppStore();
  const total = doc?.totalDuration ?? 0;
  const active = loopStart !== null && loopEnd !== null;
  const start = loopStart ?? 0;
  const end = loopEnd ?? total;
  const gap = Math.min(.1, total);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null);
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const open = position !== null && openedFor === doc?.id;
  const close = () => { setPosition(null); trigger.current?.focus(); };
  const move = (edge: "start" | "end", value: number) => {
    if (edge === "start") setLoopPoints(Math.max(0, Math.min(end - gap, value)), end);
    else setLoopPoints(start, Math.min(total, Math.max(start + gap, value)));
  };
  const show = () => {
    if (open) { close(); return; }
    if (!total || !trigger.current) return;
    if (!active) {
      const a = Math.max(0, Math.min(currentSeconds, total - gap));
      setLoopPoints(a, Math.min(total, a + 30));
    }
    const rect = trigger.current.getBoundingClientRect();
    setPosition({ left: Math.max(12, Math.min(window.innerWidth - 372, rect.left - 100)), bottom: window.innerHeight - rect.top + 10 });
    setOpenedFor(doc!.id);
  };
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLInputElement>('input')?.focus();
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setPosition(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setPosition(null); trigger.current?.focus(); }
    };
    const reposition = () => setPosition(null);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  return <>
    <div className="loop-control-group">
      <button disabled={!active} onClick={() => move("start", currentSeconds)} title="Set loop start (A) to current position" aria-label="Set loop start to current position">A</button>
      <button ref={trigger} disabled={total <= 0} onClick={show} aria-label="Adjust loop range" aria-expanded={open} aria-haspopup="dialog" title="Adjust loop start and end" className={active ? "loop-active" : ""}>
        ↻ {active ? `${loopTime(start)}–${loopTime(end)}` : "Loop"}
      </button>
      <button disabled={!active} onClick={() => move("end", currentSeconds)} title="Set loop end (B) to current position" aria-label="Set loop end to current position">B</button>
    </div>
    {open && createPortal(
      <div ref={panel} className="loop-editor" role="dialog" aria-label="Adjust loop range" style={{ left: position.left, bottom: position.bottom }}>
        <div className="loop-editor-heading"><strong>Loop range</strong><button aria-label="Close loop editor" onClick={close}>✕</button></div>
        <p>Drag A and B to choose the section to repeat.</p>
        <div className="loop-times"><label htmlFor="loop-start-slider">A · <output aria-label="Loop start time">{loopTime(start)}</output></label><label htmlFor="loop-end-slider">B · <output aria-label="Loop end time">{loopTime(end)}</output></label></div>
        <div className="loop-range-track">
          <div className="loop-range-line" />
          <div className="loop-range-selection" style={{ left: `${start / total * 100}%`, width: `${(end - start) / total * 100}%` }} />
          <input id="loop-start-slider" type="range" className="loop-range-input" aria-label="Loop start" aria-valuetext={loopTime(start)} min={0} max={total} step="any" value={start} onChange={(event) => move("start", Number(event.target.value))} onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); move("start", start + (event.key === "ArrowRight" ? .1 : -.1)); }
          }} />
          <input id="loop-end-slider" type="range" className="loop-range-input" aria-label="Loop end" aria-valuetext={loopTime(end)} min={0} max={total} step="any" value={end} onChange={(event) => move("end", Number(event.target.value))} onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); move("end", end + (event.key === "ArrowRight" ? .1 : -.1)); }
          }} />
        </div>
        <div className="loop-track-labels"><span>0:00</span><span>{loopTime(total)}</span></div>
        <div className="loop-editor-actions"><button onClick={() => { setLoopPoints(null, null); close(); }}>Turn loop off</button><button onClick={() => setLoopPoints(0, total)}>Whole song</button><button className="loop-done" onClick={close}>Done</button></div>
      </div>, document.body,
    )}
  </>;
}
