import { describe, expect, it } from "vitest";
import {
  calculateFbtFee,
  getFbtFeeBreakdown,
} from "./tiktokFbtCalculations";

describe("calculateFbtFee — weight bracket boundaries", () => {
  it("returns 0 for zero or missing weight (early guard)", () => {
    expect(calculateFbtFee(0, "single")).toBe(0);
    expect(calculateFbtFee(NaN, "single")).toBe(0);
  });

  it("returns 0 for missing orderType", () => {
    expect(calculateFbtFee(5, "")).toBe(0);
  });

  it("uses the 0.25 lb minimum bracket for tiny positive weights", () => {
    expect(calculateFbtFee(0.01, "single")).toBe(4.28);
    expect(calculateFbtFee(0.249, "single")).toBe(4.28);
  });

  it("crosses 0.25 cleanly into the next bracket", () => {
    expect(calculateFbtFee(0.249, "single")).toBe(4.28);
    expect(calculateFbtFee(0.25, "single")).toBe(4.52);
    expect(calculateFbtFee(0.499, "single")).toBe(4.52);
  });

  it("integer pound boundaries (4 → 5 lb) move to the next bracket", () => {
    expect(calculateFbtFee(4.999, "single")).toBe(7.66);
    expect(calculateFbtFee(5.0, "single")).toBe(8.58);
  });

  it("uses different fees for single vs multiple orders", () => {
    expect(calculateFbtFee(2.5, "single")).toBe(6.27);
    expect(calculateFbtFee(2.5, "multiple")).toBe(4.7);
  });

  // Regression: a previous bracket gap at [20, 21) silently returned $0.
  it("does NOT return 0 in the [20, 21) range (regression: bracket gap)", () => {
    expect(calculateFbtFee(20.0, "single")).toBeGreaterThan(0);
    expect(calculateFbtFee(20.5, "single")).toBeGreaterThan(0);
    expect(calculateFbtFee(20.999, "single")).toBeGreaterThan(0);
  });

  it("uses the 'over 21' formula at and above 20 lb", () => {
    // base 18.00 + 0.40 * max(0, weight - 21)
    expect(calculateFbtFee(20.0, "single")).toBe(18.0);
    expect(calculateFbtFee(20.5, "single")).toBe(18.0);
    expect(calculateFbtFee(21.0, "single")).toBe(18.0);
    expect(calculateFbtFee(22.0, "single")).toBe(18.4);
    expect(calculateFbtFee(30.0, "single")).toBe(21.6);
  });

  it("uses the 'over 51' formula at 51 lb and above", () => {
    // base 41.32 + 0.75 * max(0, weight - 51)
    expect(calculateFbtFee(50.999, "single")).toBeCloseTo(29.9996, 2);
    expect(calculateFbtFee(51.0, "single")).toBe(41.32);
    expect(calculateFbtFee(60.0, "single")).toBe(48.07);
  });
});

describe("getFbtFeeBreakdown", () => {
  it("returns a non-null bracket descriptor for every positive weight (regression)", () => {
    for (const w of [0.01, 0.25, 1, 5, 19.5, 20.0, 20.5, 20.999, 21, 50.5, 51, 100]) {
      const out = getFbtFeeBreakdown(w, "single");
      expect(out, `expected a bracket for weight=${w}`).not.toBeNull();
    }
  });

  it("reports the [20, 51) bracket for the previously-gapped range", () => {
    const out = getFbtFeeBreakdown(20.5, "single");
    expect(out?.from).toBe(20);
    expect(out?.to).toBe(51);
  });
});
