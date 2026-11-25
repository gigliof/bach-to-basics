import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import type { TestHand } from "../../engine/TestScorer";
import type { BestScore } from "../../utils/bestScores";

type HandChoice = "left" | "both" | "right";
const handsFor = (c: HandChoice): TestHand[] => (c === "both" ? ["left", "right"] : [c]);
const choiceFor = (hands: TestHand[]): HandChoice => (hands.length === 2 ? "both" : hands[0]);

// Remembered for "Try again" and the next time the setup screen opens
let lastChoice: HandChoice = "both";

/** Test Mode's setup and results screens (nothing renders while a run is in progress). */
export function TestDialogs() {
  const testState = useAppStore((s) => s.testState);
  if (testState?.phase === "setup") return <TestSetup />;
  if (testState?.phase === "results") return <TestResults />;
  return null;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

function TestSetup() {
  const { startTest, closeTest, midiEnabled, loopStart, loopEnd, tempoMultiplier, settings } =
    useAppStore();
  const [choice, setChoice] = useState<HandChoice>(lastChoice);
  const isLoop = loopStart !== null && loopEnd !== null && loopEnd > loopStart;

  const start = () => {
    lastChoice = choice;
    startTest(handsFor(choice));
  };

  return (
    <Dialog title="Test" onClose={closeTest}>
      <p style={{ margin: 0, color: "var(--color-text-muted)" }}>
        Play {isLoop ? "the A–B section" : "the piece"} once from the start, without pauses. You get
        a score at the end.
      </p>

      <div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Hands to test</div>
        <Segmented
          value={choice}
          onChange={setChoice}
          options={[
            { value: "left", label: "Left" },
            { value: "both", label: "Both" },
            { value: "right", label: "Right" },
          ]}
        />
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--color-text-muted)" }}>
          {choice === "both"
            ? "You play every note."
            : `You play the ${choice} hand; the app plays the other.`}
        </div>
      </div>

      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--color-text-muted)" }}>
        <li>Tempo: {Math.round(tempoMultiplier * 100)}%</li>
        <li>
          {Math.max(1, settings.countInBars)} bar{settings.countInBars > 1 ? "s" : ""} of count-in
        </li>
        <li>Pausing, stopping or seeking cancels the test.</li>
      </ul>

      {!midiEnabled && (
        <div style={{ fontSize: 12, color: "var(--color-warning)" }}>
          No MIDI keyboard connected. Connect one from the top bar, or play on the on-screen keys.
        </div>
      )}

      <Buttons>
        <DialogButton onClick={closeTest}>Cancel</DialogButton>
        <DialogButton primary onClick={start} autoFocus>
          Start test
        </DialogButton>
      </Buttons>
    </Dialog>
  );
}

// ── Results ───────────────────────────────────────────────────────────────────

function verdict(score: number): string {
  if (score >= 90) return "Excellent!";
  if (score >= 75) return "Good job";
  if (score >= 50) return "Getting there";
  return "Keep practising";
}

function scoreColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 50) return "#eab308";
  return "#ef4444";
}

function TestResults() {
  const testState = useAppStore((s) => s.testState);
  const { startTest, closeTest } = useAppStore();
  if (testState?.phase !== "results") return null;
  const { result, hands, tempoPct, section, previousBest, isNewBest } = testState;
  const handLabel =
    hands.length === 2 ? "Both hands" : `${hands[0] === "left" ? "Left" : "Right"} hand`;

  return (
    <Dialog title="Test results" onClose={closeTest}>
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: 48,
            fontWeight: 700,
            lineHeight: 1.1,
            color: scoreColor(result.score),
          }}
          aria-label={`Score ${result.score} percent`}
        >
          {result.score}%
        </div>
        <div style={{ fontWeight: 600 }}>{verdict(result.score)}</div>
        <BestLine previousBest={previousBest} isNewBest={isNewBest} tempoPct={tempoPct} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        <Stat label="Correct" value={result.correct} color="#22c55e" />
        <Stat label="Missed" value={result.missed} color="#eab308" />
        <Stat label="Wrong" value={result.wrong} color="#ef4444" />
      </div>

      {hands.length === 2 && (
        <div style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center" }}>
          {(["left", "right"] as const)
            .filter((h) => result.byHand[h].total > 0)
            .map(
              (h) =>
                `${h === "left" ? "Left" : "Right"} hand: ${result.byHand[h].correct}/${result.byHand[h].total} notes`
            )
            .join(" · ")}
        </div>
      )}

      <div style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center" }}>
        {handLabel} · {section === "loop" ? "A–B section" : "Whole piece"} · {tempoPct}% tempo
      </div>

      <Buttons>
        <DialogButton onClick={closeTest}>Close</DialogButton>
        <DialogButton primary onClick={() => startTest(handsFor(choiceFor(hands)))} autoFocus>
          Try again
        </DialogButton>
      </Buttons>
    </Dialog>
  );
}

/** "New best!" / "Your best: 82%" under the score (nothing on a first run). */
function BestLine({
  previousBest,
  isNewBest,
  tempoPct,
}: {
  previousBest: BestScore | null;
  isNewBest: boolean;
  tempoPct: number;
}) {
  if (!previousBest) return null;
  const atTempo = (pct: number) => (pct === tempoPct ? "" : ` at ${pct}% tempo`);
  return (
    <div
      style={{
        marginTop: 4,
        fontSize: 12,
        color: isNewBest ? "#22c55e" : "var(--color-text-muted)",
        fontWeight: isNewBest ? 600 : 400,
      }}
    >
      {isNewBest
        ? `New best! (previous: ${previousBest.score}%${atTempo(previousBest.tempoPct)})`
        : `Your best: ${previousBest.score}%${atTempo(previousBest.tempoPct)}`}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        background: "var(--color-surface-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        padding: "8px 4px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{label}</div>
    </div>
  );
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2500,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="test-dialog-title"
        style={{
          width: "100%",
          maxWidth: 380,
          background: "var(--color-surface)",
          color: "var(--color-text)",
          border: "1px solid var(--color-border)",
          borderRadius: 12,
          boxShadow: "0 16px 48px rgba(0,0,0,0.45)",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        <h2 id="test-dialog-title" style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

function Buttons({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>{children}</div>;
}

function DialogButton({
  primary,
  onClick,
  autoFocus,
  children,
}: {
  primary?: boolean;
  onClick: () => void;
  autoFocus?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <button
      ref={ref}
      onClick={onClick}
      style={{
        height: 32,
        padding: "0 14px",
        borderRadius: 7,
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: "pointer",
        border: primary ? "none" : "1px solid var(--color-border)",
        background: primary ? "var(--color-accent)" : "var(--color-surface-2)",
        color: primary ? "#fff" : "var(--color-text)",
      }}
    >
      {children}
    </button>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Hands to test"
      style={{
        display: "flex",
        padding: 3,
        background: "var(--color-surface-2)",
        borderRadius: 8,
        border: "1px solid var(--color-border)",
        gap: 2,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            style={{
              flex: 1,
              padding: "4px 10px",
              borderRadius: 5,
              border: "none",
              background: active ? "var(--color-accent)" : "transparent",
              color: active ? "#fff" : "var(--color-text-muted)",
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
