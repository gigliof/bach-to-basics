import * as PIXI from "pixi.js";
import { isBlackKey, midiToNoteName, midiToPitch } from "@bach-to-basics/shared";
import type { NoteEvent } from "@bach-to-basics/shared";
import type {
  NoteFilter,
  ColorTheme,
  CustomColors,
  NoteLabelMode,
  ImpactStyle,
} from "../../store/useAppStore";
import type { SustainRange } from "@bach-to-basics/shared";
import { lighten, hexToNum } from "../../utils/colorUtils";

// ── Layout constants ──────────────────────────────────────────────────────────
const MIDI_MIN = 21;
const MIDI_MAX = 108;
const POOL_SIZE = 1200;

function isWhite(midi: number) {
  return !isBlackKey(midi);
}

const whiteKeyIndex: number[] = new Array(MIDI_MAX + 1).fill(0);
let wi = 0;
for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
  whiteKeyIndex[m] = wi;
  if (isWhite(m)) wi++;
}
const TOTAL_WHITE_KEYS = wi;

// ── Theme palette ─────────────────────────────────────────────────────────────
// Each theme has: left hand, right hand, unknown, and black-key variant (slightly lighter)
interface ThemePalette {
  left: number;
  right: number;
  unknown: number;
  leftBlack: number;
  rightBlack: number;
  unknownBlack: number;
}

const THEMES: Record<Exclude<ColorTheme, "custom">, ThemePalette> = {
  violet: {
    left: 0x7c3aed,
    right: 0x8b5cf6,
    unknown: 0x8b5cf6,
    leftBlack: 0xa78bfa,
    rightBlack: 0xc4b5fd,
    unknownBlack: 0xc4b5fd,
  },
  classic: {
    left: 0x2563eb,
    right: 0xdc2626,
    unknown: 0x7c3aed,
    leftBlack: 0x60a5fa,
    rightBlack: 0xf87171,
    unknownBlack: 0xa78bfa,
  },
  ocean: {
    left: 0x0284c7,
    right: 0x06b6d4,
    unknown: 0x0ea5e9,
    leftBlack: 0x38bdf8,
    rightBlack: 0x67e8f9,
    unknownBlack: 0x7dd3fc,
  },
  forest: {
    left: 0x15803d,
    right: 0x16a34a,
    unknown: 0x22c55e,
    leftBlack: 0x4ade80,
    rightBlack: 0x86efac,
    unknownBlack: 0xbbf7d0,
  },
  cascade: {
    left: 0x9333ea,
    right: 0x22d3ee,
    unknown: 0xa855f7,
    leftBlack: 0xb06af5,
    rightBlack: 0x4dd5ec,
    unknownBlack: 0xb87af8,
  },
};

/** Build a ThemePalette from three base hex colors (black-key variants auto-lightened). */
function paletteFromCustom(c: CustomColors): ThemePalette {
  const l = hexToNum(c.leftHand);
  const r = hexToNum(c.rightHand);
  const u = hexToNum(c.unknown);
  return {
    left: l,
    right: r,
    unknown: u,
    leftBlack: lighten(l, 1.55),
    rightBlack: lighten(r, 1.55),
    unknownBlack: lighten(u, 1.55),
  };
}

function noteColor(
  note: NoteEvent,
  showHandColors: boolean,
  theme: ColorTheme,
  customColors?: CustomColors
): number {
  const pal =
    theme === "custom" && customColors
      ? paletteFromCustom(customColors)
      : THEMES[theme as Exclude<ColorTheme, "custom">];
  const black = isBlackKey(note.midi);
  if (!showHandColors || note.hand === "unknown") {
    return black ? pal.unknownBlack : pal.unknown;
  }
  if (note.hand === "left") return black ? pal.leftBlack : pal.left;
  if (note.hand === "right") return black ? pal.rightBlack : pal.right;
  return black ? pal.unknownBlack : pal.unknown;
}

// ── Gradient helpers ──────────────────────────────────────────────────────────
/**
 * Linear-interpolate each RGB channel from c1 toward c2 by factor t (0=c1, 1=c2).
 * Unlike multiplicative lighten(), this NEVER blows light colours to pure white.
 */
function mixColor(c1: number, c2: number, t: number): number {
  const r1 = (c1 >> 16) & 0xff,
    r2 = (c2 >> 16) & 0xff;
  const g1 = (c1 >> 8) & 0xff,
    g2 = (c2 >> 8) & 0xff;
  const b1 = c1 & 0xff,
    b2 = c2 & 0xff;
  return (
    (Math.round(r1 + (r2 - r1) * t) << 16) |
    (Math.round(g1 + (g2 - g1) * t) << 8) |
    Math.round(b1 + (b2 - b1) * t)
  );
}

