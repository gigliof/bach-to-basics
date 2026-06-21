import * as PIXI from "pixi.js";
import { isBlackKey, midiToPitch, midiToNoteName } from "@bach-to-basics/shared";
import type { NoteEvent } from "@bach-to-basics/shared";
import type { CustomColors, NoteLabelMode } from "../../store/useAppStore";
import { lighten, hexToNum } from "../../utils/colorUtils";

// ── Layout constants ──────────────────────────────────────────────────────────
const MIDI_MIN = 21; // A0
const MIDI_MAX = 108; // C8

function isWhite(midi: number) {
  return !isBlackKey(midi);
}
const WHITE_COUNT = Array.from({ length: MIDI_MAX - MIDI_MIN + 1 }, (_, i) => MIDI_MIN + i).filter(
  isWhite
).length;

// ── Color tokens ──────────────────────────────────────────────────────────────
const C_WHITE_TOP = 0xc4c4bc; // subtle shadow at key hinge
const C_WHITE_MID = 0xf5f5f0; // main key face
const C_WHITE_BTM = 0xe4e4dc; // front edge shadow

const C_BORDER = 0x9a9a90;
const C_LABEL = 0x6b7280;
const C_FINGER = 0xffffff;

// Active state colors (hand-aware)
const C_PLAYBACK = 0x6366f1;
const C_INPUT = 0x22c55e;
const C_LEFT = 0x3b82f6;
const C_RIGHT = 0xef4444;

// ── Gradient factory ──────────────────────────────────────────────────────────
function lg(stops: Array<[number, number | string]>): PIXI.FillGradient {
  return new PIXI.FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    textureSpace: "local",
    colorStops: stops.map(([offset, color]) => ({ offset, color })),
  });
}

// ── Key color factories (themed) ──────────────────────────────────────────────
function whiteKeyColors(ivory: boolean): { top: number; mid: number; btm: number } {
  return ivory
    ? { top: 0xcdc8a8, mid: 0xfff8e7, btm: 0xe8e0c8 }
    : { top: C_WHITE_TOP, mid: C_WHITE_MID, btm: C_WHITE_BTM };
}

// Pre-built gradient factories for the ~10 possible states
const GRAD = {
  whiteNormal: (ivory: boolean) => {
    const c = whiteKeyColors(ivory);
    return lg([
      [0, c.top],
      [0.07, c.mid],
      [0.88, c.mid],
      [1, c.btm],
    ]);
  },
  // Horizontal overlay: soft shadow down each side, transparent in the middle.
  // Overlaid on the (vertical) white-key gradient, it makes each white key read
  // as rounded / raised instead of a flat slab - the main "fuller, more real"
  // cue (black keys sit between white keys and cast a soft shadow onto them).
  whiteSideShade: () =>
    new PIXI.FillGradient({
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 },
      textureSpace: "local",
      colorStops: [
        { offset: 0, color: "rgba(0,0,0,0.10)" },
        { offset: 0.16, color: "rgba(0,0,0,0)" },
        { offset: 0.84, color: "rgba(0,0,0,0)" },
        { offset: 1, color: "rgba(0,0,0,0.10)" },
      ],
    }),
  // Subtle dimension via the gradient alone: a soft sheen at the top, dark
  // body, and a slightly lighter "front lip" at the bottom so the key isn't a
  // flat 100% black slab. (Kept restrained - stronger glossy/face attempts read
  // as plasticky on our renderer.)
  blackNormal: () =>
    lg([
      [0, 0x34343f], // top sheen - catches a bit of light
      [0.18, 0x1c1c24],
      [0.82, 0x141419], // darkest part of the body
      [1, 0x3a3a46], // lighter front lip at the bottom
    ]),
  activeWhite: (base: number) =>
    lg([
      [0, 0x050508], // deep hinge shadow
      [0.12, lighten(base, 0.58)],
      [0.22, base],
      [0.83, base],
      [1, lighten(base, 1.45)], // bright front lip
    ]),
  activeBlack: (base: number) =>
    lg([
      [0, lighten(base, 0.6)],
      [0.5, base],
      [1, lighten(base, 1.5)],
    ]),
};

export interface PianoKeyboardOptions {
  width: number;
  height: number;
  noteLabelMode: NoteLabelMode;
  pianoTheme: "white" | "ivory";
  showFingering: boolean;
  showHandColors: boolean;
  useFlats: boolean;
  customColors?: CustomColors;
  onKeyPress?: (midi: number) => void;
  onKeyRelease?: (midi: number) => void;
}

interface KeyState {
  playbackActive: boolean;
  inputActive: boolean;
  hand: "left" | "right" | null;
  finger: number | null;
  hovered: boolean;
}

// ── Main class ────────────────────────────────────────────────────────────────
export class PianoKeyboard {
  app: PIXI.Application;
  private _initialized = false;

