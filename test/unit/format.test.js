import { describe, it, expect } from "vitest";
import {
  formatNumber,
  formatMegabytes,
} from "../../packages/app/src/app/lib/format.ts";

describe("formatNumber", () => {
  it("trims to two decimals by default", () => {
    expect(formatNumber(1.85546875)).toBe("1.86");
  });

  it("avoids trailing zeros", () => {
    expect(formatNumber(2)).toBe("2");
    expect(formatNumber(2.5)).toBe("2.5");
  });
});

describe("formatMegabytes", () => {
  it("formats storage values consistently", () => {
    expect(formatMegabytes(0)).toBe("0");
    expect(formatMegabytes(12.3456)).toBe("12.35");
  });
});
