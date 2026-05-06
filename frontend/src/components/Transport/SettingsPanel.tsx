import { useAppStore } from "../../store/useAppStore";
import type { NoteFilter, ColorTheme, CustomColors, NoteLabelMode, InstrumentId, ImpactStyle } from "../../store/useAppStore";
import { COLOR_PRESET_VALUES, INSTRUMENT_LABELS } from "../../store/useAppStore";
import { useState } from "react";

const NOTE_FILTER_OPTIONS: { value: NoteFilter; label: string; title: string }[] = [
  { value: "all",    label: "All",     title: "Show all notes" },
  { value: "white",  label: "Natural", title: "Show only natural (white) key notes" },
  { value: "black",  label: "Sharps",  title: "Show only sharp/flat (black) key notes" },
  { value: "c_only", label: "C only",  title: "Show only C notes" },
];

const COLOR_THEME_LABELS: Record<ColorTheme, string> = {
  violet:  "Violet",
  classic: "Classic",
  ocean:   "Ocean",
  forest:  "Forest",
  cascade: "Cascade",
  custom:  "Custom",
};

const NOTE_LABEL_OPTIONS: { value: NoteLabelMode; label: string; title: string }[] = [
  { value: "none",   label: "None",    title: "No note name labels" },
  { value: "c_only", label: "C only",  title: "Label C notes with octave number (C4, C5…)" },
  { value: "white",  label: "Natural", title: "Label all natural (white) keys" },
  { value: "black",  label: "Sharps",  title: "Label all sharp/flat (black) keys" },
  { value: "all",    label: "All",     title: "Label every key" },
];

const INSTRUMENT_OPTIONS: { value: InstrumentId; label: string; title: string }[] = [
  { value: "grand",       label: INSTRUMENT_LABELS.grand,       title: "Splendid Grand Piano - high-quality sampled concert grand" },
  { value: "bright",      label: INSTRUMENT_LABELS.bright,      title: "Bright Acoustic Piano - brighter attack and tone" },
  { value: "electric",    label: INSTRUMENT_LABELS.electric,    title: "CP80 Electric Grand Piano - vintage Yamaha electric grand" },
  { value: "harpsichord", label: INSTRUMENT_LABELS.harpsichord, title: "Harpsichord - plucked strings, no velocity dynamic" },
  { value: "honkytonk",   label: INSTRUMENT_LABELS.honkytonk,   title: "Honky-Tonk Piano - slightly out-of-tune saloon upright" },
];

function formatTranspose(n: number): string {
  if (n === 0) return "original";
  if (n > 0) return `+${n}♯`;
  return `${n}♭`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Toggle({
  active,
  onClick,
  title,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={active}
      onClick={onClick}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        cursor: "pointer",
        flexShrink: 0,
        border: "none",
        background: "transparent",
        /* Expanded invisible tap target - visually identical */
        padding: "8px",
        margin: "-8px",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 38,
          height: 22,
          borderRadius: 11,
          background: active ? "var(--color-accent)" : "var(--color-toggle-off)",
          position: "relative",
          transition: "background 0.18s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: active ? 17 : 3,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "white",
            transition: "left 0.18s",
            boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
          }}
        />
      </span>
    </button>
  );
}

/** A row in the settings panel.
 *  - `sublabel` renders a second, dimmer line under the main label.
 *  - `stacked` puts the control beneath the label instead of inline (useful for wide controls). */
function Row({
  label,
  sublabel,
  title,
  stacked = false,
  children,
}: {
  label: string;
  sublabel?: string;
  title?: string;
  stacked?: boolean;
  children: React.ReactNode;
}) {
  if (stacked) {
    return (
      <div
        className="settings-row"
        style={{ paddingTop: 7, paddingBottom: 9, borderRadius: 4 }}
      >
        <div title={title} style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 13.5, color: "var(--color-text)", display: "block", fontWeight: 400 }}>
            {label}
          </span>
          {sublabel && (
            <span style={{ fontSize: 11, color: "var(--color-text-muted)", display: "block", marginTop: 2 }}>
              {sublabel}
            </span>
          )}
        </div>
        <div>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      className="settings-row flex items-center justify-between gap-4"
      style={{ paddingTop: 7, paddingBottom: 7, borderRadius: 4 }}
    >
      <div className="shrink-0" title={title}>
        <span style={{ fontSize: 13.5, color: "var(--color-text)", display: "block", fontWeight: 400 }}>
          {label}
        </span>
        {sublabel && (
          <span style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginTop: 2 }}>
            {sublabel}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap justify-end">
        {children}
      </div>
    </div>
  );
}

/** Segmented control - matches the layout-mode tabs in the header.
 *  `fullWidth` stretches to fill its container, each button sharing equal space. */
