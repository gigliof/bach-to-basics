import { useAppStore } from "../../store/useAppStore";
import { useAccuracy } from "../../hooks/useAccuracy";

function scoreColor(score: number): string {
  if (score >= 80) return "#4ade80";
  if (score >= 50) return "#eab308";
  return "#ef4444";
}

/**
 * Live score in the header, so it's visible in every view:
 * - during a Test Mode run: the test's score ("Test 85%")
 * - otherwise, while playing along on a MIDI keyboard: live accuracy
 */
export function ScorePill() {
  const { midiEnabled, status } = useAppStore();
  const testLive = useAppStore((s) => (s.testState?.phase === "running" ? s.testState.live : null));
  const liveAccuracy = useAccuracy(
    !testLive && midiEnabled && (status === "playing" || status === "paused")
  );
  const acc = testLive ?? liveAccuracy;
  const counted = acc.correct + acc.wrong + acc.missed > 0;

  // Outside a test, only show once there's something to score
  if (!testLive && (!midiEnabled || !counted)) return null;

  const label = testLive ? "Test" : "Accuracy";
  const color = counted ? scoreColor(acc.score) : "var(--color-text-muted)";
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={counted ? `${label} score ${acc.score} percent` : `${label} running`}
      title={
        testLive
          ? "Your score so far in this test"
          : "How accurately you're playing along (MIDI keyboard)"
      }
      className="flex items-center gap-1.5 text-xs font-semibold shrink-0"
      style={{
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        border: `1px solid ${counted ? `color-mix(in srgb, ${color} 50%, transparent)` : "var(--color-border)"}`,
        background: counted ? `color-mix(in srgb, ${color} 8%, transparent)` : "transparent",
        color,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <TargetIcon />
      {label} {counted ? `${acc.score}%` : "–"}
    </span>
  );
}

const TargetIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
    style={{ flexShrink: 0 }}
  >
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
  </svg>
);
