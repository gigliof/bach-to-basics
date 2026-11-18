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
  // Like Tone: cancel() drops every pending scheduled event
  cancel: vi.fn(() => sched.items.forEach((s) => (s.fired = true))),
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
    syncEngine.setRequireHeldNotes(false);
    syncEngine.resetLiveInput();
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

describe("wait mode: require held notes", () => {
  beforeEach(() => {
    sched.items.length = 0;
    syncEngine.setTranspose(0);
    syncEngine.setWaitForHand("both");
    syncEngine.setActiveHands(new Set(["left", "right"]));
    syncEngine.resetLiveInput();
    syncEngine.setRequireHeldNotes(true);
  });

  // Left-hand chord held for 2 s while the right hand plays at 0 and 1 s
  const piece = () => [
    note("c", 48, 0, "left", 2),
    note("e", 52, 0, "left", 2),
    note("r1", 72, 0, "right", 0.5),
    note("r2", 74, 1, "right", 0.5),
  ];

  async function playFirstBeat() {
    await setup(piece());
    eng.onTick(0);
    runUntil(0);
    [48, 52, 72].forEach((m) => syncEngine.onMidiInput(m, 80));
    expect(syncEngine.state.status).toBe("playing");
  }

  it("continues when the chord is still held at the next note", async () => {
    await playFirstBeat();
    syncEngine.onMidiInputOff(72);
    runUntil(1);
    syncEngine.onMidiInput(74, 80);
    expect(syncEngine.state.status).toBe("playing");
  });

  it("pauses until a chord note released early is pressed again", async () => {
    await playFirstBeat();
    syncEngine.onMidiInputOff(48); // let go of the low C too early
    runUntil(1);
    syncEngine.onMidiInput(74, 80);
    expect(syncEngine.state.status).toBe("waiting");
    syncEngine.onMidiInput(48, 80);
    expect(syncEngine.state.status).toBe("playing");
  });

  it("counts a note sustained by the pedal as held", async () => {
    await playFirstBeat();
    syncEngine.onSustainInput(true);
    syncEngine.onMidiInputOff(48);
    syncEngine.onMidiInputOff(52);
    runUntil(1);
    syncEngine.onMidiInput(74, 80);
    expect(syncEngine.state.status).toBe("playing");
  });

  it("doesn't ask to hold a note that is about to end", async () => {
    // r2 starts at 0.85, 0.15 s before r1 ends: letting go of r1 is normal phrasing
    await setup([note("r1", 72, 0, "right", 1), note("r2", 74, 0.85, "right", 0.5)]);
    eng.onTick(0);
    runUntil(0);
    syncEngine.onMidiInput(72, 80);
    syncEngine.onMidiInputOff(72);
    runUntil(0.85);
    syncEngine.onMidiInput(74, 80);
    expect(syncEngine.state.status).toBe("playing");
  });

  it("ignores the other hand's notes when waiting for one hand", async () => {
    await setup(piece());
    syncEngine.setWaitForHand("right");
    eng.onTick(0);
    runUntil(0);
    syncEngine.onMidiInput(72, 80);
    runUntil(1); // left chord is the app's part: nobody is holding it
    syncEngine.onMidiInput(74, 80);
    expect(syncEngine.state.status).toBe("playing");
  });

  it("is off by default: releasing early doesn't pause", async () => {
    syncEngine.setRequireHeldNotes(false);
    await playFirstBeat();
    syncEngine.onMidiInputOff(48);
    runUntil(1);
    syncEngine.onMidiInput(74, 80);
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

  it("a transpose change during playback applies to notes already scheduled", async () => {
    await setup([note("a", 60, 0), note("b", 62, 2)], false);
    eng.onTick(0); // both notes scheduled (within the 5 s lookahead)
    runUntil(0); // "a" sounds
    eng.onTick(1); // playback has moved on to 1 s
    syncEngine.setTranspose(3); // user transposes mid-playback
    eng.onTick(1); // next clock tick reschedules from 1 s
    runUntil(10);
    const pitches = audio.playNote.mock.calls.map((c) => (c[0] as NoteEvent).midi);
    // "a" already sounded at the old pitch; "b" must use the new one
    expect(pitches).toEqual([60, 65]);
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
