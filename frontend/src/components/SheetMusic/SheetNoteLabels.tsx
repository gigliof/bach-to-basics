import { useMemo } from "react";
import { COLOR_PRESET_VALUES, useAppStore } from "../../store/useAppStore";
import { sheetNoteLabel, textColorOn, type SheetNoteBox } from "../../utils/sheetNoteLabels";

/**
 * Note names drawn over the sheet music. Lives outside alphaTab's container so
 * the dark-mode colour inversion applied to the score doesn't touch it.
 */
export function SheetNoteLabels({
  boxes,
  offsetX,
  offsetY,
  paper,
  ink,
}: {
  boxes: SheetNoteBox[];
  offsetX: number;
  offsetY: number;
  /** Sheet background and text colours, for open (half/whole) note rings */
  paper: string;
  ink: string;
}) {
  const settings = useAppStore((s) => s.settings);
  const colors =
    settings.colorTheme === "custom"
      ? settings.customColors
      : COLOR_PRESET_VALUES[settings.colorTheme];

  const labels = useMemo(
    () =>
      boxes
        .map((b) => ({
          b,
          text: sheetNoteLabel(b, settings.sheetNoteLabelMode, settings.useFlats),
        }))
        .filter((l) => l.text),
    [boxes, settings.sheetNoteLabelMode, settings.useFlats]
  );
  if (labels.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        left: offsetX,
        top: offsetY,
        width: 0,
        height: 0,
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      {labels.map(({ b, text }, i) => {
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        const color = settings.showHandColors
          ? colors[b.hand === "left" ? "leftHand" : b.hand === "right" ? "rightHand" : "unknown"]
          : "#64748b";
        // Disc about the size of the notehead so neighbours and chords stay apart
        const d = Math.min(18, Math.max(10, b.h * 1.25));
        // Wide enough for two-character names, and for wide whole-note heads
        const w = Math.max(d + (text.length > 1 ? d * 0.45 : 0), b.open ? b.w + 2 : 0);
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              left: cx - w / 2,
              top: cy - d / 2,
              width: w,
              height: d,
              boxSizing: "border-box",
              borderRadius: 999,
              // Open noteheads (half/whole) stay open: a ring on the paper colour
              background: b.open ? paper : color,
              border: b.open ? `${Math.max(1.5, d * 0.12)}px solid ${color}` : "none",
              color: b.open ? ink : textColorOn(color),
              fontSize: d * 0.66,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "-0.02em",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              whiteSpace: "nowrap",
            }}
          >
            {text}
          </span>
        );
      })}
    </div>
  );
}