  private keyContainers = new Map<number, PIXI.Container>();
  private keys = new Map<number, PIXI.Graphics>();
  private keyLabels = new Map<number, PIXI.Text>();
  private fingerLabels = new Map<number, PIXI.Text>();
  private keyStates = new Map<number, KeyState>();
  private opts: PianoKeyboardOptions;

  private whiteW = 0;
  private whiteH = 0;
  private blackW = 0;
  private blackH = 0;
  private keyX = new Map<number, number>();

  // Gradient cache - keyed by "white|black-normal|#hexcolor"
  private gradCache = new Map<string, PIXI.FillGradient>();

  // Drag-to-play tracking
  private isPointerDown = false;
  private dragKeys = new Set<number>();
  private readonly onWindowPointerUp: (e: PointerEvent) => void;

  constructor(_canvas: HTMLCanvasElement, opts: PianoKeyboardOptions) {
    this.opts = opts;
    this.app = new PIXI.Application();
    this.onWindowPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      this.isPointerDown = false;
      for (const m of this.dragKeys) this.opts.onKeyRelease?.(m);
      this.dragKeys.clear();
    };
  }

  async init(canvas: HTMLCanvasElement) {
    await this.app.init({
      canvas,
      width: this.opts.width,
      height: this.opts.height,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      ...(import.meta.env.DEV ? { preserveDrawingBuffer: true } : {}),
    });
    window.addEventListener("pointerup", this.onWindowPointerUp);
    this.computeLayout();
    this.drawKeys();
    this._initialized = true;
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  private computeLayout() {
    const { width, height } = this.opts;
    this.whiteW = width / WHITE_COUNT;
    this.whiteH = height;
    this.blackW = this.whiteW * 0.58;
    this.blackH = height * 0.6;

    let wi = 0;
    for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
      if (isWhite(midi)) {
        this.keyX.set(midi, wi * this.whiteW);
        wi++;
      }
    }
    for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
      if (!isWhite(midi)) {
        const lx = this.keyX.get(midi - 1) ?? 0;
        this.keyX.set(midi, lx + this.whiteW - this.blackW / 2);
      }
    }
  }

  private drawKeys() {
    const root = new PIXI.Container();
    const whiteLayer = new PIXI.Container();
    const blackLayer = new PIXI.Container();

    for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
      const white = isWhite(midi);
      const x = this.keyX.get(midi) ?? 0;
      const w = white ? this.whiteW : this.blackW;
      const h = white ? this.whiteH : this.blackH;

      const container = new PIXI.Container();
      container.x = x;
      container.interactive = true;
      container.cursor = "pointer";

      // Draw shape
      const g = new PIXI.Graphics();
      this.paintKey(g, w, h, white, false, null, null, false);
      container.addChild(g);

      // Note label (created for every key; text/visibility set by noteLabelMode)
      {
        const labelStr = this.noteLabel(midi);
        const lFontSz = white ? Math.max(7, this.whiteW * 0.42) : Math.max(6, this.blackW * 0.55);
        const label = new PIXI.Text({
          text: labelStr,
          style: {
            fontSize: lFontSz,
            fill: white ? C_LABEL : 0xaaaaaa,
            fontFamily: "Space Grotesk, system-ui, sans-serif",
            fontWeight: "600",
          },
        });
        label.anchor.set(0.5, 1);
        label.x = w / 2;
        label.y = white ? h - 5 : h - 3;
        label.visible = labelStr.length > 0;
        container.addChild(label);
        this.keyLabels.set(midi, label);
      }

      // Finger label
      const fingerText = new PIXI.Text({
        text: "",
        style: {
          fontSize: Math.max(9, this.whiteW * 0.48),
          fill: C_FINGER,
          fontFamily: "Space Grotesk, system-ui, sans-serif",
          fontWeight: "700",
        },
      });
      fingerText.anchor.set(0.5, 0.5);
      fingerText.x = w / 2;
      fingerText.y = h * 0.22;
      fingerText.visible = false;
      container.addChild(fingerText);
      this.fingerLabels.set(midi, fingerText);

      // Click + drag-to-play handlers
      container.on("pointerdown", () => {
        this.isPointerDown = true;
        if (!this.dragKeys.has(midi)) {
          this.opts.onKeyPress?.(midi);
          this.dragKeys.add(midi);
        }
      });
      container.on("pointerover", () => {
        if (this.isPointerDown && !this.dragKeys.has(midi)) {
          this.opts.onKeyPress?.(midi);
          this.dragKeys.add(midi);
        }
        // Hover highlight
        const st = this.keyStates.get(midi);
        if (st && !st.hovered) {
          st.hovered = true;
          this.redrawKey(midi);
        }
      });
      container.on("pointerout", () => {
        if (this.dragKeys.has(midi)) {
          this.opts.onKeyRelease?.(midi);
          this.dragKeys.delete(midi);
        }
        // Remove hover highlight
        const st = this.keyStates.get(midi);
        if (st && st.hovered) {
          st.hovered = false;
          this.redrawKey(midi);
        }
      });

      this.keys.set(midi, g);
      this.keyContainers.set(midi, container);
      this.keyStates.set(midi, {
        playbackActive: false,
        inputActive: false,
        hand: null,
        finger: null,
        hovered: false,
      });

      if (white) whiteLayer.addChild(container);
      else blackLayer.addChild(container);
    }

    root.addChild(whiteLayer, blackLayer);
    this.app.stage.addChild(root);
  }

  // ── Painting ──────────────────────────────────────────────────────────────

  private getGrad(key: string, factory: () => PIXI.FillGradient): PIXI.FillGradient {
    let g = this.gradCache.get(key);
    if (!g) {
      g = factory();
      this.gradCache.set(key, g);
    }
    return g;
  }

  private paintKey(
    g: PIXI.Graphics,
    w: number,
    h: number,
    white: boolean,
    active: boolean,
    activeColor: number | null,
    _hand: "left" | "right" | null,
    hovered = false
  ) {
    g.clear();
    const r = white ? 4 : 3;

    const ivory = this.opts.pianoTheme === "ivory";

    let fill: PIXI.FillGradient | number;
    if (!active) {
      fill = white
        ? this.getGrad(ivory ? "wn-iv" : "wn", () => GRAD.whiteNormal(ivory))
        : this.getGrad("bn", GRAD.blackNormal);
    } else {
      const base = activeColor ?? C_PLAYBACK;
      const hexKey = (white ? "aw" : "ab") + base.toString(16);
      fill = white
        ? this.getGrad(hexKey, () => GRAD.activeWhite(base))
        : this.getGrad(hexKey, () => GRAD.activeBlack(base));
    }

    // Main shape
    g.roundRect(0.5, 0.5, w - 1, h - 1, r);
    g.fill(fill);

    // ── Active white key: depth / pressed look ─────────────────────────────
    if (active && white) {
      // Keybed shadow strip at bottom (felt bumper contact)
      g.rect(1, h - 4, w - 2, 4);
      g.fill({ color: 0x000000, alpha: 0.4 });
      // Side edge depth shadows
      g.rect(0.5, h * 0.08, 2, h * 0.88);
      g.fill({ color: 0x000000, alpha: 0.1 });
      g.rect(w - 2.5, h * 0.08, 2, h * 0.88);
      g.fill({ color: 0x000000, alpha: 0.1 });
    }

    // ── Inactive white key: soft side shading for a rounded, fuller look ────
    if (white && !active) {
      g.roundRect(0.5, 0.5, w - 1, h - 1, r);
      g.fill(this.getGrad("wshade", GRAD.whiteSideShade));
    }

    // White highlight strip at top of active black keys
    if (active && !white && h > 10) {
      g.roundRect(1, 1, w - 2, Math.min(h * 0.12, 6), r * 0.4);
      g.fill({ color: 0xffffff, alpha: 0.28 });
      // Subtle colored glow at bottom of active black key
      g.rect(1, h - 5, w - 2, 4);
      g.fill({ color: activeColor ?? C_PLAYBACK, alpha: 0.25 });
    }

    // Border
    if (white) {
      g.roundRect(0.5, 0.5, w - 1, h - 1, r);
      g.stroke({ width: 1, color: active ? 0x00000033 : C_BORDER });
    }

    // Black key inner shadow on left/right edges (inactive)
    if (!white && !active) {
      g.rect(0, 4, 1, h - 8);
      g.fill({ color: 0x000000, alpha: 0.35 });
      g.rect(w - 1, 4, 1, h - 8);
      g.fill({ color: 0x000000, alpha: 0.35 });
    }

    // Hover overlay - subtle white sheen on non-active keys
    if (hovered && !active) {
      if (white) {
        g.roundRect(0.5, 0.5, w - 1, h - 1, r);
        g.fill({ color: 0xffffff, alpha: 0.22 });
      } else {
        g.roundRect(1, 1, w - 2, h - 2, r);
        g.fill({ color: 0xffffff, alpha: 0.14 });
      }
    }
  }

  private redrawKey(midi: number) {
    const g = this.keys.get(midi);
    const state = this.keyStates.get(midi);
    const cont = this.keyContainers.get(midi);
    if (!g || !state || !cont) return;

    const white = isWhite(midi);
    const w = white ? this.whiteW : this.blackW;
    const h = white ? this.whiteH : this.blackH;
    const active = state.playbackActive || state.inputActive;

    // 3D press: shift container down when active
    const pressOffset = active ? (white ? 5 : 3) : 0;
    cont.y = pressOffset;

    let color: number | null = null;
    if (active) {
      const cc = this.opts.customColors;
      if (this.opts.showHandColors && state.hand) {
        color =
          state.hand === "left"
            ? cc
              ? hexToNum(cc.leftHand)
              : C_LEFT
            : cc
              ? hexToNum(cc.rightHand)
              : C_RIGHT;
      } else if (state.inputActive) {
        color = C_INPUT;
      } else {
        color = cc ? hexToNum(cc.unknown) : C_PLAYBACK;
      }
    }

    this.paintKey(g, w, h, white, active, color, state.hand, !active && state.hovered);

    // Finger label
    const fl = this.fingerLabels.get(midi);
    if (fl) {
      fl.visible = this.opts.showFingering && active && state.finger !== null;
      if (state.finger !== null) fl.text = String(state.finger);
    }
  }

  private noteLabel(midi: number): string {
    const mode = this.opts.noteLabelMode ?? "none";
    if (mode === "none") return "";
    const white = isWhite(midi);
    if (mode === "c_only") {
      // Show full pitch (e.g. "C4") only for C notes
      return midi % 12 === 0 ? midiToPitch(midi, this.opts.useFlats) : "";
    }
    if (mode === "white" && !white) return "";
    if (mode === "black" && white) return "";
    // "white", "black", "all": show note name class only (no octave)
    return midiToNoteName(midi, this.opts.useFlats);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  noteOn(note: NoteEvent, source: "playback" | "input") {
    const state = this.keyStates.get(note.midi);
    if (!state) return;
    if (source === "playback") {
      state.playbackActive = true;
      state.hand = note.hand === "unknown" ? null : (note.hand as "left" | "right");
      state.finger = note.finger;
    } else {
      state.inputActive = true;
    }
    this.redrawKey(note.midi);
  }

  noteOff(note: NoteEvent, source: "playback" | "input") {
    const state = this.keyStates.get(note.midi);
    if (!state) return;
    if (source === "playback") {
      state.playbackActive = false;
      if (!state.inputActive) {
        state.hand = null;
        state.finger = null;
      }
    } else {
      state.inputActive = false;
    }
    this.redrawKey(note.midi);
  }

  inputNoteOn(midi: number) {
    const state = this.keyStates.get(midi);
    if (!state) return;
    state.inputActive = true;
    this.redrawKey(midi);
  }

  inputNoteOff(midi: number) {
    const state = this.keyStates.get(midi);
    if (!state) return;
    state.inputActive = false;
    this.redrawKey(midi);
  }

  reset() {
    for (const [midi] of this.keys) {
      const state = this.keyStates.get(midi);
      if (state) {
        state.playbackActive = false;
        state.inputActive = false;
        state.hand = null;
        state.finger = null;
        state.hovered = false;
      }
      this.redrawKey(midi);
    }
  }

  setOptions(opts: Partial<PianoKeyboardOptions>) {
    const needsFullRebuild =
      ("pianoTheme" in opts && opts.pianoTheme !== this.opts.pianoTheme) ||
      ("noteLabelMode" in opts && opts.noteLabelMode !== this.opts.noteLabelMode) ||
      ("useFlats" in opts && opts.useFlats !== this.opts.useFlats);

    Object.assign(this.opts, opts);

    if (needsFullRebuild) {
      // Full key rebuild - clears gradient cache, recomputes layout, redraws all keys
      this.resize(this.opts.width, this.opts.height);
      return;
    }

    // Light update: refresh note labels in place
    for (const [midi, label] of this.keyLabels) {
      const text = this.noteLabel(midi);
      label.text = text;
      label.visible = text.length > 0;
    }
    // Redraw any currently-active keys so color changes take effect immediately
    if ("customColors" in opts || "showHandColors" in opts) {
      for (const [midi, state] of this.keyStates) {
        if (state.playbackActive || state.inputActive) this.redrawKey(midi);
      }
    }
  }

  resize(width: number, height: number) {
    if (!this._initialized) return;
    this.opts.width = width;
    this.opts.height = height;
    this.app.renderer.resize(width, height);

    // Destroy cached gradients so they get rebuilt at new dimensions
    for (const g of this.gradCache.values()) g.destroy();
    this.gradCache.clear();

    this.keyX.clear();
    this.keys.clear();
    this.keyContainers.clear();
    this.keyLabels.clear();
    this.fingerLabels.clear();
    this.keyStates.clear();
    this.app.stage.removeChildren();
    this.computeLayout();
    this.drawKeys();
  }

  destroy() {
    window.removeEventListener("pointerup", this.onWindowPointerUp);
    if (this._initialized) {
      for (const g of this.gradCache.values()) g.destroy();
      this.gradCache.clear();
      this.app.destroy(false, { children: true });
    }
  }
}
