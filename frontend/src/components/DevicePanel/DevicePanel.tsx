import { useEffect, useRef, useState } from "react";
import "./device-panel.css";
import { WebMidi } from "webmidi";
import { MidiInputSelection } from "../../engine/MidiInputSelection";
import { syncEngine } from "../../engine/SyncEngine";
import { useAppStore } from "../../store/useAppStore";

export function DevicePanel() {
  const [inputs, setInputs] = useState<{ id: string; name: string }[]>([]);
  const [midiStatus, setMidiStatus] = useState<"idle" | "enabled" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const { midiDeviceName, setMidiDevice } = useAppStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectionRef = useRef<MidiInputSelection | null>(null);

  useEffect(() => {
    let cancelled = false;
    const selection = new MidiInputSelection({
      changed: (available, selected) => {
        if (cancelled) return;
        setInputs(available.map(({ id, name }) => ({ id, name })));
        setSelectedId(selected?.id ?? null);
        setMidiDevice(selected?.name ?? null);
      },
      noteOn: (note, velocity) => {
        void syncEngine.wakeAudio();
        void syncEngine.playMidi(note, velocity).catch((err) => {
          console.error("MIDI input audio failed:", err);
        });
      },
      noteOff: (note) => syncEngine.stopMidi(note),
    });
    selectionRef.current = selection;
    const refresh = () => selection.refresh(WebMidi.inputs);
    WebMidi.enable({ sysex: false })
      .then(() => {
        if (cancelled) return;
        setMidiStatus("enabled");
        WebMidi.addListener("portschanged", refresh);
        refresh();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(
          !navigator.requestMIDIAccess
            ? "Web MIDI not supported. Use Chrome or Edge."
            : `MIDI access denied. Check browser permissions. (${msg})`
        );
        setMidiStatus("error");
      });

    return () => {
      cancelled = true;
      WebMidi.removeListener("portschanged", refresh);
      selection.dispose();
      selectionRef.current = null;
      setMidiDevice(null);
    };
  }, [setMidiDevice]);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        !chipRef.current?.contains(e.target as Node) &&
        !popoverRef.current?.contains(e.target as Node)
      ) setOpen(false);
    };
    const focusOutside = (event: FocusEvent) => {
      if (!popoverRef.current?.contains(event.target as Node) && !chipRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const first = popoverRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? popoverRef.current?.querySelector<HTMLButtonElement>("button");
    (first ?? popoverRef.current)?.focus();
    document.addEventListener("mousedown", handler);
    document.addEventListener("focusin", focusOutside);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("focusin", focusOutside);
    };
  }, [open]);

  const connectDevice = (id: string) => {
    selectionRef.current?.select(id);
    void syncEngine.wakeAudio();
    setOpen(false);
    chipRef.current?.focus();
  };

  const disconnect = () => {
    selectionRef.current?.disconnect();
    setOpen(false);
    chipRef.current?.focus();
  };

  // Error state
  if (midiStatus === "error") {
    return (
      <div
        className="text-xs px-2 py-1 rounded cursor-help shrink-0"
        title={errorMsg ?? "MIDI error"}
        style={{ color: "var(--color-warning)", background: "var(--color-warning-subtle)", border: "1px solid var(--color-warning-border)" }}
      >
        ⚠ MIDI
      </div>
    );
  }

  // Not yet initialized
  if (midiStatus === "idle") return null;

  const connected = !!midiDeviceName;

  return (
    <div className="midi-device-control">
      <button
        ref={chipRef}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); event.stopPropagation(); setOpen(true); }
          if (event.key === "Escape") setOpen(false);
        }}
        title={connected ? `Connected: ${midiDeviceName}` : "Select MIDI input device"}
        aria-label="Choose MIDI instrument"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? "midi-input-picker" : undefined}
        className={`midi-device-chip ${connected ? "is-connected" : ""}`}
      >
        <span className="midi-status-dot" />
        <span className="midi-chip-name">{connected ? midiDeviceName : "MIDI input"}</span>
        <svg className="midi-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
      </button>
      {open && (
        <div
          ref={popoverRef}
          id="midi-input-picker"
          role="dialog"
          aria-label="MIDI input"
          tabIndex={-1}
          className="midi-input-popover"
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") { event.preventDefault(); setOpen(false); chipRef.current?.focus(); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              buttons[(index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
            }
          }}
        >
          <div className="midi-picker-heading">
            <span className="midi-heading-icon"><KeyboardIcon /></span>
            <div><h2>MIDI input</h2><p>Choose your instrument</p></div>
          </div>
          {inputs.length === 0 ? (
            <div className="midi-empty-state" role="status">
              <strong>No instruments detected</strong>
              <p>Connect your keyboard with USB or MIDI. It will appear here automatically.</p>
            </div>
          ) : (
            <ul className="midi-device-list">
              {inputs.map(({ id, name }) => {
                const isActive = id === selectedId;
                return <li key={id}>
                  <button className={`midi-device-row ${isActive ? "is-selected" : ""}`} aria-pressed={isActive} onClick={() => connectDevice(id)}>
                    <KeyboardIcon />
                    <span className="midi-device-info"><strong title={name}>{name}</strong><small>{isActive ? "Connected" : "Available"}</small></span>
                    {isActive && <svg className="midi-selected-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>}
                  </button>
                </li>;
              })}
            </ul>
          )}
          {connected && <div className="midi-picker-footer">
            <button className="midi-disconnect" onClick={disconnect}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3v9M7 5.7a8 8 0 1 0 10 0" /></svg>
              Disconnect
            </button>
          </div>}
        </div>
      )}
    </div>
  );
}

function KeyboardIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M9 5v14m6-14v14M8 5v7h2V5m4 0v7h2V5" /></svg>;
}
