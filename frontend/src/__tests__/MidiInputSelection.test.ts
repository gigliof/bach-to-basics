import { describe, expect, it, vi } from "vitest";
import type { Input } from "webmidi";
import { MidiInputSelection } from "../engine/MidiInputSelection";

function device(id: string, name = id) {
  const handlers = new Map<string, Set<(event: unknown) => void>>();
  const input = {
    id, name, state: "connected",
    addListener: vi.fn((type: string, callback: (event: unknown) => void) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(callback);
    }),
    removeListener: vi.fn((type: string, callback: (event: unknown) => void) => {
      handlers.get(type)?.delete(callback);
    }),
  };
  return {
    input: input as unknown as Input,
    emit: (type: string, note = 60) => handlers.get(type)?.forEach((fn) => fn({ note: { number: note }, rawValue: 90 })),
  };
}
function setup() {
  const callbacks = { changed: vi.fn(), noteOn: vi.fn(), noteOff: vi.fn() };
  return { callbacks, selection: new MidiInputSelection(callbacks) };
}

describe("automatic MIDI selection", () => {
  it("selects the first input on startup and forwards notes once across repeated port events", () => {
    const { callbacks, selection } = setup();
    const a = device("a"), b = device("b");
    selection.refresh([a.input, b.input]);
    selection.refresh([a.input, b.input]);
    a.emit("noteon"); b.emit("noteon");
    expect(callbacks.noteOn).toHaveBeenCalledExactlyOnceWith(60, 90);
    expect(callbacks.changed).toHaveBeenLastCalledWith([a.input, b.input], a.input);
  });
  it("connects after launch, preserves manual selection, and falls back on unplug", () => {
    const { callbacks, selection } = setup();
    const a = device("a", "Piano"), b = device("b", "Piano");
    selection.refresh([]);
    selection.refresh([a.input]);
    expect(callbacks.changed).toHaveBeenLastCalledWith([a.input], a.input);
    selection.refresh([a.input, b.input]);
    selection.select("b");
    selection.refresh([a.input, b.input]);
    expect(callbacks.changed).toHaveBeenLastCalledWith([a.input, b.input], b.input);
    b.emit("noteon", 64);
    selection.refresh([a.input]);
    expect(callbacks.noteOff).toHaveBeenCalledWith(64);
    expect(callbacks.changed).toHaveBeenLastCalledWith([a.input], a.input);
    b.emit("noteon", 65);
    expect(callbacks.noteOn).toHaveBeenCalledTimes(1);
    selection.refresh([]);
    expect(callbacks.changed).toHaveBeenLastCalledWith([], null);
  });
  it("ignores disconnected ports and reconnects a returned input", () => {
    const { callbacks, selection } = setup();
    const a = device("a");
    selection.refresh([a.input]);
    Object.assign(a.input, { state: "disconnected" });
    selection.refresh([a.input]);
    expect(callbacks.changed).toHaveBeenLastCalledWith([], null);
    Object.assign(a.input, { state: "connected" });
    selection.refresh([a.input]);
    expect(callbacks.changed).toHaveBeenLastCalledWith([a.input], a.input);
  });
  it("honors manual disconnect until reconnection or explicit selection", () => {
    const { callbacks, selection } = setup();
    const a = device("a"), b = device("b");
    selection.refresh([a.input, b.input]);
    selection.disconnect();
    selection.refresh([a.input, b.input]);
    expect(callbacks.changed).toHaveBeenLastCalledWith([a.input, b.input], null);
    selection.refresh([b.input]);
    selection.refresh([a.input, b.input]);
    expect(callbacks.changed).toHaveBeenLastCalledWith([a.input, b.input], a.input);
    selection.disconnect();
    selection.select("b");
    expect(callbacks.changed).toHaveBeenLastCalledWith([a.input, b.input], b.input);
  });
  it("releases held notes and removes only owned listeners on cleanup", () => {
    const { callbacks, selection } = setup();
    const a = device("a");
    const otherListener = vi.fn();
    a.input.addListener("noteon", otherListener);
    selection.refresh([a.input]);
    a.emit("noteon");
    selection.dispose();
    expect(callbacks.noteOff).toHaveBeenCalledExactlyOnceWith(60);
    a.emit("noteon");
    expect(callbacks.noteOn).toHaveBeenCalledTimes(1);
    expect(otherListener).toHaveBeenCalledTimes(2);
  });
});
