import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicDocument, NoteEvent } from "@bach-to-basics/shared";

// ── Fake Tone transport: records scheduleOnce callbacks so tests can fire them
// in time order, the way Tone would during playback.
type Scheduled = { delay: number; seq: number; cb: () => void; fired: boolean };
const sched = vi.hoisted(() => ({ items: [] as Scheduled[], seq: 0 }));
const transport = vi.hoisted(() => ({
  seconds: 0,
  bpm: { value: 120 },
  state: "started",
  cancel: vi.fn(),
  start: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
  scheduleRepeat: vi.fn(),
  scheduleOnce: vi.fn((cb: () => void, time: string) => {
    sched.items.push({ delay: Number(time.replace("+", "")), seq: sched.seq++, cb, fired: false });
    return sched.items.length;
  }),
}));

vi.mock("tone", () => ({
  getTransport: () => transport,
  start: vi.fn().mockResolvedValue(undefined),
  Synth: class {
    toDestination() {
      return this;
    }
    triggerAttackRelease() {}
  },
}));

vi.mock("../engine/AudioEngine", () => ({
  AudioEngine: class {
    load = vi.fn().mockResolvedValue(undefined);
    wake = vi.fn().mockResolvedValue(undefined);
    playNote = vi.fn();
    playMidi = vi.fn();
    stopNote = vi.fn();
    stopScheduledNote = vi.fn();
    stopAll = vi.fn();
    setInstrument = vi.fn().mockResolvedValue(undefined);
  },
}));

import { syncEngine } from "../engine/SyncEngine";

/** Fire every not-yet-fired event due at or before `delay`, in time then insertion order. */
function runUntil(delay: number) {
  const due = sched.items
    .filter((s) => !s.fired && s.delay <= delay + 1e-9)
    .sort((a, b) => a.delay - b.delay || a.seq - b.seq);
  for (const s of due) {
    if (syncEngine.state.status === "waiting") break; // transport paused
    s.fired = true;
    s.cb();
  }
}

const note = (
  id: string,
  midi: number,
  start: number,
  hand: NoteEvent["hand"] = "right",
  dur = 0.5
): NoteEvent => ({
  id,
  midi,
  pitch: "C4",
  startTick: 0,
  durationTick: 480,
  startSeconds: start,
  endSeconds: start + dur,
  hand,
  finger: null,
  velocity: 80,
  channel: 0,
});