function BtnGroup<T extends string | number>({
  options,
  value,
  onChange,
  fullWidth = false,
  "aria-label": ariaLabel,
}: {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  fullWidth?: boolean;
  "aria-label"?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: fullWidth ? "flex" : "inline-flex",
        width: fullWidth ? "100%" : undefined,
        padding: 3,
        background: "var(--color-surface-2)",
        borderRadius: 8,
        border: "1px solid var(--color-border)",
        gap: 2,
        flexShrink: 0,
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            title={opt.title}
            style={{
              padding: "3px 10px",
              borderRadius: 5,
              border: "none",
              background: active ? "var(--color-accent)" : "transparent",
              color: active ? "#fff" : "var(--color-text-muted)",
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 0.12s",
              flexShrink: fullWidth ? 0 : 0,
              flex: fullWidth ? 1 : undefined,
              whiteSpace: "nowrap",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Section header - always open, no accordion collapse ───────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b" style={{ borderColor: "var(--color-border)" }}>
      {/* Plain text label - no background, just spacing */}
      <div
        className="text-xs font-bold uppercase select-none"
        style={{
          color: "var(--color-text)",
          letterSpacing: "0.07em",
          paddingLeft: 20,
          paddingRight: 20,
          paddingTop: 14,
          paddingBottom: 6,
        }}
      >
        {title}
      </div>
      <div style={{ paddingLeft: 20, paddingRight: 20 }}>
        {children}
      </div>
    </div>
  );
}

/** Lightweight divider that names a sub-group within a Section. */
function SubHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase" as const,
        color: "var(--color-text-muted)",
        paddingTop: 12,
        paddingBottom: 2,
        marginTop: 4,
        borderTop: "1px solid var(--color-border)",
      }}
    >
      {children}
    </div>
  );
}

// ── Reset button ─────────────────────────────────────────────────────────────

