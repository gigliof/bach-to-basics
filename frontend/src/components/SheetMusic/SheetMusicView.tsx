import { useEffect, useRef } from "react";
import bus from "../../engine/EventBus";
import { useAppStore } from "../../store/useAppStore";
import { syncEngine } from "../../engine/SyncEngine";
import { keySignatureToLabel } from "@bach-to-basics/shared";
import type { TempoEvent } from "@bach-to-basics/shared";

// T3-1: Defense-in-depth: strip potential XSS vectors from MusicXML before
// passing to AlphaTab.  AlphaTab likely renders SVG programmatically (safe),
// but this prevents exploitation if a future version changes that behavior.
// NOTE: CDATA sections are valid XML used by MusicXML for text content (tempo
// markings, lyrics, etc.) - they must NOT be stripped or AlphaTab receives
// malformed XML. AlphaTab processes MusicXML as data, not HTML, so CDATA
// poses no XSS risk here.
function sanitizeMusicXml(xml: string): string {
  return xml.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\bon\w+\s*=/gi, "data-removed=");
}

export function SheetMusicView() {
  const scrollRef = useRef<HTMLDivElement>(null); // outer overflow-auto container
  const containerRef = useRef<HTMLDivElement>(null); // inner AlphaTab host
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<any>(null);
  const playerReady = useRef(false); // true once soundFont is loaded
  const scoreLoaded = useRef(false); // true once score SVG is rendered
  const lastScrollTop = useRef(-1);
  const lastScrollMs = useRef(0);

  // ── AlphaTab init (runs once on mount) ──────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    let cleanupBus: (() => void) | null = null;

    import("@coderline/alphatab").then(({ AlphaTabApi }) => {
      if (!containerRef.current) return;

      const api = new AlphaTabApi(containerRef.current, {
        core: { engine: "svg", enableLazyLoading: false, logLevel: 0 },
        display: {
          layoutMode: 0, // page mode - vertical scroll
          scale: 0.9,
          // stretchForce 0 = notes keep their natural rhythmic proportions (like
          // a printed score).  A very small value (0.1) avoids a ragged right
          // edge on the last system without visibly compressing the spacing.
          stretchForce: 0.1,
          staveProfile: 0,
        },
        player: {
          // enablePlayer: true is required for cursor/highlight rendering.
          // We load the real soundfont so the player initialises fully, then
          // silence it via masterVolume=0 inside playerReady - our AudioEngine
          // handles all actual audio output.
          enablePlayer: true,
          enableCursor: true,
          enableUserInteraction: true,
          soundFont: "/soundfont/sonivox.sf3",
          scrollMode: 0, // we drive scrolling ourselves
        },
      } as never);

      apiRef.current = api;

      // ── Mute AlphaTab AFTER soundFont finishes loading ───────────────────
      try {
        api.playerReady.on(() => {
          playerReady.current = true;
          api.masterVolume = 0;
        });
      } catch {
        /* ignore */
      }

      // ── Mark score as rendered so cursor/scroll can activate ─────────────
      try {
        api.scoreLoaded.on(() => {
          scoreLoaded.current = true;
        });
      } catch {
        /* ignore */
      }

      // ── Load score if MusicXML is already available ──────────────────────
      const initialDoc = useAppStore.getState().document;
      if (initialDoc?.musicXml) {
        api.load(new TextEncoder().encode(sanitizeMusicXml(initialDoc.musicXml)));
      } else if (initialDoc?.mxlBuffer) {
        // .mxl is ZIP-compressed MusicXML; AlphaTab handles it natively
        api.load(new Uint8Array(initialDoc.mxlBuffer));
      }

      // ── Click note to play sound ─────────────────────────────────────────
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        api.beatMouseDown.on((beat: any) => {
          if (!beat?.notes?.length) return;
          for (const note of beat.notes) syncEngine.playMidi(note.realValue, 80);
          setTimeout(() => {
            for (const note of beat.notes) syncEngine.stopMidi(note.realValue);
          }, 500);
        });
      } catch {
        /* ignore */
      }

      // ── Transport tick: cursor position + scroll ─────────────────────────
      // IMPORTANT: do NOT close over `doc` here - it would always be null
      // (stale closure from first render). Always read fresh state instead.
      const onTick = ({ seconds }: { seconds: number; tick: number }) => {
        if (!apiRef.current || !playerReady.current || !scoreLoaded.current) return;

        // Always-fresh doc - avoids stale closure bug
        const doc = useAppStore.getState().document;
        if (!doc) return;

        const tick = secondsToTick(seconds, doc.tempoMap ?? [], doc.ppq ?? 480);
        try {
          apiRef.current.tickPosition = tick;
        } catch {
          return;
        }

        // Scroll cursor into view - throttled to ~4 fps to avoid jitter
        const now = performance.now();
        if (now - lastScrollMs.current < 250) return;
        lastScrollMs.current = now;

        requestAnimationFrame(() => {
          const scrollEl = scrollRef.current; // outer scroll container
          const innerEl = containerRef.current; // AlphaTab host (cursor lives here)
          if (!scrollEl || !innerEl) return;
          // AlphaTab renders absolutely-positioned cursor overlays inside innerEl
          const cursor =
            innerEl.querySelector<HTMLElement>(".at-cursor-beat") ??
            innerEl.querySelector<HTMLElement>(".at-cursor-bar");
          if (!cursor) return;
          // cursor position relative to the scrollable content area
          const cursorTop =
            cursor.getBoundingClientRect().top -
            scrollEl.getBoundingClientRect().top +
            scrollEl.scrollTop;
          const target = Math.max(0, cursorTop - scrollEl.clientHeight * 0.3);
          if (Math.abs(target - lastScrollTop.current) > 80) {
            lastScrollTop.current = target;
            scrollEl.scrollTo({ top: target, behavior: "smooth" });
          }
        });
      };

      bus.on("transport:tick", onTick as never);
      cleanupBus = () => bus.off("transport:tick", onTick as never);
    });

    return () => {
      cleanupBus?.();
      playerReady.current = false;
      scoreLoaded.current = false;
      if (apiRef.current) {
        try {
          apiRef.current.destroy();
        } catch {}
        apiRef.current = null;
      }
    };
  }, []); // intentionally empty - AlphaTab owns its own lifecycle

  // ── Load when MusicXML/mxlBuffer arrives after initial mount ────────────
  const { document: doc, settings } = useAppStore();
  const isDark = settings.theme === "dark";
  const keepWhite = isDark && settings.sheetMusicWhiteBackground;
  const invertSheet = isDark && !settings.sheetMusicWhiteBackground;

  // ── Adapt stretchForce to layout mode ────────────────────────────────────
  // "all" mode gives the sheet a narrow shared column, so we keep more
  // stretching (0.5) to fill each line.  In dedicated sheet mode we use
  // near-natural note spacing (0.1) for a printed-score look.
  // The value is stored in a ref so the load effect below can read it fresh.
  const stretchForceRef = useRef(0.1);
  // eslint-disable-next-line react-hooks/refs -- intentional: keeps ref in sync with derived state for effect to read fresh
  stretchForceRef.current = settings.layoutMode === "all" ? 0.5 : 0.1;

  useEffect(() => {
    // Re-render the current score when the user switches between layout modes.
    // api.load() (below) already reads stretchForceRef before each load, so we
    // only need an explicit render() here for live layout-mode switches.
    if (!apiRef.current || !scoreLoaded.current) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (apiRef.current.settings as any).display.stretchForce = stretchForceRef.current;
      apiRef.current.render();
    } catch {
      /* ignore */
    }
  }, [settings.layoutMode]);

  // ── Load score when MusicXML/mxlBuffer arrives ───────────────────────────
  useEffect(() => {
    if (!apiRef.current) return;
    // Apply the correct stretchForce before every load so AlphaTab uses it
    // in the render it triggers internally.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (apiRef.current.settings as any).display.stretchForce = stretchForceRef.current;
    } catch {
      /* ignore */
    }
    if (doc?.musicXml) {
      scoreLoaded.current = false;
      apiRef.current.load(new TextEncoder().encode(sanitizeMusicXml(doc.musicXml)));
    } else if (doc?.mxlBuffer) {
      // .mxl is ZIP-compressed MusicXML; AlphaTab handles it natively
      scoreLoaded.current = false;
      apiRef.current.load(new Uint8Array(doc.mxlBuffer));
    }
  }, [doc?.musicXml, doc?.mxlBuffer]);

  // Background logic:
  //   light / dark normal: radial gradient + var(--color-notes-bg), matching FallingNotesView
  //   dark + keep white: explicit #fff so black notation stays readable on white
  // The gradient (7% purple at bottom-center to transparent) is the same subtle glow used
  // by FallingNotesView and PianoModeBackground, keeping all canvas areas visually consistent.
  const scrollBg = keepWhite
    ? "#ffffff"
    : "radial-gradient(ellipse at 50% 100%, rgba(147,51,234,0.07) 0%, transparent 65%), var(--color-notes-bg)";

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-auto"
      style={{
        background: scrollBg,
        minHeight: 0,
        borderTop: "1px solid var(--color-notes-border)",
      }}
    >
      {/*
        Page-width wrapper - centres the score and caps it at ~A4 screen width
        (900 px).  On wide monitors this creates margins on both sides so the
        score never looks like a stretched banner; on narrow screens it fills
        the full width just like before.  position:relative is needed so the
        key-signature badge stays anchored inside the content column.
      */}
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "8px 16px", position: "relative" }}>
        <div ref={containerRef} className={invertSheet ? "sheet-dark-invert" : ""} />

        {settings.showKeySignature && doc?.keySignature && settings.layoutMode !== "all" && (
          <div
            className="absolute top-2 right-4 z-10 pointer-events-none text-xs px-2 py-0.5 rounded"
            style={{
              background: keepWhite ? "#f5f7fb" : "var(--color-surface-2)",
              border: `1px solid ${keepWhite ? "#dde1ea" : "var(--color-border)"}`,
              color: keepWhite ? "#64748b" : "var(--color-text-muted)",
              letterSpacing: "0.03em",
            }}
          >
            {keySignatureToLabel(doc.keySignature)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// AlphaTab uses 960 ticks per quarter note internally, regardless of the MIDI file's PPQ.
// This function converts playback seconds to AlphaTab internal ticks (960 PPQ output).
// The tempo map uses MIDI-file ticks for segment boundaries, so we still need `ppq`
// to convert those boundaries to seconds, but the output is always in 960-PPQ space.
const AT_PPQ = 960;

function secondsToTick(targetSec: number, tempoMap: TempoEvent[], ppq: number): number {
  if (!tempoMap.length) return Math.round(targetSec * 2 * AT_PPQ);
  let atTick = 0; // accumulated output in AlphaTab 960-PPQ ticks
  let remainingSec = targetSec;

  for (let i = 0; i < tempoMap.length; i++) {
    const ev = tempoMap[i];
    const next = tempoMap[i + 1];

    // seconds per MIDI tick at this tempo
    const secPerMidiTick = 60 / (ev.bpm * ppq);
    // AlphaTab ticks per MIDI tick (scale factor between file PPQ and AT PPQ)
    const atPerMidi = AT_PPQ / ppq;

    if (next) {
      const midiSpan = next.tick - ev.tick; // segment length in MIDI ticks
      const secSpan = midiSpan * secPerMidiTick;
      if (remainingSec <= secSpan) {
        atTick += Math.round((remainingSec / secPerMidiTick) * atPerMidi);
        return atTick;
      }
      remainingSec -= secSpan;
      atTick += Math.round(midiSpan * atPerMidi);
    } else {
      // Last segment - extends to end of piece
      atTick += Math.round((remainingSec / secPerMidiTick) * atPerMidi);
      return atTick;
    }
  }
  return atTick;
}
