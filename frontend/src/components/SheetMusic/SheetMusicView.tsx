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
  // Horizontal "all" mode: a rAF lerp loop slides scrollLeft toward this target
  // every frame for continuous, buttery score-following (instead of stepped
  // bar-to-bar jumps). onTick updates the target; the loop animates toward it.
  const scrollTargetRef = useRef(0);
  const rafScrollId = useRef<number | null>(null);

  // ── AlphaTab init (runs once on mount) ──────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    let cleanupBus: (() => void) | null = null;

    import("@coderline/alphatab").then(({ AlphaTabApi }) => {
      if (!containerRef.current) return;

      // In the "all" view the sheet sits in a full-width band at the top and
      // renders as a single horizontal strip (layoutMode 1) that scrolls
      // left->right following playback. The dedicated "Sheet" mode keeps page
      // mode (vertical, multi-line) which is better for reading a full score.
      // SheetMusicView mounts fresh per layout mode (not a singleton), so reading
      // the mode once at init is safe for this instance's lifetime.
      const horizontal = useAppStore.getState().settings.layoutMode === "all";

      const api = new AlphaTabApi(containerRef.current, {
        core: { engine: "svg", enableLazyLoading: false, logLevel: 0 },
        display: {
          layoutMode: horizontal ? 1 : 0, // 1 = horizontal strip, 0 = page (vertical)
          // Smaller scale in the horizontal "all" band so the full grand staff
          // (both clefs) fits the short band height without the bass clef being
          // clipped. Page mode keeps the larger, more readable 0.9.
          scale: horizontal ? 0.62 : 0.9,
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

      // ── Continuous horizontal scroll loop (lerp toward scrollTargetRef) ────
      // In horizontal mode the strip glides smoothly under the cursor instead of
      // jumping bar to bar. The 0.12 factor is a gentle chase (~0.13s) that also
      // averages out the ~8 fps cursor steps into continuous motion. Gated: the
      // loop self-stops once paused AND settled; onTick (which only fires while
      // playing, plus once on seek) restarts it via ensureScrollLoop().
      const lerpScroll = () => {
        const scrollEl = scrollRef.current;
        let settling = false;
        if (scrollEl) {
          const diff = scrollTargetRef.current - scrollEl.scrollLeft;
          if (Math.abs(diff) > 0.5) {
            scrollEl.scrollLeft += diff * 0.12;
            settling = true;
          }
        }
        if (useAppStore.getState().status === "playing" || settling) {
          rafScrollId.current = requestAnimationFrame(lerpScroll);
        } else {
          rafScrollId.current = null; // idle - stop until the next tick kicks it
        }
      };
      const ensureScrollLoop = () => {
        if (rafScrollId.current === null) rafScrollId.current = requestAnimationFrame(lerpScroll);
      };

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

        // Update scroll to follow the cursor. Horizontal mode sets a lerp target
        // (the rAF loop animates toward it for a continuous glide); page mode
        // does a throttled jump with the browser's smooth-scroll.
        requestAnimationFrame(() => {
          const scrollEl = scrollRef.current; // outer scroll container
          const innerEl = containerRef.current; // AlphaTab host (cursor lives here)
          if (!scrollEl || !innerEl) return;
          // AlphaTab renders absolutely-positioned cursor overlays inside innerEl
          const cursor =
            innerEl.querySelector<HTMLElement>(".at-cursor-beat") ??
            innerEl.querySelector<HTMLElement>(".at-cursor-bar");
          if (!cursor) return;
          const cRect = cursor.getBoundingClientRect();
          const sRect = scrollEl.getBoundingClientRect();

          if (horizontal) {
            // Absolute content x of the cursor; keep it ~40% from the left so
            // there's lookahead. The rAF loop slides scrollLeft toward this.
            const cursorLeft = cRect.left - sRect.left + scrollEl.scrollLeft;
            scrollTargetRef.current = Math.max(0, cursorLeft - scrollEl.clientWidth * 0.4);
            ensureScrollLoop();
          } else {
            // Page mode: throttled (~4 fps) jump, keep cursor at ~30% from top.
            const now = performance.now();
            if (now - lastScrollMs.current < 250) return;
            lastScrollMs.current = now;
            const cursorTop = cRect.top - sRect.top + scrollEl.scrollTop;
            const target = Math.max(0, cursorTop - scrollEl.clientHeight * 0.3);
            if (Math.abs(target - lastScrollTop.current) > 80) {
              lastScrollTop.current = target;
              scrollEl.scrollTo({ top: target, behavior: "smooth" });
            }
          }
        });
      };

      bus.on("transport:tick", onTick as never);
      cleanupBus = () => bus.off("transport:tick", onTick as never);
    });

    return () => {
      cleanupBus?.();
      if (rafScrollId.current !== null) {
        cancelAnimationFrame(rafScrollId.current);
        rafScrollId.current = null;
      }
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
  // The "all" view renders the sheet as a horizontal strip (see init effect).
  const horizontalSheet = settings.layoutMode === "all";

  // ── stretchForce ──────────────────────────────────────────────────────────
  // Near-natural note spacing (0.1) for a printed-score look in both page mode
  // and the horizontal "all" strip. (The old 0.5 was to fill the narrow "all"
  // sidebar, which no longer exists - "all" is now a full-width band.)
  const stretchForceRef = useRef(0.1);

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
  //   dark + keep white: explicit #fff so black notation stays readable on white
  //   "all" (horizontal band): TRANSPARENT - the parent column carries one
  //     continuous glow that both the sheet band and the falling-notes pane sit
  //     over, so there's no seam and the overall tone matches the other views.
  //   page mode: radial gradient + var(--color-notes-bg), matching FallingNotesView
  const scrollBg = keepWhite
    ? "#ffffff"
    : horizontalSheet
      ? "transparent"
      : "radial-gradient(ellipse at 50% 100%, rgba(147,51,234,0.07) 0%, transparent 65%), var(--color-notes-bg)";

  return (
    <div
      ref={scrollRef}
      className="flex-1"
      style={{
        background: scrollBg,
        minHeight: 0,
        // Top border sits against the header in every mode (matches the other
        // views' header separator). In "all" this is the TOP of the sheet band,
        // not the seam with the falling-notes pane (that seam stays borderless).
        borderTop: "1px solid var(--color-notes-border)",
        // Horizontal strip scrolls left<->right; page mode scrolls up/down.
        overflowX: horizontalSheet ? "auto" : "hidden",
        overflowY: horizontalSheet ? "hidden" : "auto",
      }}
    >
      {/*
        Page mode: page-width wrapper centres the score and caps it at ~A4
        screen width (900 px). Horizontal mode: no width cap - the strip must
        extend as wide as the score so it can scroll. position:relative keeps
        the key-signature badge anchored.
      */}
      <div
        style={{
          maxWidth: horizontalSheet ? "none" : 900,
          margin: horizontalSheet ? 0 : "0 auto",
          padding: "8px 16px",
          position: "relative",
        }}
      >
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