function ResetButton() {
  const { resetSettings } = useAppStore();
  const isDark = useAppStore((s) => s.settings.theme === "dark");
  const [confirmed, setConfirmed] = useState(false);
  const [hovered, setHovered] = useState(false);

  const handleClick = () => {
    if (!confirmed) {
      setConfirmed(true);
      setTimeout(() => setConfirmed(false), 3000);
    } else {
      resetSettings();
      setConfirmed(false);
    }
  };

  return (
    <div style={{ padding: "16px 20px 24px", display: "flex", flexDirection: "column", gap: 10 }}>

      {/* Support link */}
      <a
        href="https://ko-fi.com/gigliof"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          width: "100%",
          padding: "8px 0",
          borderRadius: 8,
          border: "1px solid var(--color-accent-subtle-border)",
          background: "var(--color-accent-subtle)",
          color: "var(--color-accent-text)",
          fontSize: 12,
          fontWeight: 500,
          textDecoration: "none",
          transition: "opacity 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.75")}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
      >
        <MetronomeIcon /> Buy me a metronome
      </a>

      <button
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title="Reset all settings to their default values"
        style={{
          width: "100%",
          padding: "8px 0",
          borderRadius: 8,
          border: confirmed
            ? "1px solid rgba(239,68,68,0.55)"
            : hovered
            ? "1px solid rgba(239,68,68,0.35)"
            : "1px solid var(--color-border)",
          background: confirmed
            ? "rgba(239,68,68,0.08)"
            : "var(--color-surface-2)",
          color: confirmed || hovered ? "#f87171" : "var(--color-text-muted)",
          fontSize: 12,
          fontWeight: 500,
          fontFamily: "inherit",
          cursor: "pointer",
          transition: "all 0.15s",
        }}
      >
        {confirmed ? "Click again to confirm reset" : "Reset to defaults"}
      </button>

      {/* Logo mark — links to GitHub repo */}
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 8, paddingBottom: 4 }}>
        <a href="https://github.com/gigliof/bach-to-basics" target="_blank" rel="noopener noreferrer" style={{ lineHeight: 0 }}>
          <img
            src="/logo.png"
            alt="Bach to Basics on GitHub"
            draggable={false}
            style={{ width: 72, height: "auto", opacity: isDark ? 0.35 : 0.18, filter: isDark ? "invert(1)" : "none" }}
          />
        </a>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SettingsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { settings, updateSettings } = useAppStore();

  // Computes the inline style for range inputs.
  // Sets --fill-pct so the CSS gradient draws the correct filled/unfilled split.
  const rangeStyle = (value: number, min: number, max: number): React.CSSProperties => {
    const pct = `${((value - min) / (max - min)) * 100}%`;
    return { "--fill-pct": pct } as React.CSSProperties;
  };

  const handleColorThemeChange = (t: ColorTheme) => {
    if (t === "custom") {
      const seed: CustomColors =
        settings.colorTheme !== "custom"
          ? COLOR_PRESET_VALUES[settings.colorTheme]
          : settings.customColors;
      updateSettings({ colorTheme: "custom", customColors: seed });
    } else {
      updateSettings({ colorTheme: t });
    }
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 999,
            background: "rgba(0,0,0,0.4)",
          }}
        />
      )}

      {/* Drawer */}
      <div
        style={{
          position: "fixed",
          right: 0,
          top: 0,
          height: "100vh",
          width: 360,
          zIndex: 1000,
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.2s ease",
          background: "var(--color-surface)",
          borderLeft: "1px solid var(--color-border)",
          boxShadow: "-6px 0 24px rgba(0,0,0,0.14)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between shrink-0 border-b"
          style={{ borderColor: "var(--color-border)", padding: "14px 20px" }}
        >
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text)" }}>
            Settings
          </span>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-border)",
              borderRadius: 7,
              color: "var(--color-text-muted)",
              cursor: "pointer",
              fontSize: 14,
              lineHeight: 1,
            }}
            title="Close settings"
            aria-label="Close settings"
          >
            ×
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto" style={{ overflowX: "hidden" }}>

          {/* ── Appearance ─────────────────────────────────────────────────── */}
          <Section title="Appearance">

            {/* Color theme - swatch grid */}
            <div style={{ padding: "10px 0 4px" }}>
              <span style={{ fontSize: 13.5, color: "var(--color-text)", fontWeight: 400 }}>
                Color theme
              </span>
            </div>
            <div style={{ padding: "0 0 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Preset swatches - 5 in a row */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                {(["violet", "classic", "ocean", "forest", "cascade"] as const).map((theme) => {
                  const colors = COLOR_PRESET_VALUES[theme];
                  const active = settings.colorTheme === theme;
                  return (
                    <button
                      key={theme}
                      onClick={() => handleColorThemeChange(theme)}
                      title={COLOR_THEME_LABELS[theme]}
                      aria-label={`Color theme: ${COLOR_THEME_LABELS[theme]}`}
                      aria-pressed={active}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 5,
                        padding: "8px 4px 6px",
                        borderRadius: 8,
                        border: active
                          ? "2px solid var(--color-accent)"
                          : "2px solid var(--color-border)",
                        background: active
                          ? "var(--color-accent-subtle)"
                          : "var(--color-surface-2)",
                        cursor: "pointer",
                        transition: "border-color 0.15s, background 0.15s",
                      }}
                    >
                      {/* Two colour dots with L / R labels */}
                      <div style={{ display: "flex", gap: 5 }}>
                        {(
                          [
                            { color: colors.leftHand,  label: "L" },
                            { color: colors.rightHand, label: "R" },
                          ] as { color: string; label: string }[]
                        ).map(({ color, label }) => (
                          <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                            <span style={{
                              width: 11, height: 11, borderRadius: "50%",
                              background: color,
                              boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                              display: "block",
                            }} />
                            <span style={{ fontSize: 8, fontWeight: 700, color: "var(--color-text-muted)", lineHeight: 1 }}>
                              {label}
                            </span>
                          </div>
                        ))}
                      </div>
                      <span style={{
                        fontSize: 10,
                        fontWeight: active ? 700 : 500,
                        color: active ? "var(--color-accent-text)" : "var(--color-text-muted)",
                        letterSpacing: "0.02em",
                        lineHeight: 1,
                      }}>
                        {COLOR_THEME_LABELS[theme]}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Custom - separate row */}
              <button
                onClick={() => handleColorThemeChange("custom")}
                aria-pressed={settings.colorTheme === "custom"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 10px",
                  borderRadius: 8,
                  border: settings.colorTheme === "custom"
                    ? "2px solid var(--color-accent)"
                    : "2px solid var(--color-border)",
                  background: settings.colorTheme === "custom"
                    ? "var(--color-accent-subtle)"
                    : "var(--color-surface-2)",
                  cursor: "pointer",
                  width: "100%",
                  transition: "border-color 0.15s, background 0.15s",
                }}
              >
                {/* Live dots with L / R / ? labels */}
                <div style={{ display: "flex", gap: 5 }}>
                  {(
                    [
                      { key: "leftHand"  as const, label: "L" },
                      { key: "rightHand" as const, label: "R" },
                      { key: "unknown"   as const, label: "?" },
                    ]
                  ).map(({ key, label }) => (
                    <div key={key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                      <span style={{
                        width: 10, height: 10, borderRadius: "50%",
                        background: settings.customColors[key],
                        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                        display: "block",
                      }} />
                      <span style={{ fontSize: 8, fontWeight: 700, color: "var(--color-text-muted)", lineHeight: 1 }}>
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
                <span style={{
                  fontSize: 12,
                  fontWeight: settings.colorTheme === "custom" ? 700 : 500,
                  color: settings.colorTheme === "custom" ? "var(--color-accent-text)" : "var(--color-text-muted)",
                }}>
                  Custom
                </span>
                <span style={{ fontSize: 11, color: "var(--color-text-muted)", marginLeft: "auto" }}>
                  pick your own colors
                </span>
              </button>

              {/* Custom color pickers - shown inline when custom is active */}
              {settings.colorTheme === "custom" && (
                <div style={{
                  display: "flex",
                  gap: 12,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "var(--color-surface-2)",
                  border: "1px solid var(--color-border)",
                }}>
                  {(
                    [
                      { key: "leftHand"  as keyof CustomColors, label: "Left hand" },
                      { key: "rightHand" as keyof CustomColors, label: "Right hand" },
                      { key: "unknown"   as keyof CustomColors, label: "Other" },
                    ] as { key: keyof CustomColors; label: string }[]
                  ).map(({ key, label }) => (
                    <label
                      key={key}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: "pointer", flex: 1 }}
                    >
                      <input
                        type="color"
                        value={settings.customColors[key]}
                        onChange={(e) =>
                          updateSettings({
                            customColors: { ...settings.customColors, [key]: e.target.value },
                          })
                        }
                        style={{
                          width: 36, height: 28,
                          padding: 2,
                          border: "1px solid var(--color-border)",
                          borderRadius: 6,
                          background: "none",
                          cursor: "pointer",
                        }}
                      />
                      <span style={{ fontSize: 10, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                        {label}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {/* Differentiate hands - toggle + live L/R legend */}
              {(() => {
                const activeColors = settings.colorTheme === "custom"
                  ? settings.customColors
                  : COLOR_PRESET_VALUES[settings.colorTheme as Exclude<ColorTheme, "custom">];
                return (
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: "4px 10px 6px",
                    borderRadius: 8,
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        <span style={{ fontSize: 13, color: "var(--color-text)", fontWeight: 500 }}>
                          Differentiate hands
                        </span>
                        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                          Works with two-track MIDI files
                        </span>
                      </div>
                      <Toggle
                        active={settings.showHandColors}
                        onClick={() => updateSettings({ showHandColors: !settings.showHandColors })}
                      />
                    </div>
                    {settings.showHandColors && (
                      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        {(
                          [
                            { color: activeColors.leftHand,  label: "Left hand" },
                            { color: activeColors.rightHand, label: "Right hand" },
                          ] as { color: string; label: string }[]
                        ).map(({ color, label }) => (
                          <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <span style={{
                              width: 10, height: 10, borderRadius: "50%",
                              background: color, display: "inline-block",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                            }} />
                            <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* ── Keyboard sub-group ──────────────────────────────────────── */}
            <SubHeader>Keyboard</SubHeader>

            {/* Key color - custom picker with mini piano-key previews */}
            <Row label="Key color" title="Visual colour of the piano keyboard's white keys">
              <div
                role="radiogroup"
                aria-label="Piano key colour"
                style={{ display: "inline-flex", gap: 6 }}
              >
                {(
                  [
                    {
                      value: "white" as const,
                      label: "White",
                      title: "Bright white piano keys",
                      topColor: "#c4c4bc",
                      midColor: "#f5f5f0",
                      btmColor: "#e4e4dc",
                    },
                    {
                      value: "ivory" as const,
                      label: "Ivory",
                      title: "Warm cream-toned piano keys",
                      topColor: "#cdc8a8",
                      midColor: "#fff8e7",
                      btmColor: "#e8e0c8",
                    },
                  ] as { value: "white" | "ivory"; label: string; title: string; topColor: string; midColor: string; btmColor: string }[]
                ).map(({ value, label, title, topColor, midColor, btmColor }) => {
                  const active = settings.pianoTheme === value;
                  return (
                    <button
                      key={value}
                      role="radio"
                      aria-checked={active}
                      onClick={() => updateSettings({ pianoTheme: value })}
                      title={title}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 5,
                        padding: "6px 10px 5px",
                        borderRadius: 8,
                        border: active
                          ? "2px solid var(--color-accent)"
                          : "2px solid var(--color-border)",
                        background: active
                          ? "var(--color-accent-subtle)"
                          : "var(--color-surface-3)",
                        cursor: "pointer",
                        transition: "border-color 0.15s, background 0.15s",
                        fontFamily: "inherit",
                      }}
                    >
                      {/* Mini piano key */}
                      <div style={{
                        width: 20,
                        height: 34,
                        borderRadius: "0 0 3px 3px",
                        background: `linear-gradient(to bottom, ${topColor} 0%, ${midColor} 8%, ${midColor} 88%, ${btmColor} 100%)`,
                        border: "1px solid rgba(0,0,0,0.18)",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.18)",
                      }} />
                      <span style={{
                        fontSize: 11,
                        fontWeight: active ? 700 : 400,
                        color: active ? "var(--color-accent-text)" : "var(--color-text-muted)",
                        lineHeight: 1,
                      }}>
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Row>

            <Row
              label="Labels"
              title="Which keys on the piano keyboard display their note name"
              sublabel="on the keyboard"
              stacked
            >
              <BtnGroup
                aria-label="Keyboard label mode"
                options={NOTE_LABEL_OPTIONS}
                value={settings.noteLabelMode}
                onChange={(v) => updateSettings({ noteLabelMode: v })}
                fullWidth
              />
            </Row>

            <Row
              label="Use flats ♭"
              sublabel="affects all note labels"
              title="Show accidentals as flats (D♭) instead of sharps (C♯)"
            >
              <Toggle
                active={settings.useFlats}
                onClick={() => updateSettings({ useFlats: !settings.useFlats })}
              />
            </Row>

            {/* ── Falling notes sub-group ─────────────────────────────────── */}
            <SubHeader>Falling notes</SubHeader>

            <Row
              label="Labels"
              title="Which falling note bars display their pitch name"
              sublabel="on note bars"
              stacked
            >
              <BtnGroup
                aria-label="Falling note bar label mode"
                options={NOTE_LABEL_OPTIONS}
                value={settings.fallingNotesLabelMode}
                onChange={(v) => updateSettings({ fallingNotesLabelMode: v })}
                fullWidth
              />
            </Row>

            <Row
              label="Note filter"
              sublabel="which notes appear in canvas"
              title="Show only a subset of notes in the falling notes view"
              stacked
            >
              <BtnGroup
                aria-label="Note filter"
                options={NOTE_FILTER_OPTIONS}
                value={settings.noteFilter}
                onChange={(v) => updateSettings({ noteFilter: v })}
                fullWidth
              />
            </Row>

            <Row
              label="Octave grid"
              sublabel="separator lines between octaves"
              title="Draw subtle separator lines between octaves in the falling notes view"
            >
              <Toggle
                active={settings.showGrid}
                onClick={() => updateSettings({ showGrid: !settings.showGrid })}
              />
            </Row>

            <Row
              label="Min note height"
              sublabel="prevents staccato notes from disappearing"
              title="Minimum pixel height for note bars - keeps short staccato notes visible at any tempo"
              stacked
            >
              <div className="flex items-center gap-1.5">
                <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>4</span>
                <input
                  type="range"
                  min={4}
                  max={24}
                  step={1}
                  value={settings.minNoteHeight}
                  onChange={(e) => updateSettings({ minNoteHeight: Number(e.target.value) })}
                  aria-label="Minimum note height in pixels"
                  aria-valuetext={`${settings.minNoteHeight}px`}
                  className="flex-1"
                  style={rangeStyle(settings.minNoteHeight, 4, 24)}
                />
                <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>24</span>
                <span className="text-xs tabular-nums" style={{ color: "var(--color-text)", marginLeft: 2, minWidth: 36, textAlign: "right" }}>
                  {settings.minNoteHeight}px
                </span>
              </div>
            </Row>

            <Row
              label="Note roundness"
              sublabel="corner radius of note bars"
              title="Border radius of falling note bars - 0 is sharp corners, 12 is fully rounded"
              stacked
            >
              <div className="flex items-center gap-1.5">
                <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>0</span>
                <input
                  type="range"
                  min={0}
                  max={12}
                  step={1}
                  value={settings.noteCornerRadius}
                  onChange={(e) => updateSettings({ noteCornerRadius: Number(e.target.value) })}
                  aria-label="Note corner radius"
                  aria-valuetext={`${settings.noteCornerRadius}`}
                  className="flex-1"
                  style={rangeStyle(settings.noteCornerRadius, 0, 12)}
                />
                <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>12</span>
                <span className="text-xs tabular-nums" style={{ color: "var(--color-text)", marginLeft: 2, minWidth: 36, textAlign: "right" }}>
                  {settings.noteCornerRadius}px
                </span>
              </div>
            </Row>

            <Row
              label="Note outline"
              sublabel="colored border around note bars"
              title="Draw a colored border stroke around each falling note bar using its hand color"
            >
              <Toggle
                active={settings.showNoteOutline}
                onClick={() => updateSettings({ showNoteOutline: !settings.showNoteOutline })}
              />
            </Row>

            <Row
              label="White score background"
              sublabel="keep sheet music on white in dark mode"
              title="Render sheet music on a white background even in dark mode"
            >
              <Toggle
                active={settings.sheetMusicWhiteBackground}
                onClick={() => updateSettings({ sheetMusicWhiteBackground: !settings.sheetMusicWhiteBackground })}
              />
            </Row>

          </Section>

          {/* ── Overlays ───────────────────────────────────────────────────── */}
          <Section title="Overlays">

            <Row
              label="Measure numbers"
              sublabel="on the left edge of falling notes"
              title="Show measure numbers along the left edge of the falling notes view"
            >
              <Toggle
                active={settings.showMeasureNums}
                onClick={() => updateSettings({ showMeasureNums: !settings.showMeasureNums })}
              />
            </Row>

            <Row
              label="Beat lines"
              sublabel="horizontal grid lines at each beat"
              title="Draw faint horizontal lines at each beat and measure boundary to aid rhythm reading"
            >
              <Toggle
                active={settings.showBeatLines}
                onClick={() => updateSettings({ showBeatLines: !settings.showBeatLines })}
              />
            </Row>

            <Row
              label="Sustain pedal"
              sublabel="shaded bands show CC64 pedal regions"
              title="Visualize sustain pedal (CC64) on/off periods as semi-transparent bands in the falling notes view"
            >
              <Toggle
                active={settings.showSustainPedal}
                onClick={() => updateSettings({ showSustainPedal: !settings.showSustainPedal })}
              />
            </Row>

            <Row
              label="Sustained note ghost"
              sublabel="ghost at keyboard while pedal is held"
              title="Keep a faint ghost indicator for notes that have ended while the sustain pedal is still held"
            >
              <Toggle
                active={settings.showSustainedNotes}
                onClick={() => updateSettings({ showSustainedNotes: !settings.showSustainedNotes })}
              />
            </Row>

            <Row
              label="Impact effect"
              sublabel="visual when notes hit the keyboard"
              title="Choose the visual effect that plays when a note reaches the hit line"
              stacked
            >
              <BtnGroup
                aria-label="Impact effect style"
                options={[
                  { value: "off"   as ImpactStyle, label: "Off",   title: "No visual effect on note impact" },
                  { value: "bloom" as ImpactStyle, label: "Bloom",  title: "Soft expanding ring (default)" },
                  { value: "side"  as ImpactStyle, label: "Side",   title: "Particles burst left & right from note edges at impact" },
                  { value: "trail" as ImpactStyle, label: "Trail",  title: "Sparkles drift off the bar sides as it falls" },
                ]}
                value={settings.impactStyle}
                onChange={(v) => updateSettings({ impactStyle: v as ImpactStyle })}
              />
            </Row>

          </Section>

          {/* ── Playback ───────────────────────────────────────────────────── */}
          <Section title="Playback">

            <Row
              label="Note window"
              sublabel="seconds of notes visible at once"
              title="How many seconds of music are visible in the falling notes view at once. Lower = notes appear larger and slower."
              stacked
            >
              <div className="flex items-center gap-1.5">
                <span style={{ fontSize: 10, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>2s</span>
                <input
                  type="range"
                  min={2}
                  max={10}
                  step={0.5}
                  value={settings.viewportSeconds}
                  onChange={(e) => updateSettings({ viewportSeconds: Number(e.target.value) })}
                  aria-label="Note window - seconds of music visible"
                  aria-valuetext={`${settings.viewportSeconds} seconds`}
                  className="flex-1"
                  style={rangeStyle(settings.viewportSeconds, 2, 10)}
                />
                <span style={{ fontSize: 10, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>10s</span>
                <span className="text-xs tabular-nums" style={{ color: "var(--color-text)", marginLeft: 2, minWidth: 36, textAlign: "right" }}>
                  {settings.viewportSeconds}s
                </span>
              </div>
            </Row>

            <Row
              label="Transpose"
              sublabel="shift all notes by semitones"
              title="Shift all notes up or down by semitones. Affects both audio playback and display."
              stacked
            >
              <div className="flex items-center gap-1.5">
                <span style={{ fontSize: 10, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>-6♭</span>
                <input
                  type="range"
                  min={-6}
                  max={6}
                  step={1}
                  value={settings.transposeSemitones}
                  onChange={(e) => updateSettings({ transposeSemitones: Number(e.target.value) })}
                  aria-label="Transpose in semitones"
                  aria-valuetext={formatTranspose(settings.transposeSemitones)}
                  className="flex-1"
                  style={rangeStyle(settings.transposeSemitones, -6, 6)}
                />
                <span style={{ fontSize: 10, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>+6♯</span>
                <span className="text-xs tabular-nums" style={{ color: "var(--color-text)", marginLeft: 2, minWidth: 52, textAlign: "right", flexShrink: 0, whiteSpace: "nowrap" }}>
                  {formatTranspose(settings.transposeSemitones)}
                </span>
              </div>
            </Row>

            <Row
              label="Audio offset"
              sublabel="compensate for audio interface latency"
              title="Shift audio scheduling by ±ms. Positive values play audio earlier - use this if you hear notes after the visual cue due to interface or Bluetooth latency."
              stacked
            >
              <div className="flex items-center gap-1.5">
                <span style={{ fontSize: 10, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>-200</span>
                <input
                  type="range"
                  min={-200}
                  max={200}
                  step={5}
                  value={settings.renderOffset}
                  onChange={(e) => updateSettings({ renderOffset: Number(e.target.value) })}
                  aria-label="Audio offset in milliseconds"
                  aria-valuetext={`${settings.renderOffset}ms`}
                  className="flex-1"
                  style={rangeStyle(settings.renderOffset, -200, 200)}
                />
                <span style={{ fontSize: 10, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>+200</span>
                <span className="text-xs tabular-nums" style={{ color: "var(--color-text)", marginLeft: 2, minWidth: 40, textAlign: "right" }}>
                  {settings.renderOffset > 0 ? `+${settings.renderOffset}` : settings.renderOffset}ms
                </span>
              </div>
            </Row>

            <Row
              label="Scroll to seek"
              sublabel="mouse wheel scrubs playback position"
              title="When enabled, scrolling the mouse wheel on the falling notes canvas moves the playback position forward or backward"
            >
              <Toggle
                active={settings.scrollToSeek}
                onClick={() => updateSettings({ scrollToSeek: !settings.scrollToSeek })}
              />
            </Row>

            <Row
              label="Instrument"
              sublabel="sound used for playback"
              title="The instrument sound used when playing back notes. Switching loads new samples from the CDN."
              stacked
            >
              <BtnGroup
                aria-label="Instrument"
                options={INSTRUMENT_OPTIONS}
                value={settings.instrument}
                onChange={(v) => updateSettings({ instrument: v as InstrumentId })}
                fullWidth
              />
            </Row>

            <SubHeader>Practice</SubHeader>

            <Row
              label="Wait hand"
              sublabel="which hand triggers wait mode pauses"
              title="When Wait mode is active, choose which hand's notes cause playback to pause until you play them"
              stacked
            >
              <BtnGroup
                aria-label="Wait mode hand"
                options={[
                  { value: "left"  as const, label: "Left",  title: "Pause only for left hand notes - right hand plays through automatically" },
                  { value: "both"  as const, label: "Both",  title: "Pause for both hands (default)" },
                  { value: "right" as const, label: "Right", title: "Pause only for right hand notes - left hand plays through automatically" },
                ]}
                value={settings.waitForHand}
                onChange={(v) => updateSettings({ waitForHand: v as "left" | "right" | "both" })}
                fullWidth
              />
            </Row>

            <Row
              label="Hand volumes"
              sublabel="balance each hand independently"
              title="Reduce a hand's volume without muting it - useful when drilling the other hand"
              stacked
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(["left", "right"] as const).map((hand) => (
                  <div key={hand} className="flex items-center gap-2">
                    <span style={{ fontSize: 11, color: "var(--color-text-muted)", width: 28, flexShrink: 0 }}>
                      {hand === "left" ? "Left" : "Right"}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={settings.handVolume[hand]}
                      onChange={(e) => updateSettings({ handVolume: { ...settings.handVolume, [hand]: Number(e.target.value) } })}
                      aria-label={`${hand === "left" ? "Left" : "Right"} hand volume`}
                      aria-valuetext={`${Math.round(settings.handVolume[hand] * 100)}%`}
                      className="flex-1"
                      style={rangeStyle(settings.handVolume[hand], 0, 1)}
                    />
                    <span className="text-xs tabular-nums" style={{ color: "var(--color-text)", width: 32, textAlign: "right", flexShrink: 0 }}>
                      {Math.round(settings.handVolume[hand] * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </Row>

            <Row
              label="Count-in bars"
              sublabel="silent bars before playback starts"
              title="Number of metronome bars to count before playback begins. Useful for getting your hands ready."
              stacked
            >
              <BtnGroup
                aria-label="Count-in bars"
                options={[
                  { value: 0 as const, label: "0 bars", title: "No count-in - start immediately" },
                  { value: 1 as const, label: "1 bar",  title: "One bar count-in" },
                  { value: 2 as const, label: "2 bars", title: "Two bars count-in" },
                ]}
                value={settings.countInBars}
                onChange={(v) => updateSettings({ countInBars: v as 0 | 1 | 2 })}
                fullWidth
              />
            </Row>

            <Row
              label="Speed trainer"
              sublabel="ramps tempo up after each loop pass"
              title="Automatically increase tempo after each complete loop pass, stepping from Start% up to End%"
            >
              <Toggle
                active={settings.speedTrainer.enabled}
                onClick={() =>
                  updateSettings({
                    speedTrainer: { ...settings.speedTrainer, enabled: !settings.speedTrainer.enabled },
                  })
                }
              />
            </Row>

            {/* Speed trainer sub-rows: number inputs to sliders with % units */}
            {settings.speedTrainer.enabled && (
              <>
                <Row
                  label="Start speed"
                  sublabel="Tempo % when trainer begins"
                  title="Tempo percentage to start from when the speed trainer resets"
                  stacked
                >
                  <div className="flex items-center gap-1.5">
                    <span style={{ fontSize: 10, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>25%</span>
                    <input
                      type="range"
                      min={25}
                      max={100}
                      step={5}
                      value={settings.speedTrainer.startPct}
                      onChange={(e) =>
                        updateSettings({
                          speedTrainer: { ...settings.speedTrainer, startPct: Number(e.target.value) },
                        })
                      }
                      aria-label="Speed trainer start percentage"
                      aria-valuetext={`${settings.speedTrainer.startPct}%`}
                      className="flex-1"
                      style={rangeStyle(settings.speedTrainer.startPct, 25, 100)}
                    />
                    <span style={{ fontSize: 10, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>100%</span>
                    <span className="text-xs tabular-nums" style={{ color: "var(--color-text)", marginLeft: 2, minWidth: 36, textAlign: "right" }}>
                      {settings.speedTrainer.startPct}%
                    </span>
                  </div>
                </Row>

                <Row
                  label="End speed"
                  sublabel="Maximum tempo % to reach"
                  title="Maximum tempo percentage the speed trainer will reach (100 = full speed)"
                  stacked
                >
                  <div className="flex items-center gap-1.5">
                    <span style={{ fontSize: 10, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>50%</span>
                    <input
                      type="range"
                      min={50}
                      max={200}
                      step={5}
                      value={settings.speedTrainer.endPct}
                      onChange={(e) =>
                        updateSettings({
                          speedTrainer: { ...settings.speedTrainer, endPct: Number(e.target.value) },
                        })
                      }
                      aria-label="Speed trainer end percentage"
                      aria-valuetext={`${settings.speedTrainer.endPct}%`}
                      className="flex-1"
                      style={rangeStyle(settings.speedTrainer.endPct, 50, 200)}
                    />
                    <span style={{ fontSize: 10, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>200%</span>
                    <span className="text-xs tabular-nums" style={{ color: "var(--color-text)", marginLeft: 2, minWidth: 36, textAlign: "right" }}>
                      {settings.speedTrainer.endPct}%
                    </span>
                  </div>
                </Row>

                <Row
                  label="Step"
                  sublabel="% added per loop pass"
                  title="How many percentage points to add to the tempo after each complete loop pass"
                  stacked
                >
                  <div className="flex items-center gap-1.5">
                    <span style={{ fontSize: 10, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>1%</span>
                    <input
                      type="range"
                      min={1}
                      max={20}
                      step={1}
                      value={settings.speedTrainer.stepPct}
                      onChange={(e) =>
                        updateSettings({
                          speedTrainer: { ...settings.speedTrainer, stepPct: Number(e.target.value) },
                        })
                      }
                      aria-label="Speed trainer step percentage"
                      aria-valuetext={`${settings.speedTrainer.stepPct}%`}
                      className="flex-1"
                      style={rangeStyle(settings.speedTrainer.stepPct, 1, 20)}
                    />
                    <span style={{ fontSize: 10, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>20%</span>
                    <span className="text-xs tabular-nums" style={{ color: "var(--color-text)", marginLeft: 2, minWidth: 36, textAlign: "right" }}>
                      {settings.speedTrainer.stepPct}%
                    </span>
                  </div>
                </Row>
              </>
            )}

          </Section>

          {/* ── Reset to defaults ─────────────────────────────────────────── */}
          <ResetButton />

        </div>
      </div>
    </>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const MetronomeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {/* Trapezoid body - wider at base, tapers toward top */}
    <path d="M5 21L9 3h6l4 18H5z"/>
    {/* Pendulum rod - angled to suggest motion */}
    <line x1="11" y1="21" x2="15" y2="3"/>
    {/* Weight - small circle riding the rod at mid-height */}
    <circle cx="13" cy="12" r="1.5"/>
  </svg>
);
