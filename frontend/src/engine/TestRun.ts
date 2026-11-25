/**
 * TestRun - wires one Test Mode run to the live app: feeds the piece's notes
 * and the player's key presses into a TestScorer, and reports when the run
 * finishes (end of the tested section) or is cancelled (pause, stop, seek).
 */
import type { NoteEvent } from "@bach-to-basics/shared";
import bus from "./EventBus";
import { syncEngine } from "./SyncEngine";
import {
  TEST_WINDOW_MS,
  TestScorer,
  type TestHand,
  type TestResult,
  type TestTotals,
} from "./TestScorer";

export interface TestRunOptions {
  hands: Set<TestHand>;
  fromSeconds: number;
  toSeconds: number;
  onUpdate: (totals: TestTotals) => void;
  onFinish: (result: TestResult) => void;
  onCancel: () => void;
}

/** Starts a run; returns a function that cancels it. */
export function startTestRun(opts: TestRunOptions): () => void {
  const scorer = new TestScorer();
  const now = () => performance.now();
  const isScored = (n: NoteEvent) => n.hand === "unknown" || opts.hands.has(n.hand as TestHand);
  let active = true;

  const push = () => opts.onUpdate(scorer.totals);
  const onNote = (n: NoteEvent) => {
    scorer.noteStarted({ midi: n.midi, hand: n.hand as TestHand | "unknown" }, now(), isScored(n));
    push();
  };
  const onInput = ({ midi }: { midi: number }) => {
    scorer.input(midi, now());
    push();
  };
  const onState = ({ status }: { status: string }) => {
    if (status === "paused" || status === "stopped") cancel();
  };
  const timer = setInterval(() => {
    scorer.advance(now());
    push();
  }, 250);

  function detach() {
    active = false;
    clearInterval(timer);
    bus.off("note:on", onNote);
    bus.off("transport:stateChange", onState);
    bus.off("transport:seek", cancel);
    bus.off("test:finished", onFinished);
  }
  function cancel() {
    if (!active) return;
    detach();
    bus.off("input:note:on", onInput);
    syncEngine.endTest();
    opts.onCancel();
  }
  function onFinished() {
    if (!active) return;
    detach();
    // Keep listening to the keyboard for one more hit window, so the last
    // notes of the section get the same chance as every other note.
    setTimeout(() => {
      bus.off("input:note:on", onInput);
      opts.onFinish(scorer.finish());
    }, TEST_WINDOW_MS);
  }

  bus.on("note:on", onNote);
  bus.on("input:note:on", onInput);
  bus.on("transport:stateChange", onState);
  bus.on("transport:seek", cancel);
  bus.on("test:finished", onFinished);

  syncEngine.beginTest(opts.hands, opts.toSeconds);
  syncEngine.play(opts.fromSeconds).catch(cancel);
  return cancel;
}