function makeGradient(base: number): PIXI.FillGradient {
  return new PIXI.FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    textureSpace: "local",
    colorStops: [
      { offset: 0, color: mixColor(base, 0xffffff, 0.55) }, // bright top - always colored, never pure white
      { offset: 0.22, color: mixColor(base, 0xffffff, 0.22) }, // slightly bright
      { offset: 0.62, color: base }, // solid base
      { offset: 1, color: mixColor(base, 0x000000, 0.3) }, // deeper bottom
    ],
  });
}

// ── ImpactFlash ───────────────────────────────────────────────────────────────
// Soft bloom effect: two expanding filled halos + a brief central sparkle.
// No hard strokes, no particles - purely diffuse light that dissolves gently.
class ImpactFlash {
  container: PIXI.Container;
  private outerBloom: PIXI.Graphics; // large, very soft, low-opacity halo
  private innerBloom: PIXI.Graphics; // smaller, slightly more visible glow
  private sparkle: PIXI.Graphics; // tiny bright flash at moment of contact
  active = false;
  private t = 0;
  private noteW = 0;
  private baseColor = 0xffffff;

  constructor() {
    this.container = new PIXI.Container();
    this.outerBloom = new PIXI.Graphics();
    this.innerBloom = new PIXI.Graphics();
    this.sparkle = new PIXI.Graphics();
    // Render back-to-front: outer halo, inner glow, sparkle on top
    this.container.addChild(this.outerBloom, this.innerBloom, this.sparkle);
    this.container.visible = false;
  }

  trigger(cx: number, cy: number, w: number, color: number) {
    this.noteW = w;
    this.baseColor = color;
    this.t = 0;
    this.active = true;
    this.container.visible = true;
    this.container.x = cx;
    this.container.y = cy;
    this._draw();
  }

  /** dtFrames: PIXI ticker.deltaTime (1.0 = one 60fps frame). Frame-rate independent. */
  advance(dtFrames: number): boolean {
    this.t += dtFrames * 0.033; // ~500ms total at 60fps
    if (this.t >= 1) {
      this.reset();
      return true;
    }
    this._draw();
    return false;
  }

  private _draw() {
    const { t, noteW, baseColor } = this;
    // Cubic ease-out: rapid initial expansion that smoothly decelerates
    const et = 1 - (1 - t) * (1 - t) * (1 - t);

    // ── Inner bloom - note-colored soft glow ─────────────────────────────────
    const r1 = noteW * 0.4 + et * noteW * 1.5;
    this.innerBloom.clear();
    this.innerBloom.circle(0, 0, r1);
    this.innerBloom.fill({ color: baseColor, alpha: (1 - t) * 0.28 });

    // ── Outer bloom - large diffuse halo, 80ms delayed start ─────────────────
    const t2 = Math.max(0, t - 0.1);
    const et2 = 1 - (1 - t2) * (1 - t2) * (1 - t2);
    const r2 = noteW * 0.4 + et2 * noteW * 3.0;
    this.outerBloom.clear();
    this.outerBloom.circle(0, 0, r2);
    this.outerBloom.fill({ color: baseColor, alpha: (1 - t2) * 0.1 });

    // ── Sparkle - bright note-colored flash that exists only for the first ~100ms ──
    // Using baseColor (the note's own color) instead of white so it's visible in
    // both dark and light mode (white would be invisible on the light #EEF1FA bg).
    const sa = Math.max(0, 1 - t * 5.0);
    this.sparkle.clear();
    if (sa > 0) {
      const sr = noteW * 0.35 * (1 - et);
      if (sr > 0.5) {
        this.sparkle.circle(0, 0, sr);
        this.sparkle.fill({ color: baseColor, alpha: sa * 0.8 });
      }
    }
  }

  reset() {
    this.active = false;
    this.container.visible = false;
    this.outerBloom.clear();
    this.innerBloom.clear();
    this.sparkle.clear();
  }
}

// ── NoteBar ───────────────────────────────────────────────────────────────────
class NoteBar {
  container: PIXI.Container;
  private bg: PIXI.Graphics;
  private label: PIXI.Text;
  /** Whether this bar's label should be shown at all (text non-empty AND bar big enough). */
  private labelWanted = false;
  note: NoteEvent | null = null;
  active = false;
  impactFired = false;
  baseColor = 0;

  constructor() {
    this.container = new PIXI.Container();
    this.bg = new PIXI.Graphics();
    this.label = new PIXI.Text({
      text: "",
      style: {
        fontSize: 10,
        fill: 0xffffff,
        fontFamily: "Space Grotesk, system-ui, sans-serif",
        fontWeight: "700",
        dropShadow: { color: 0x000000, blur: 4, distance: 0, alpha: 0.85 },
      },
    });
    this.label.anchor.set(0.5, 0.5);
    this.container.addChild(this.bg, this.label);
    this.container.visible = false;
  }

