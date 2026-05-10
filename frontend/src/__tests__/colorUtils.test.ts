import { describe, it, expect } from "vitest";
import { lighten, hexToNum } from "../utils/colorUtils";

describe("hexToNum", () => {
  it("converts a CSS hex string to a packed number", () => {
    expect(hexToNum("#ff0000")).toBe(0xff0000);
    expect(hexToNum("#00ff00")).toBe(0x00ff00);
    expect(hexToNum("#0000ff")).toBe(0x0000ff);
    expect(hexToNum("#9333ea")).toBe(0x9333ea);
  });

  it("works without the leading #", () => {
    expect(hexToNum("ffffff")).toBe(0xffffff);
  });
});

describe("lighten", () => {
  it("factor 1.0 returns the original color", () => {
    expect(lighten(0xff0000, 1.0)).toBe(0xff0000);
    expect(lighten(0x9333ea, 1.0)).toBe(0x9333ea);
  });

  it("factor 0 returns black", () => {
    expect(lighten(0xffffff, 0)).toBe(0x000000);
    expect(lighten(0x9333ea, 0)).toBe(0x000000);
  });

  it("darkens each channel proportionally", () => {
    // 0x80 = 128; 128 * 0.5 = 64 = 0x40
    expect(lighten(0x808080, 0.5)).toBe(0x404040);
  });

  it("clamps channels at 255 when factor > 1", () => {
    expect(lighten(0xffffff, 2.0)).toBe(0xffffff);
    expect(lighten(0x808080, 2.0)).toBe(0xffffff); // 128 * 2 = 256 → clamped to 255
  });

  it("handles zero channel values", () => {
    // Red only - green and blue stay 0
    // Math.round(255 * 0.5) = Math.round(127.5) = 128 = 0x80
    expect(lighten(0xff0000, 0.5)).toBe(0x800000);
  });
});