const doc = (notes: NoteEvent[]): MusicDocument =>
  ({
    id: "t",
    title: "t",
    sourceType: "midi",
    musicXml: null,
    midiBuffer: null,
    notes,
    tempoMap: [{ tick: 0, bpm: 120 }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    totalDuration: 30,
    ppq: 480,
    keySignature: null,
    youtubeId: null,
    youtubeSyncOffset: 0,
    fingeringVersion: "none",
  }) as MusicDocument;

type Internals = { _state: { status: string }; onTick(s: number): void };
const eng = syncEngine as unknown as Internals;
const audio = syncEngine.audio as unknown as Record<string, ReturnType<typeof vi.fn>>;

async function setup(notes: NoteEvent[], waitMode = true) {
  await syncEngine.loadDocument(doc(notes));
  syncEngine.setWaitMode(waitMode);
  eng._state.status = "playing";
}

describe("wait mode", () => {
  beforeEach(() => {
    sched.items.length = 0;
    syncEngine.setTranspose(0);
    syncEngine.setWaitForHand("both");
    syncEngine.setActiveHands(new Set(["left", "right"]));
    syncEngine.setHandVolume({ left: 1, right: 1 });
    Object.values(audio).forEach((fn) => fn.mockClear?.());
  });

  it("pauses at each note and resumes when the player hits it", async () => {
    await setup([note("a", 60, 0), note("b", 62, 1), note("c", 64, 2)]);
    eng.onTick(0);
    runUntil(0);
    expect(syncEngine.state.status).toBe("waiting");
    syncEngine.onMidiInput(61, 80); // wrong note
    expect(syncEngine.state.status).toBe("waiting");
    syncEngine.onMidiInput(60, 80);
    expect(syncEngine.state.status).toBe("playing");
    runUntil(1);
    expect(syncEngine.state.status).toBe("waiting"); // next note pauses again
    syncEngine.onMidiInput(62, 80);
    expect(syncEngine.state.status).toBe("playing");
  });

  it("pauses for notes that entered the 5 s lookahead during normal playback", async () => {
    await setup([note("a", 60, 10)]);
    eng.onTick(5); // scheduled 5 s early
    runUntil(4.9);
    expect(syncEngine.state.status).toBe("playing");
    runUntil(5); // playback reaches the onset
    expect(syncEngine.state.status).toBe("waiting");
  });

  it("needs every note of a chord before resuming", async () => {
    await setup([note("c", 60, 0), note("e", 64, 0), note("g", 67, 0)]);
    eng.onTick(0);
    runUntil(0);
    syncEngine.onMidiInput(60, 80);
    syncEngine.onMidiInput(64, 80);
    expect(syncEngine.state.status).toBe("waiting");
    syncEngine.onMidiInput(67, 80);
    expect(syncEngine.state.status).toBe("playing");
  });

  it("waits for the transposed pitch", async () => {
    await setup([note("a", 60, 0)]);
    syncEngine.setTranspose(2);
    eng.onTick(0);
    runUntil(0);
    syncEngine.onMidiInput(60, 80);
    expect(syncEngine.state.status).toBe("waiting");
    syncEngine.onMidiInput(62, 80);
    expect(syncEngine.state.status).toBe("playing");
  });

  it("accepts a note hit slightly before the pause point", async () => {
    await setup([note("a", 60, 1)]);
    eng.onTick(0);
    syncEngine.onMidiInput(60, 80); // player is a hair early
    runUntil(1);
    expect(syncEngine.state.status).toBe("playing");
  });

  it("only waits for the selected hand, and still plays the other hand", async () => {
    await setup([note("r", 72, 0, "right"), note("l", 48, 0, "left")]);
    syncEngine.setWaitForHand("right");
    eng.onTick(0);
    runUntil(0);
    expect(syncEngine.state.status).toBe("waiting");
    syncEngine.onMidiInput(48, 80); // left-hand note doesn't count
    expect(syncEngine.state.status).toBe("waiting");
    const played = audio.playNote.mock.calls.map((c) => (c[0] as NoteEvent).id);
    expect(played).toEqual([]); // transport paused before the group's note-ons
    syncEngine.onMidiInput(72, 80);
    runUntil(0);
    expect(audio.playNote.mock.calls.map((c) => (c[0] as NoteEvent).id)).toEqual(["l"]);
  });

  it("doesn't play target notes through the app (the player plays them)", async () => {
    await setup([note("a", 60, 0)]);
    eng.onTick(0);
    runUntil(0);
    syncEngine.onMidiInput(60, 80);
    runUntil(0);
    expect(audio.playNote).not.toHaveBeenCalled();
  });

  it("resumes when wait mode is turned off while waiting", async () => {
    await setup([note("a", 60, 0)]);
    eng.onTick(0);
    runUntil(0);
    expect(syncEngine.state.status).toBe("waiting");
    syncEngine.setWaitMode(false);
    expect(syncEngine.state.status).toBe("playing");
  });
});

describe("scheduled playback audio", () => {
  beforeEach(() => {
    sched.items.length = 0;
    syncEngine.setTranspose(0);
    syncEngine.setHandVolume({ left: 1, right: 1 });
    Object.values(audio).forEach((fn) => fn.mockClear?.());
  });

  it("hand volume 0 is silent", async () => {
    await setup([note("l", 48, 0, "left"), note("r", 72, 0, "right")], false);
    syncEngine.setHandVolume({ left: 0, right: 1 });
    eng.onTick(0);
    runUntil(0);
    expect(audio.playNote.mock.calls.map((c) => (c[0] as NoteEvent).id)).toEqual(["r"]);
  });

  it("releasing a note doesn't cut off an overlapping note of the same pitch", async () => {
    await setup([note("a", 60, 0, "right", 1), note("b", 60, 0.5, "left", 1)], false);
    eng.onTick(0);
    runUntil(1); // a's release
    const released = audio.stopScheduledNote.mock.calls.map((c) => (c[0] as NoteEvent).id);
    expect(released).toEqual(["a"]); // only a's own voice
    expect(audio.stopNote).not.toHaveBeenCalled(); // never a pitch-wide stop
  });
});
