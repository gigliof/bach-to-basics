import { describe, expect, it } from "vitest";
import type { MusicDocument } from "@bach-to-basics/shared";
import type { AppSettings } from "../store/useAppStore";
import { isRestorable, mergeStoredSettings, serializeSettings } from "../store/persistence";

const defaults = {
  theme: "dark",
  showFingering: false,
  viewportSeconds: 4,
  instrument: "grand",
  activeHands: new Set(["left", "right"]),
  handVolume: { left: 1, right: 1 },
  speedTrainer: { enabled: false, startPct: 60, endPct: 100, stepPct: 5, currentPct: 60 },
} as unknown as AppSettings;

const roundTrip = (s: AppSettings) =>
  mergeStoredSettings(JSON.parse(JSON.stringify(serializeSettings(s))), defaults);

describe("settings persistence", () => {
  it("round-trips changed settings, including Sets and nested objects", () => {
    const changed = {
      ...defaults,
      showFingering: true,
      viewportSeconds: 6,
      instrument: "harpsichord",
      activeHands: new Set(["right"]),
      handVolume: { left: 0, right: 0.5 },
    } as AppSettings;
    const back = roundTrip(changed);
    expect(back.showFingering).toBe(true);
    expect(back.viewportSeconds).toBe(6);
    expect(back.instrument).toBe("harpsichord");
    expect(back.activeHands).toEqual(new Set(["right"]));
    expect(back.handVolume).toEqual({ left: 0, right: 0.5 });
  });

  it("doesn't store the theme (it keeps its own key and OS default)", () => {
    expect(serializeSettings(defaults)).not.toHaveProperty("theme");
    expect(mergeStoredSettings({ theme: "light" }, defaults).theme).toBe("dark");
  });

  it("falls back to defaults for wrong types and ignores unknown keys", () => {
    const back = mergeStoredSettings(
      {
        showFingering: "yes",
        viewportSeconds: null,
        activeHands: "left",
        removedSetting: 42,
        handVolume: { left: "loud", right: 0.3, extra: 1 },
      },
      defaults
    );
    expect(back.showFingering).toBe(false);
    expect(back.viewportSeconds).toBe(4);
    expect(back.activeHands).toEqual(new Set(["left", "right"]));
    expect(back).not.toHaveProperty("removedSetting");
    expect(back.handVolume).toEqual({ left: 1, right: 0.3 });
  });

  it("adds settings that didn't exist when the user last saved", () => {
    const back = mergeStoredSettings({ showFingering: true }, defaults);
    expect(back.speedTrainer).toEqual(defaults.speedTrainer);
  });

  it("ignores garbage", () => {
    expect(mergeStoredSettings(null, defaults)).toBe(defaults);
    expect(mergeStoredSettings([1, 2], defaults)).toBe(defaults);
  });
});

describe("last song", () => {
  it("only remembers fully imported songs", () => {
    expect(isRestorable(null)).toBe(false);
    expect(isRestorable({ notes: [] } as unknown as MusicDocument)).toBe(false);
    expect(isRestorable({ notes: [{}] } as unknown as MusicDocument)).toBe(true);
  });
});
