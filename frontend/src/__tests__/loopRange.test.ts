import { describe, expect, it } from "vitest";
import { loopRange, loopTime } from "../utils/loopRange";

describe("loop bounds", () => {
  it("preserves fractional seconds", () => expect(loopRange(90, 12.3, 45.6)).toEqual([12.3, 45.6]));
  it("clamps endpoints to the song", () => expect(loopRange(30, -4, 99)).toEqual([0, 30]));
  it("prevents crossed or empty ranges", () => {
    const [a, b] = loopRange(30, 20, 10);
    expect(a).toBeCloseTo(9.9); expect(b).toBe(10);
    expect(loopRange(30, 0, 0)).toEqual([0, .1]);
  });
  it("handles songs shorter than the normal step", () => expect(loopRange(.05, 1, 1)).toEqual([0, .05]));
  it("disables invalid or cleared loops", () => {
    expect(loopRange(30, null, null)).toEqual([null, null]);
    expect(loopRange(0, 0, 30)).toEqual([null, null]);
    expect(loopRange(30, NaN, 12)).toEqual([null, null]);
  });
  it("formats fractional times and minute boundaries", () => {
    expect(loopTime(12.3)).toBe("0:12.3");
    expect(loopTime(59.99)).toBe("1:00.0");
    expect(loopTime(125.6)).toBe("2:05.6");
  });
});
