import { useMemo } from "react";
import { spreadLabels } from "../../utils/chordNames";
import { useAppStore } from "../../store/useAppStore";
import { detectChords } from "../../utils/chordNames";
import type { ChordLayout } from "../../utils/sheetNoteLabels";

/**
 * Chord names above the staff, detected from the notes (only where 3+ notes are
 * struck together and form a known chord). Skipped when the file has its own
 * chord symbols, which alphaTab already draws.
 */
export function SheetChordLabels({
  layout,
  offsetX,
  offsetY,
  compact,
}: {
  layout: ChordLayout | null;
  offsetX: number;
  offsetY: number;
  /** Smaller text for the short sheet band in the All view */
  compact: boolean;
}) {
  const enabled = useAppStore((s) => s.settings.sheetChordNames);
  const useFlats = useAppStore((s) => s.settings.useFlats);
  const chords = useMemo(
    () => (enabled && layout && !layout.fileHasChords ? detectChords(layout.notes, useFlats) : []),
    [enabled, layout, useFlats]
  );
  const size = compact ? 10 : 13;
  // Measure each name and nudge crowded ones right so neighbours never overlap
  const placed = useMemo(() => {
    if (!layout || chords.length === 0) return [];
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) ctx.font = `700 ${size}px ${getComputedStyle(document.body).fontFamily}`;
    const items = chords.flatMap((c) => {
      const at = layout.anchors.get(c.start);
      if (!at) return [];
      const width = ctx ? ctx.measureText(c.name).width : c.name.length * size * 0.65;
      return [{ ...c, x: at.x, y: at.y, width }];
    });
    return spreadLabels(items, 4);
  }, [layout, chords, size]);
  if (placed.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      data-chord-names=""
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
      {placed.map((c) => (
        <span
          key={c.start}
          style={{
            position: "absolute",
            left: c.x,
            top: c.y - size - 6,
            fontSize: size,
            fontWeight: 700,
            lineHeight: 1,
            whiteSpace: "nowrap",
            color: "var(--color-accent-text)",
          }}
        >
          {c.name}
        </span>
      ))}
    </div>
  );
}
