import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicDocument, NoteEvent } from "@bach-to-basics/shared";

const transport = vi.hoisted(() => ({
  seconds: 0, bpm: { value: 120 },
  cancel: vi.fn(), start: vi.fn(), pause: vi.fn(), stop: vi.fn(),
  scheduleRepeat: vi.fn(), scheduleOnce: vi.fn(),
}));
vi.mock("tone", () => ({ getTransport: () => transport, start: vi.fn().mockResolvedValue(undefined) }));

function note(midi: number, time: number, hand: NoteEvent["hand"] = "right"): NoteEvent {
  return { id: `${hand}-${midi}-${time}`, midi, pitch: "", startSeconds: time,
    endSeconds: time + 0.5, startTick: time * 480, durationTick: 240,
    hand, finger: null, velocity: 90, channel: 0 };
}
function document(notes: NoteEvent[]): MusicDocument {
  return { id: "test", title: "Practice", sourceType: "musicxml", musicXml: null,
    midiBuffer: null, notes, tempoMap: [{tick: 0, bpm: 120}], timeSignatures: [],
    totalDuration: 10, ppq: 480, keySignature: null, youtubeId: null,
    youtubeSyncOffset: 0, fingeringVersion: "none" };
}
let engine: typeof import("../engine/SyncEngine").syncEngine;
async function start(notes: NoteEvent[]) {
  await engine.loadDocument(document(notes));
  engine.setWaitMode(true);
  await engine.play();
}
function tick(seconds: number) {
  transport.seconds = seconds;
  const calls = transport.scheduleRepeat.mock.calls;
  calls[calls.length - 1][0]();
}
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  transport.seconds = 0;
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  engine = (await import("../engine/SyncEngine")).syncEngine;
  vi.spyOn(engine.audio, "load").mockResolvedValue(undefined);
});

describe("Wait-mode MIDI matching", () => {
  it("silences zero-volume guide notes without muting live input or disabling wait matching", async () => {
    const guide = vi.spyOn(engine.audio, "playNote").mockImplementation(() => {});
    const live = vi.spyOn(engine.audio, "playMidi").mockImplementation(() => {});
    engine.setHandVolume({ left: 1, right: 0 });
    await start([note(60, 0)]);
    tick(0);
    // Execute the scheduled note-on, as Tone would at this onset.
    transport.scheduleOnce.mock.calls[0][0]();
    expect(guide).not.toHaveBeenCalled();
    expect(engine.state.status).toBe("waiting");
    await engine.playMidi(60, 90);
    expect(live).toHaveBeenCalledWith(60, 90);
    expect(engine.state.status).toBe("playing");
  });

  it("matches the current note even after the scheduler has looked ahead, then waits for the next", async () => {
    await start([note(60, 0), note(62, 1), note(64, 2)]);
    tick(0);
    expect(transport.scheduleOnce).toHaveBeenCalledTimes(6);
    expect(engine.state.status).toBe("waiting");
    engine.onMidiInput(62, 90);
    expect(engine.state.status).toBe("waiting");
    engine.onMidiInput(60, 90);
    expect(engine.state.status).toBe("playing");
    tick(0.5);
    expect(engine.state.status).toBe("playing");
    tick(1);
    expect(engine.state.status).toBe("waiting");
    engine.onMidiInput(62, 90);
    expect(engine.state.status).toBe("playing");
    tick(2);
    expect(engine.state.status).toBe("waiting");
    engine.onMidiInput(64, 90);
    expect(engine.state.status).toBe("playing");
  });
  it("accepts all chord pitches in either order and ignores wrong octaves and zero velocity", async () => {
    await start([note(48, 0, "left"), note(60, 0), note(64, 0)]);
    tick(0);
    engine.onMidiInput(72, 90);
    engine.onMidiInput(48, 0);
    engine.onMidiInput(64, 90);
    engine.onMidiInput(60, 90);
    expect(engine.state.status).toBe("waiting");
    engine.onMidiInput(48, 90);
    expect(engine.state.status).toBe("playing");
  });
  it("matches transposed pitches", async () => {
    engine.setTranspose(2);
    await start([note(60, 0)]);
    tick(0);
    engine.onMidiInput(60, 90);
    expect(engine.state.status).toBe("waiting");
    engine.onMidiInput(62, 90);
    expect(engine.state.status).toBe("playing");
  });
  it("waits only for the selected hand", async () => {
    engine.setWaitForHand("right");
    await start([note(48, 0, "left"), note(60, 0), note(50, 1, "left"), note(62, 2)]);
    tick(0);
    engine.onMidiInput(60, 90);
    expect(engine.state.status).toBe("playing");
    tick(1);
    expect(engine.state.status).toBe("playing");
    tick(2);
    expect(engine.state.status).toBe("waiting");
  });
  it("releases a wait when disabled and resets matching after a seek", async () => {
    await start([note(60, 0), note(62, 1)]);
    tick(0);
    engine.setWaitMode(false);
    expect(engine.state.status).toBe("playing");
    engine.seek(1);
    engine.setWaitMode(true);
    tick(0);
    expect(engine.state.status).toBe("waiting");
    engine.onMidiInput(62, 90);
    expect(engine.state.status).toBe("playing");
  });
  it("drops a pending hand when the practice hand changes", async () => {
    await start([note(48, 0, "left"), note(60, 0)]);
    tick(0);
    engine.onMidiInput(60, 90);
    expect(engine.state.status).toBe("waiting");
    engine.setWaitForHand("right");
    expect(engine.state.status).toBe("playing");
  });
});

 it("clears the loop for a different song but preserves it during score enrichment", async () => {
    const score = document([note(60, 0)]);
    await engine.loadDocument(score);
    engine.setLoopPoints(2, 4);
    await engine.loadDocument({ ...score, musicXml: "updated notation" });
    expect(engine.state.loopStart).toBe(2);
    expect(engine.state.loopEnd).toBe(4);
    await engine.loadDocument({ ...score, id: "another-song" });
    expect(engine.state.loopStart).toBeNull();
    expect(engine.state.loopEnd).toBeNull();
  });
