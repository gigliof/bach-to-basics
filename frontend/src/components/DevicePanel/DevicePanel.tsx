import { useEffect, useRef, useState } from "react";
import { WebMidi } from "webmidi";
import { syncEngine } from "../../engine/SyncEngine";
import { useAppStore } from "../../store/useAppStore";

export function DevicePanel() {
  const [inputs, setInputs] = useState<string[]>([]);
  const [midiStatus, setMidiStatus] = useState<"idle" | "enabled" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const { midiDeviceName, setMidiDevice } = useAppStore();

  useEffect(() => {
    WebMidi.enable({ sysex: false })
      .then(() => {
        setMidiStatus("enabled");
        setInputs(WebMidi.inputs.map((i) => i.name));
        WebMidi.addListener("connected", () => setInputs(WebMidi.inputs.map((i) => i.name)));
        WebMidi.addListener("disconnected", (e) => {
          setInputs(WebMidi.inputs.map((i) => i.name));
          if (e.port.name === midiDeviceName) setMidiDevice(null);
        });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(
          !navigator.requestMIDIAccess
            ? "Web MIDI not supported. Use Chrome or Edge."
            : `MIDI access denied. Check browser permissions. (${msg})`
        );
        setMidiStatus("error");
      });

    return () => {
      try { WebMidi.removeListener("connected"); } catch {}
      try { WebMidi.removeListener("disconnected"); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        !chipRef.current?.contains(e.target as Node) &&
        !popoverRef.current?.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const connectDevice = (name: string) => {
    if (midiDeviceName) {
      try { WebMidi.getInputByName(midiDeviceName)?.removeListener(); } catch {}
    }
    const input = WebMidi.getInputByName(name);
    if (!input) return;
    input.addListener("noteon", (e) => syncEngine.onMidiInput(e.note.number, e.rawValue ?? 64));
    input.addListener("noteoff", (e) => syncEngine.onMidiInputOff(e.note.number));
    setMidiDevice(name);
    setOpen(false);
  };

  const disconnect = () => {
    if (midiDeviceName) {
      try { WebMidi.getInputByName(midiDeviceName)?.removeListener(); } catch {}
    }
    setMidiDevice(null);
    setOpen(false);
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
    <div className="relative shrink-0">
      {/* Chip button */}
      <button
        ref={chipRef}
        onClick={() => setOpen((v) => !v)}
        title={connected ? `Connected: ${midiDeviceName}` : "Select MIDI input device"}
        className="flex items-center gap-2 text-xs font-semibold transition-colors shrink-0"
        style={{
          background: connected ? "rgba(34,197,94,0.08)" : "var(--color-warning-subtle)",
          border: connected ? "1px solid rgba(34,197,94,0.5)" : "1px solid var(--color-warning-border)",
          color: connected ? "#4ade80" : "var(--color-warning)",
          cursor: "pointer",
          maxWidth: 200,
          borderRadius: 999,
          fontSize: 12,
          padding: connected ? "4px 10px" : "5px 12px",
        }}
      >
        {connected ? (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: "#4ade80", boxShadow: "0 0 6px #4ade80" }}
          />
        ) : (
          <span style={{ fontSize: 11, lineHeight: 1, flexShrink: 0 }}>⚠</span>
        )}
        <span
          className="truncate"
          style={{ maxWidth: 130 }}
        >
          {connected ? midiDeviceName : "No MIDI device"}
        </span>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0 }}>
          <path d="M7 10l5 5 5-5z"/>
        </svg>
      </button>

      {/* Popover */}
      {open && (
        <div
          ref={popoverRef}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 200,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            zIndex: 100,
            overflow: "hidden",
          }}
        >
          <div
            className="px-3 py-2 text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--color-text-muted)", borderBottom: "1px solid var(--color-border)" }}
          >
            MIDI Input
          </div>

          {inputs.length === 0 ? (
            <div className="px-3 py-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
              No MIDI devices found.
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: "4px 0" }}>
              {inputs.map((name) => {
                const isActive = name === midiDeviceName;
                return (
                  <li key={name}>
                    <button
                      onClick={() => connectDevice(name)}
                      className="w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2"
                      style={{
                        background: isActive ? "rgba(99,102,241,0.12)" : "transparent",
                        color: isActive ? "var(--color-accent)" : "var(--color-text)",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: isActive ? "#4ade80" : "var(--color-border)" }}
                      />
                      <span className="truncate">{name}</span>
                      {isActive && (
                        <span className="ml-auto text-xs" style={{ color: "#4ade80" }}>✓</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {connected && (
            <div style={{ borderTop: "1px solid var(--color-border)", padding: "4px 0" }}>
              <button
                onClick={disconnect}
                className="w-full text-left px-3 py-2 text-xs transition-colors"
                style={{ background: "transparent", color: "#f87171", border: "none", cursor: "pointer" }}
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