  configure(
    note: NoteEvent,
    x: number,
    barWidth: number,
    startY: number,
    barHeight: number,
    gradient: PIXI.FillGradient,
    baseColor: number,
    labelText: string,
    cornerRadius: number,
    showOutline: boolean
  ) {
    this.note = note;
    this.active = true;
    this.impactFired = false;
    this.baseColor = baseColor;
    this.container.visible = true;
    this.container.x = x;
    this.container.y = startY;

    const r = Math.min(cornerRadius, barWidth * 0.25);
    this.bg.clear();

    // Gradient fill (mixColor-based stops, always colored, never pure white)
    this.bg.roundRect(0, 0, barWidth, barHeight, r);
    this.bg.fill(gradient);

    // Subtle white highlight strip at the very top
    if (barHeight > 10) {
      const hlH = Math.min(barHeight * 0.18, 7);
      this.bg.roundRect(1, 1, barWidth - 2, hlH, r * 0.6);
      this.bg.fill({ color: 0xffffff, alpha: 0.2 });
    }

    // Border - subtle white tint by default; colored outline when enabled
    this.bg.roundRect(0, 0, barWidth, barHeight, r);
    if (showOutline) {
      this.bg.stroke({ width: 1.5, color: baseColor, alpha: 0.55 });
    } else {
      this.bg.stroke({ width: 1, color: 0xffffff, alpha: 0.15 });
    }

    // Label - position updated each tick for tall notes via updateLabelY()
    // Scale font to fit the bar: tiny bars (≤ 8 px tall or black-key narrow)
    // use size 6-7 so the text doesn't dwarf the note; normal bars use 10.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.label.style as any).fontSize = barHeight <= 8 ? 6 : barWidth <= 11 ? 7 : 10;
    this.label.text = labelText;
    this.label.x = barWidth / 2;
    this.label.y = barHeight / 2;
    // Show labels whenever the bar is tall enough to hold the text (≥ 6 px)
    // and wide enough to be legible (≥ 7 px).  The 6 px threshold means even
    // the minimum-height (minNoteHeight=8) bars get a label; at tiny sizes the
    // font is already scaled down to 6-7 px so overflow is imperceptible.
    this.labelWanted = labelText.length > 0 && barHeight > 6 && barWidth > 7;
    this.label.visible = this.labelWanted;
  }

  /** Keep label clamped within the visible portion of the bar (for very tall notes). */
  updateLabelY(containerY: number, barHeight: number, viewportHeight: number) {
    if (!this.labelWanted) {
      this.label.visible = false;
      return;
    }
    // Visible slice of the bar in local coords
    const localTop = Math.max(0, -containerY);
    const localBottom = Math.min(barHeight, viewportHeight - containerY);
    if (localBottom <= localTop) {
      this.label.visible = false;
      return;
    }
    this.label.visible = true;
    const midLocal = (localTop + localBottom) / 2;
    // Only reposition if the natural center is outside the visible slice
    const natural = barHeight / 2;
    this.label.y = natural >= localTop && natural <= localBottom ? natural : midLocal;
  }

  reset() {
    this.note = null;
    this.active = false;
    this.impactFired = false;
    this.baseColor = 0;
    this.labelWanted = false;
    this.label.visible = false;
    this.container.visible = false;
  }
}

// ── Options & renderer ────────────────────────────────────────────────────────
export interface FallingNotesOptions {
  width: number;
  height: number;
  viewportSeconds: number;
  fallingNotesLabelMode?: NoteLabelMode;
  showFingering: boolean;
  showHandColors: boolean;
  useFlats: boolean;
  noteFilter: NoteFilter;
  colorTheme: ColorTheme;
  customColors?: CustomColors;
  showGrid?: boolean;
  showMeasureNums?: boolean;
  measureStarts?: number[];
  /** Which visual effect plays when a note reaches the hit line */
  impactStyle?: ImpactStyle;
  /** Minimum pixel height for note bars - prevents staccato slivers */
  minNoteHeight?: number; // default 8
  /** Border radius for note bars (0 = sharp, 12 = pill) */
  noteCornerRadius?: number; // default 4
  /** Draw horizontal beat/measure lines across the canvas */
  showBeatLines?: boolean;
  /** Pre-computed beat start times in seconds */
  beatStarts?: number[];
  /** Draw sustain pedal (CC64) regions as semi-transparent bands */
  showSustainPedal?: boolean;
  /** Sustain pedal on/off ranges in seconds */
  sustainRanges?: SustainRange[];
  /** Draw a colored outline stroke around note bars */
  showNoteOutline?: boolean;
  /** Show ghost indicators for notes that have ended while sustain pedal is held */
  showSustainedNotes?: boolean;
  /** True when the app is in dark mode - used to choose hit-line and beat-line colors */
  darkMode?: boolean;
}

