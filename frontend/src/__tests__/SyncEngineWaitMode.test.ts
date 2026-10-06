import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicDocument, NoteEvent } from "@bach-to-basics/shared";

const scheduled = vi.hoisted(() => [] as Array<() => void>);
const mockTransport = vi.hoisted(() => ({
  seconds: 0,
  bpm: { value: 120 },
  state: "started" as "started" | "stopped" | "paused",
  cancel: vi.fn(),
  start: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
  scheduleRepeat: vi.fn(),
  scheduleOnce: vi.fn((cb: () => void) => {
    scheduled.push(cb);
    return scheduled.length;
  }),
}));

vi.mock("tone", () => ({
  getTransport: () => mockTransport,
  start: vi.fn().mockResolvedValue(undefined),
  Synth: class {
    toDestination() { return this; }
    triggerAttackRelease() {}
  },
}));

const audioInstances = vi.hoisted(() => [] as Array<{
  load: ReturnType<typeof vi.fn>;
  wake: ReturnType<typeof vi.fn>;
  playNote: ReturnType<typeof vi.fn>;
  playMidi: ReturnType<typeof vi.fn>;
  stopNote: ReturnType<typeof vi.fn>;
  stopAll: ReturnType<typeof vi.fn>;
  setInstrument: ReturnType<typeof vi.fn>;
}>);

vi.mock("../engine/AudioEngine", () => ({
  AudioEngine: class {
    load = vi.fn().mockResolvedValue(undefined);
    wake = vi.fn().mockResolvedValue(undefined);
    playNote = vi.fn();
    playMidi = vi.fn();
    stopNote = vi.fn();
    stopAll = vi.fn();
    setInstrument = vi.fn().mockResolvedValue(undefined);
    constructor() {
      audioInstances.push(this as unknown as (typeof audioInstances)[number]);
    }
  },
}));

import { SyncEngine } from "../engine/SyncEngine";

function note(id: string, midi: number, startSeconds: number, hand: "left" | "right" | "unknown" = "right"): NoteEvent {
  return {
    id,
    midi,
    pitch: "C4",
    startTick: 0,
    durationTick: 480,
    startSeconds,
    endSeconds: startSeconds + 1,
    hand,
    finger: null,
    velocity: 80,
    channel: 0,
  };
}

function doc(notes: NoteEvent[]): MusicDocument {
  return {
    id: "test",
    title: "test",
    sourceType: "midi",
    musicXml: null,
    midiBuffer: null,
    notes,
    tempoMap: [{ tick: 0, bpm: 120 }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    totalDuration: 10,
    ppq: 480,
    keySignature: null,
    youtubeId: null,
    youtubeSyncOffset: 0,
    fingeringVersion: "none",
  };
}

type TestEngineInternals = {
  _state: { status: "stopped" | "playing" | "paused" | "waiting" };
  onTick(seconds: number): void;
};

describe("SyncEngine wait mode", () => {
  beforeEach(() => {
    scheduled.length = 0;
    audioInstances.length = 0;
    mockTransport.seconds = 0;
    mockTransport.cancel.mockClear();
    mockTransport.start.mockClear();
    mockTransport.pause.mockClear();
    mockTransport.stop.mockClear();
    mockTransport.scheduleRepeat.mockClear();
    mockTransport.scheduleOnce.mockClear();
  });

  it("waits at the actual onset and resumes only after the expected note", async () => {
    const engine = new SyncEngine();
    await engine.loadDocument(doc([note("n1", 60, 1)]));
    engine.setWaitMode(true);

    const testEngine = engine as unknown as TestEngineInternals;
    testEngine._state.status = "playing";
    testEngine.onTick(0);

    expect(scheduled.length).toBe(2); // wait-onset + visual note-off
    expect(engine.state.status).toBe("playing");

    scheduled[0]();
    expect(engine.state.status).toBe("waiting");
    expect(audioInstances[0].playNote).not.toHaveBeenCalled();

    engine.onMidiInput(61, 80);
    expect(engine.state.status).toBe("waiting");

    engine.onMidiInput(60, 80);
    expect(engine.state.status).toBe("playing");
    expect(mockTransport.start).toHaveBeenCalled();
  });

  it("waits for every pitch in a chord before resuming", async () => {
    const engine = new SyncEngine();
    await engine.loadDocument(doc([
      note("c", 60, 1),
      note("e", 64, 1),
      note("g", 67, 1),
    ]));
    engine.setWaitMode(true);

    const testEngine = engine as unknown as TestEngineInternals;
    testEngine._state.status = "playing";
    testEngine.onTick(0);

    expect(scheduled.length).toBe(4); // one group onset + three note-offs
    scheduled[0]();
    expect(engine.state.status).toBe("waiting");

    engine.onMidiInput(60, 80);
    engine.onMidiInput(64, 80);
    expect(engine.state.status).toBe("waiting");

    engine.onMidiInput(67, 80);
    expect(engine.state.status).toBe("playing");
  });

  it("keeps live notes sounding while CC64 is down and releases them on pedal-up", async () => {
    const engine = new SyncEngine();
    await engine.loadDocument(doc([]));

    engine.setSustainPedal(true);
    expect(engine.state.sustainPedalDown).toBe(true);

    await engine.playMidi(60, 90);
    engine.stopMidi(60);
    expect(audioInstances[0].stopNote).not.toHaveBeenCalled();

    engine.setSustainPedal(false);
    expect(engine.state.sustainPedalDown).toBe(false);
    expect(audioInstances[0].stopNote).toHaveBeenCalledWith(60);
  });

  it("separates visual note-off from source-MIDI sustain audio release", async () => {
    const engine = new SyncEngine();
    const source = doc([note("n1", 60, 1)]);
    source.sustainRanges = [{ startSeconds: 0.5, endSeconds: 3 }];
    await engine.loadDocument(source);

    const testEngine = engine as unknown as TestEngineInternals;
    testEngine._state.status = "playing";
    testEngine.onTick(0);

    expect(scheduled.length).toBe(3); // note-on + visual note-off + sustained audio off
    scheduled[0]();
    expect(audioInstances[0].playNote).toHaveBeenCalled();

    scheduled[1]();
    expect(audioInstances[0].stopNote).not.toHaveBeenCalled();

    scheduled[2]();
    expect(audioInstances[0].stopNote).toHaveBeenCalledWith(60, "n1");
  });

  it("matches the transposed pitch instead of the source MIDI pitch", async () => {
    const engine = new SyncEngine();
    await engine.loadDocument(doc([note("n1", 60, 1)]));
    engine.setTranspose(2);
    engine.setWaitMode(true);

    const testEngine = engine as unknown as TestEngineInternals;
    testEngine._state.status = "playing";
    testEngine.onTick(0);

    scheduled[0]();
    expect(engine.state.status).toBe("waiting");

    engine.onMidiInput(60, 80);
    expect(engine.state.status).toBe("waiting");

    engine.onMidiInput(62, 80);
    expect(engine.state.status).toBe("playing");
  });
});
