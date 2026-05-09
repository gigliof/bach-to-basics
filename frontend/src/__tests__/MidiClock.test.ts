/**
 * MidiClock tests
 *
 * MidiClock's core job is to track "doc-time" (song position in seconds)
 * using this formula:
 *
 *   currentSeconds = _startOffset + Tone.getTransport().seconds * tempoMultiplier
 *
 * We mock Tone.js so we can control Transport.seconds without a real audio context.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Tone.js mock ──────────────────────────────────────────────────────────────
// vi.hoisted() runs before module-level code so the value is available inside
// the vi.mock factory despite vi.mock being hoisted to the top of the file.

const mockTransport = vi.hoisted(() => ({
  seconds: 0,
  bpm: { value: 120 },
  state: "stopped" as "started" | "stopped" | "paused",
  cancel: vi.fn(),
  start: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
  scheduleRepeat: vi.fn(),
  scheduleOnce: vi.fn(),
}));

vi.mock("tone", () => ({
  getTransport: () => mockTransport,
  start: vi.fn().mockResolvedValue(undefined),
}));

import { MidiClock } from "../engine/MidiClock";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MidiClock", () => {
  let clock: MidiClock;

  beforeEach(() => {
    mockTransport.seconds = 0;
    mockTransport.cancel.mockClear();
    mockTransport.scheduleRepeat.mockClear();
    clock = new MidiClock();
  });

  // ── currentSeconds formula ────────────────────────────────────────────────

  it("returns 0 on creation (no offset, no transport time)", () => {
    expect(clock.currentSeconds).toBe(0);
  });

  it("currentSeconds = startOffset + transport.seconds * multiplier", () => {
    clock.seek(2); // _startOffset = 2, transport.seconds = 0
    mockTransport.seconds = 3;
    // 2 + 3 * 1.0 = 5
    expect(clock.currentSeconds).toBe(5);
  });

  it("applies tempoMultiplier to transport.seconds", () => {
    clock.seek(0);
    mockTransport.seconds = 4;
    clock.tempoMultiplier = 0.5;
    // After setting multiplier, _startOffset is recomputed to preserve currentSeconds.
    // currentSeconds before set = 0 + 4*1 = 4; after set: offset = 4 - 4*0.5 = 2
    // currentSeconds after = 2 + 4*0.5 = 4
    expect(clock.currentSeconds).toBeCloseTo(4);
  });

  // ── seek ─────────────────────────────────────────────────────────────────

  it("seek sets startOffset and resets transport.seconds to 0", () => {
    mockTransport.seconds = 10;
    clock.seek(5);
    expect(mockTransport.seconds).toBe(0);
    expect(clock.currentSeconds).toBe(5);
  });

  it("seek to 0 resets position to start", () => {
    clock.seek(30);
    clock.seek(0);
    expect(clock.currentSeconds).toBe(0);
  });

  // ── tempoMultiplier ───────────────────────────────────────────────────────

  describe("tempoMultiplier", () => {
    it("defaults to 1.0", () => {
      expect(clock.tempoMultiplier).toBe(1.0);
    });

    it("clamps values below 0.25 to 0.25", () => {
      clock.tempoMultiplier = 0.1;
      expect(clock.tempoMultiplier).toBe(0.25);
    });

    it("clamps values above 2.0 to 2.0", () => {
      clock.tempoMultiplier = 5.0;
      expect(clock.tempoMultiplier).toBe(2.0);
    });

    it("accepts boundary value 0.25", () => {
      clock.tempoMultiplier = 0.25;
      expect(clock.tempoMultiplier).toBe(0.25);
    });

    it("accepts boundary value 2.0", () => {
      clock.tempoMultiplier = 2.0;
      expect(clock.tempoMultiplier).toBe(2.0);
    });

    it("preserves currentSeconds when multiplier changes (no time jump)", () => {
      // Set a known position: offset=3, transport=2 → currentSeconds=5
      clock.seek(3);
      mockTransport.seconds = 2;
      expect(clock.currentSeconds).toBe(5);

      // Change multiplier — currentSeconds must remain 5
      clock.tempoMultiplier = 0.5;
      expect(clock.currentSeconds).toBeCloseTo(5);
    });

    it("preserves currentSeconds when multiplier increases", () => {
      clock.seek(1);
      mockTransport.seconds = 4;
      // currentSeconds = 1 + 4*1 = 5
      clock.tempoMultiplier = 2.0;
      // _startOffset = 5 - 4*2 = -3; currentSeconds = -3 + 4*2 = 5
      expect(clock.currentSeconds).toBeCloseTo(5);
    });
  });

  // ── reschedule ────────────────────────────────────────────────────────────

  it("reschedule resets transport.seconds and re-registers the tick callback", () => {
    clock.reschedule(7);
    expect(mockTransport.seconds).toBe(0);
    expect(mockTransport.scheduleRepeat).toHaveBeenCalledOnce();
    expect(clock.currentSeconds).toBe(7);
  });

  // ── state ─────────────────────────────────────────────────────────────────

  it("state reflects the mock transport state", () => {
    mockTransport.state = "paused";
    expect(clock.state).toBe("paused");
    mockTransport.state = "started";
    expect(clock.state).toBe("started");
  });
});