export class FallingNotesRenderer {
  app: PIXI.Application;
  private _initialized = false;
  private opts: FallingNotesOptions;
  private pool: NoteBar[] = [];
  private active = new Map<string, NoteBar>();
  private hitLine: PIXI.Graphics;
  private ghostBar: PIXI.Graphics;

  private whiteW = 0;
  private blackW = 0;

  // Gradient cache: base color to FillGradient (safe to share; textureSpace:"local" adapts per shape)
  private gradientCache = new Map<number, PIXI.FillGradient>();

  private flashes: ImpactFlash[] = [];
  private flashLayer!: PIXI.Container;
  private measureLayer!: PIXI.Container;
  private particleLayer!: PIXI.Graphics;
  private particles: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    life: number;
    decay: number;
    gravity: number;
    color: number;
  }> = [];
  private gridLayer!: PIXI.Graphics;
  private beatLayer!: PIXI.Graphics;
  private sustainLineLayer!: PIXI.Graphics; // thin connecting line
  private sustainTextLayer!: PIXI.Container; // "Ped" / "✱" text pool
  /** Ghost indicators for notes that ended while sustain was held */
  private sustainedNoteLayer!: PIXI.Graphics;
  private sustainedNotes = new Map<
    string,
    { midi: number; baseColor: number; endSeconds: number }
  >();

  constructor(opts: FallingNotesOptions) {
    this.opts = opts;
    this.app = new PIXI.Application();
    this.hitLine = new PIXI.Graphics();
    this.ghostBar = new PIXI.Graphics();
    this.ghostBar.visible = false;
  }

  async init(canvas: HTMLCanvasElement) {
    await this.app.init({
      canvas,
      width: this.opts.width,
      height: this.opts.height,
      backgroundColor: 0x050509,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      // Keep framebuffer alive for screenshot tools (Playwright) in dev mode
      ...(import.meta.env.DEV ? { preserveDrawingBuffer: true } : {}),
    });

    this.computeLayout();

    const noteLayer = new PIXI.Container();
    for (let i = 0; i < POOL_SIZE; i++) {
      const bar = new NoteBar();
      this.pool.push(bar);
      noteLayer.addChild(bar.container);
    }

    this.drawHitLine();
    this.gridLayer = this.buildGrid();
    this.gridLayer.visible = this.opts.showGrid ?? false;

    this.sustainLineLayer = new PIXI.Graphics();
    this.sustainTextLayer = new PIXI.Container();
    // Pool of 80 text objects (up to 40 Ped + 40 ✱ markers visible at once)
    for (let i = 0; i < 80; i++) {
      const t = new PIXI.Text({
        text: "",
        style: {
          fontSize: 11,
          fill: 0xa855f7,
          fontFamily: "Space Grotesk, system-ui, sans-serif",
          fontStyle: "italic",
          fontWeight: "700",
        },
      });
      t.x = 10;
      t.visible = false;
      this.sustainTextLayer.addChild(t);
    }

    this.beatLayer = new PIXI.Graphics();
    this.sustainedNoteLayer = new PIXI.Graphics();

    this.particleLayer = new PIXI.Graphics();

    this.flashLayer = new PIXI.Container();
    for (let i = 0; i < 30; i++) {
      const f = new ImpactFlash();
      this.flashes.push(f);
      this.flashLayer.addChild(f.container);
    }

    this.measureLayer = new PIXI.Container();
    for (let i = 0; i < 60; i++) {
      const t = new PIXI.Text({
        text: "",
        style: {
          fontSize: 11,
          fill: 0x8896b8,
          fontFamily: "Space Grotesk, system-ui, sans-serif",
          fontWeight: "600",
        },
      });
      t.x = 3;
      t.visible = false;
      this.measureLayer.addChild(t);
    }

    this.app.stage.addChild(
      this.gridLayer,
      this.sustainLineLayer,
      this.sustainTextLayer,
      this.beatLayer,
      noteLayer,
      this.particleLayer,
      this.sustainedNoteLayer,
      this.measureLayer,
      this.flashLayer,
      this.hitLine,
      this.ghostBar
    );
    this._initialized = true;
  }

  private computeLayout() {
    this.whiteW = this.opts.width / TOTAL_WHITE_KEYS;
    this.blackW = this.whiteW * 0.6;
  }

  private drawHitLine() {
    // Hit line intentionally left invisible - the CSS border between the notes
    // canvas and the piano keyboard already provides a clean visual separator.
    this.hitLine.clear();
  }

  private buildGrid(): PIXI.Graphics {
    const g = new PIXI.Graphics();

    // Faint vertical separator at every C (octave markers)
    // Neutral gray at low opacity - visible on both dark and light backgrounds
    for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
      if (midi % 12 === 0 && isWhite(midi)) {
        const x = whiteKeyIndex[midi] * this.whiteW;
        g.rect(x, 0, 1, this.opts.height);
        g.fill({ color: 0x808090, alpha: 0.2 });
      }
    }
    return g;
  }

  private noteX(midi: number): number {
    if (isWhite(midi)) return whiteKeyIndex[midi] * this.whiteW;
    return whiteKeyIndex[midi - 1] * this.whiteW + this.whiteW - this.blackW / 2;
  }

  private getGradient(base: number): PIXI.FillGradient {
    let g = this.gradientCache.get(base);
    if (!g) {
      g = makeGradient(base);
      this.gradientCache.set(base, g);
    }
    return g;
  }

  private noteLabel(note: NoteEvent): string {
    const parts: string[] = [];
    const labelText = this.pitchLabelFor(note.midi);
    if (labelText) parts.push(labelText);
    if (this.opts.showFingering && note.finger) parts.push(String(note.finger));
    return parts.join(" ");
  }

  private pitchLabelFor(midi: number): string {
    const mode = this.opts.fallingNotesLabelMode ?? "none";
    if (mode === "none") return "";
    const white = isWhite(midi);
    if (mode === "c_only") {
      return midi % 12 === 0 ? midiToPitch(midi, this.opts.useFlats) : "";
    }
    if (mode === "white" && !white) return "";
    if (mode === "black" && white) return "";
    // "white", "black", "all": note name class only (no octave)
    return midiToNoteName(midi, this.opts.useFlats);
  }

  // Returns false if the note should be hidden by the current filter
  private passesFilter(note: NoteEvent): boolean {
    switch (this.opts.noteFilter) {
      case "white":
        return isWhite(note.midi);
      case "black":
        return isBlackKey(note.midi);
      case "c_only":
        return note.midi % 12 === 0;
      default:
        return true;
    }
  }

  /** Burst of dots shooting sideways from the note's left & right edges at impact. */
  private spawnBurst(cx: number, cy: number, noteW: number, color: number) {
    const count = 9 + Math.floor(Math.random() * 6);
    for (let i = 0; i < count; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.particles.push({
        x: cx + side * (noteW * 0.5 + 1 + Math.random() * 3),
        y: cy,
        vx: side * (1.8 + Math.random() * 3.8),
        vy: -(0.5 + Math.random() * 2.8),
        size: 1.4 + Math.random() * 2.4,
        life: 1.0,
        decay: 0.024 + Math.random() * 0.018,
        gravity: 0.07,
        color,
      });
    }
  }

  /** Single sparkle drifting off the side of a falling bar (called each tick). */
  private spawnTrail(cx: number, cy: number, noteW: number, color: number) {
    if (Math.random() > 0.38) return;
    const side = Math.random() < 0.5 ? -1 : 1;
    this.particles.push({
      x: cx + side * (noteW * 0.5),
      y: cy - Math.random() * 22,
      vx: side * (0.5 + Math.random() * 1.4),
      vy: -(0.2 + Math.random() * 1.0),
      size: 1.0 + Math.random() * 1.6,
      life: 1.0,
      decay: 0.04 + Math.random() * 0.03,
      gravity: 0.025,
      color,
    });
  }

  private triggerFlash(cx: number, cy: number, w: number, color: number) {
    const f = this.flashes.find((f) => !f.active);
    if (f) f.trigger(cx, cy, w, color);
  }

  /** Returns true if the sustain pedal is active at `currentSeconds`. */
  private isSustainActive(currentSeconds: number): boolean {
    const ranges = this.opts.sustainRanges;
    if (!ranges) return false;
    for (const r of ranges) {
      if (r.startSeconds > currentSeconds) break; // ranges are sorted
      if (currentSeconds <= r.endSeconds) return true;
    }
    return false;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  addNote(note: NoteEvent, currentSeconds: number) {
    if (!this._initialized) return;
    if (this.active.has(note.id)) return;
    if (!this.passesFilter(note)) return;

    // Skip notes whose bottom edge has already scrolled 60 px below the hit line -
    // they would be recycled on the very next tick anyway, so don't waste a pool slot.
    // Threshold mirrors the recycle condition in tick(): bar.container.y > hitY + 60.
    //   barBottomPastHit = (currentSeconds - note.startSeconds) * pxPerSec - barHeight
    //   recycle if barBottomPastHit > 60
    {
      const pxPerSec = this.opts.height / this.opts.viewportSeconds;
      const minH = this.opts.minNoteHeight ?? 8;
      const barHeight = Math.max(minH, (note.endSeconds - note.startSeconds) * pxPerSec);
      const timePastHit = currentSeconds - note.startSeconds; // positive = note already started
      if (timePastHit * pxPerSec - barHeight > 60) return;
    }

    const bar = this.pool.pop();
    if (!bar) return; // pool exhausted (> POOL_SIZE notes visible at once)

    const { viewportSeconds, height } = this.opts;
    const white = isWhite(note.midi);
    const barWidth = Math.max(5, (white ? this.whiteW : this.blackW) - 2);
    const x = this.noteX(note.midi) + 1;

    const pxPerSec = height / viewportSeconds;
    const minH = this.opts.minNoteHeight ?? 8;
    const barHeight = Math.max(minH, (note.endSeconds - note.startSeconds) * pxPerSec);
    const timeUntilHit = note.startSeconds - currentSeconds;
    const startY = height - 4 - barHeight - timeUntilHit * pxPerSec;

    const base = noteColor(
      note,
      this.opts.showHandColors,
      this.opts.colorTheme,
      this.opts.customColors
    );
    bar.configure(
      note,
      x,
      barWidth,
      startY,
      barHeight,
      this.getGradient(base),
      base,
      this.noteLabel(note),
      this.opts.noteCornerRadius ?? 4,
      this.opts.showNoteOutline ?? false
    );
    this.active.set(note.id, bar);
  }

  tick(currentSeconds: number) {
    if (!this._initialized) return;
    const { height, viewportSeconds } = this.opts;
    const pxPerSec = height / viewportSeconds;
    const hitY = height - 4;

    const minH = this.opts.minNoteHeight ?? 8;
    const cornerRadius = this.opts.noteCornerRadius ?? 4;
    const impactStyle = this.opts.impactStyle ?? "bloom";
    const doSustained = this.opts.showSustainedNotes ?? false;
    const sustainActive = doSustained && this.isSustainActive(currentSeconds);

    for (const [id, bar] of this.active) {
      if (!bar.note) continue;
      const barHeight = Math.max(minH, (bar.note.endSeconds - bar.note.startSeconds) * pxPerSec);
      const timeUntilHit = bar.note.startSeconds - currentSeconds;
      bar.container.y = hitY - barHeight - timeUntilHit * pxPerSec;
      bar.updateLabelY(bar.container.y, barHeight, height);

      // ── Impact effect ───────────────────────────────────────────────────────
      if (!bar.impactFired && impactStyle !== "off") {
        if (bar.container.y + barHeight >= hitY - 2) {
          bar.impactFired = true;
          const bw = isWhite(bar.note.midi) ? this.whiteW : this.blackW;
          const cx = bar.container.x + bw * 0.5;
          if (impactStyle === "bloom") this.triggerFlash(cx, hitY - 4, bw * 0.8, bar.baseColor);
          else if (impactStyle === "side") this.spawnBurst(cx, hitY - 3, bw, bar.baseColor);
          // "trail" is handled continuously below
        }
      }

      // ── Trail particles ─────────────────────────────────────────────────────
      if (impactStyle === "trail") {
        const barTopY = bar.container.y;
        if (barTopY + barHeight < hitY && barTopY < hitY) {
          const bw = isWhite(bar.note.midi) ? this.whiteW : this.blackW;
          this.spawnTrail(
            bar.container.x + bw * 0.5,
            barTopY + barHeight * 0.35,
            bw,
            bar.baseColor
          );
        }
      }

      // ── Recycle ─────────────────────────────────────────────────────────────
      if (bar.container.y > hitY + 60) {
        // Transition into sustained-ghost tracking before recycling bar
        if (doSustained && sustainActive) {
          const timeAfterEnd = currentSeconds - bar.note.endSeconds;
          if (timeAfterEnd < 3.0) {
            this.sustainedNotes.set(id, {
              midi: bar.note.midi,
              baseColor: bar.baseColor,
              endSeconds: bar.note.endSeconds,
            });
          }
        }
        bar.reset();
        this.pool.push(bar);
        this.active.delete(id);
      }
    }

    // ── Sustained-note ghost indicators ──────────────────────────────────────
    this.sustainedNoteLayer.clear();
    if (doSustained && this.sustainedNotes.size > 0) {
      const sustainStillActive = this.isSustainActive(currentSeconds);
      const ghostH = 12;
      for (const [sid, sn] of this.sustainedNotes) {
        const timeAfterEnd = currentSeconds - sn.endSeconds;
        if (!sustainStillActive || timeAfterEnd >= 3.0) {
          this.sustainedNotes.delete(sid);
          continue;
        }
        const bw = Math.max(5, (isWhite(sn.midi) ? this.whiteW : this.blackW) - 2);
        const x = this.noteX(sn.midi) + 1;
        const r = Math.min(cornerRadius, bw * 0.25);
        // Fade out over the last second of the 3s window
        const alpha = Math.min(0.32, 0.32 * (1 - Math.max(0, timeAfterEnd - 2.0)));
        this.sustainedNoteLayer.roundRect(x, hitY - ghostH, bw, ghostH, r);
        this.sustainedNoteLayer.fill({ color: sn.baseColor, alpha });
      }
    }

    // Advance all active flashes - pass PIXI's normalized delta so animation
    // duration is frame-rate independent (1.0 = one 60fps frame).
    const dt = this.app.ticker.deltaTime;
    for (const f of this.flashes) {
      if (f.active) f.advance(dt);
    }

    // ── Particles ──────────────────────────────────────────────────────────
    this.particleLayer.clear();
    if (this.particles.length > 0) {
      this.particles = this.particles.filter((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.life -= p.decay;
        return p.life > 0;
      });
      for (const p of this.particles) {
        const r = Math.max(0.5, p.size * p.life);
        this.particleLayer.circle(p.x, p.y, r);
        this.particleLayer.fill({ color: p.color, alpha: p.life * 0.88 });
      }
    }

    // Update measure number labels
    if (this.opts.showMeasureNums && this.opts.measureStarts?.length) {
      let li = 0;
      const labels = this.measureLayer.children as PIXI.Text[];
      const viewportSeconds = this.opts.viewportSeconds;
      for (let i = 0; i < this.opts.measureStarts.length && li < labels.length; i++) {
        const sec = this.opts.measureStarts[i];
        const timeUntil = sec - currentSeconds;
        if (timeUntil < -0.5 || timeUntil > viewportSeconds + 0.5) continue;
        const y = hitY - timeUntil * pxPerSec;
        if (y < -15 || y > height + 15) continue;
        const lbl = labels[li++];
        lbl.visible = true;
        lbl.text = String(i + 1);
        lbl.y = y - 10;
      }
      for (let i = li; i < labels.length; i++) (labels[i] as PIXI.Text).visible = false;
    } else {
      for (const c of this.measureLayer.children) (c as PIXI.Text).visible = false;
    }

    // ── Beat lines ──────────────────────────────────────────────────────────
    if ((this.opts.showBeatLines ?? false) && this.opts.beatStarts?.length) {
      this.beatLayer.clear();
      // Build a Set of measure-start times (×100 for int comparison) for styling
      const mSet = new Set((this.opts.measureStarts ?? []).map((s) => Math.round(s * 100)));
      for (const sec of this.opts.beatStarts) {
        const timeUntil = sec - currentSeconds;
        if (timeUntil < -0.3 || timeUntil > viewportSeconds + 0.3) continue;
        const y = Math.round(hitY - timeUntil * pxPerSec);
        if (y < 0 || y > height + 1) continue;
        const isMeasure = mSet.has(Math.round(sec * 100));
        const dark = this.opts.darkMode !== false;
        this.beatLayer.rect(0, y, this.opts.width, isMeasure ? 1.5 : 1);
        // Dark mode: light blue-gray at low opacity. Light mode: darker blue-gray at higher opacity.
        this.beatLayer.fill({
          color: dark ? 0x8896b8 : 0x4a5568,
          alpha: isMeasure ? (dark ? 0.2 : 0.35) : dark ? 0.08 : 0.15,
        });
      }
    } else if (!(this.opts.showBeatLines ?? false)) {
      this.beatLayer.clear();
    }

    // ── Sustain pedal - "Ped" / "✱" markers + left-edge connector line ────────
    // "Ped" appears at the press position (bottom of each range, reaches the hit
    // line first).  "✱" appears at the release position (top of range, arrives
    // later).  A 1px line connects them on the left edge - same layout as printed
    // sheet music pedal notation, without any full-width bands obscuring notes.
    if ((this.opts.showSustainPedal ?? false) && this.opts.sustainRanges?.length) {
      this.sustainLineLayer.clear();
      const pool = this.sustainTextLayer.children as PIXI.Text[];
      for (const t of pool) t.visible = false;
      let ti = 0;

      const LABEL_H = 16; // approximate text height + gap
      let prevRelY = -999; // Y of the last "✱" placed - guards Ped overlap from above

      for (const range of this.opts.sustainRanges) {
        const startTimeUntil = range.startSeconds - currentSeconds;
        const endTimeUntil = range.endSeconds - currentSeconds;
        if (endTimeUntil < -0.5 || startTimeUntil > viewportSeconds + 0.5) continue;

        // topY = release (end) - higher on canvas (later in time)
        // botY = press  (start) - lower on canvas (sooner, approaches hit line first)
        const topY = Math.max(0, hitY - endTimeUntil * pxPerSec);
        const botY = Math.min(height + 14, hitY - startTimeUntil * pxPerSec);
        if (botY <= topY) continue;

        // 1 px connecting line on the left edge
        this.sustainLineLayer.rect(9, topY, 1, botY - topY);
        this.sustainLineLayer.fill({ color: 0xa855f7, alpha: 0.55 });

        const pedY = Math.min(botY - 14, height - 14);
        const relY = Math.max(2, topY - 13);

        // "Ped" - skip if it would sit on top of the previous "✱"
        const pedClear = pedY - prevRelY > LABEL_H;
        if (pedClear && ti < pool.length && botY >= -4 && botY <= height + 14) {
          const t = pool[ti++];
          t.text = "Ped";
          t.y = pedY;
          t.visible = true;
        }

        // "✱" - only if the band is tall enough to show both labels without crowding
        const bandPx = botY - topY;
        if (bandPx >= LABEL_H * 2 && ti < pool.length && topY >= -4 && topY <= height) {
          const t = pool[ti++];
          t.text = "✱";
          t.y = relY;
          t.visible = true;
          prevRelY = relY;
        }
      }
    } else if (!(this.opts.showSustainPedal ?? false)) {
      this.sustainLineLayer.clear();
      for (const t of this.sustainTextLayer.children as PIXI.Text[]) t.visible = false;
    }
  }

  showGhost(note: NoteEvent | null) {
    if (!note) {
      this.ghostBar.visible = false;
      return;
    }
    const white = isWhite(note.midi);
    const w = (white ? this.whiteW : this.blackW) - 2;
    const x = this.noteX(note.midi) + 1;
    this.ghostBar.clear();
    this.ghostBar.roundRect(x, this.opts.height - 22, w, 16, 3);
    this.ghostBar.fill({ color: 0x6366f1, alpha: 0.5 });
    this.ghostBar.visible = true;
  }

  reset() {
    for (const [, bar] of this.active) {
      bar.reset();
      this.pool.push(bar);
    }
    this.active.clear();
    this.particles = [];
    this.particleLayer?.clear();
    this.sustainedNotes.clear();
    this.sustainedNoteLayer?.clear();
    this.ghostBar.visible = false;
  }

  /**
   * Fade the stage from transparent to fully opaque over `durationMs`.
   * Call this when playback starts from a stopped state so the first notes
   * materialize gently rather than snapping into view.
   */
  fadeIn(durationMs = 420) {
    if (!this._initialized) return;
    this.app.stage.alpha = 0;
    // Frames at 60 fps; clamp to at least 1 to avoid division by zero.
    const frames = Math.max(1, Math.round((durationMs / 1000) * 60));
    const step = 1 / frames;
    const onTick = () => {
      const next = Math.min(1, this.app.stage.alpha + step);
      this.app.stage.alpha = next;
      if (next >= 1) this.app.ticker.remove(onTick);
    };
    this.app.ticker.remove(onTick); // guard against double-call
    this.app.ticker.add(onTick);
  }

  setOptions(opts: Partial<FallingNotesOptions>) {
    // Check whether any colour-affecting option actually CHANGED before merging,
    // because "x in opts" is always true when callers always pass the full options
    // object - triggering spurious resets that wipe all visible note bars.
    const needsReset =
      ("colorTheme" in opts && opts.colorTheme !== this.opts.colorTheme) ||
      ("customColors" in opts && opts.customColors !== this.opts.customColors) ||
      ("noteFilter" in opts && opts.noteFilter !== this.opts.noteFilter) ||
      ("showHandColors" in opts && opts.showHandColors !== this.opts.showHandColors) ||
      ("useFlats" in opts && opts.useFlats !== this.opts.useFlats) ||
      ("fallingNotesLabelMode" in opts &&
        opts.fallingNotesLabelMode !== this.opts.fallingNotesLabelMode) ||
      ("showFingering" in opts && opts.showFingering !== this.opts.showFingering) ||
      ("showNoteOutline" in opts && opts.showNoteOutline !== this.opts.showNoteOutline);

    Object.assign(this.opts, opts);
    if (!this._initialized) return;

    if (needsReset) {
      for (const g of this.gradientCache.values()) g.destroy();
      this.gradientCache.clear();
      this.reset();
    }
    if ("showGrid" in opts) this.gridLayer.visible = !!opts.showGrid;
    if ("impactStyle" in opts) {
      this.particles = [];
      this.particleLayer?.clear();
    }
    if ("darkMode" in opts) this.drawHitLine();
    if ("showBeatLines" in opts && !opts.showBeatLines) this.beatLayer.clear();
    if ("showSustainPedal" in opts && !opts.showSustainPedal) {
      this.sustainLineLayer.clear();
      for (const t of this.sustainTextLayer.children as PIXI.Text[]) t.visible = false;
    }
    // Turning off sustained notes: discard ghost state and clear the layer
    if ("showSustainedNotes" in opts && !opts.showSustainedNotes) {
      this.sustainedNotes.clear();
      this.sustainedNoteLayer?.clear();
    }
  }

  resize(width: number, height: number) {
    if (!this._initialized) return;
    this.opts.width = width;
    this.opts.height = height;
    this.app.renderer.resize(width, height);
    this.computeLayout();
    this.reset();
    this.drawHitLine();
  }

  destroy() {
    if (!this._initialized) return;
    for (const g of this.gradientCache.values()) g.destroy();
    this.gradientCache.clear();
    this.app.destroy(false, { children: true });
  }
}
