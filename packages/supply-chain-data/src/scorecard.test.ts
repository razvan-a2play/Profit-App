import { describe, expect, it } from "vitest";
import type { PeriodSummary } from "./periods";
import { buildScorecard, judge, SCORECARD } from "./scorecard";

const p = (over: Partial<PeriodSummary>): PeriodSummary => over as PeriodSummary;
const measure = (k: string) => SCORECARD.find((m) => m.key === k)!;

describe("judge", () => {
  it("reads a fall in days of inventory as improving", () => {
    expect(judge(measure("daysOfInventory"), 150, 200).verdict).toBe("improving");
  });
  it("treats a change inside the tolerance as holding", () => {
    expect(judge(measure("daysOfInventory"), 196, 200).verdict).toBe("holding");
  });
  it("judges shares in points", () => {
    expect(judge(measure("inStockRate"), 0.9, 0.95).verdict).toBe("worse");
  });
  it("says unknown, not holding, when a side is missing", () => {
    expect(judge(measure("gmroi"), 4, null).verdict).toBe("unknown");
  });
});

describe("buildScorecard", () => {
  it("flags a leaner inventory bought with stockouts", () => {
    const s = buildScorecard(
      p({ daysOfInventory: 120, turnover: 3, inStockRate: 0.88 }),
      p({ daysOfInventory: 180, turnover: 2, inStockRate: 0.96 }),
    );
    expect(s.improving).toBe(2);
    expect(s.worse).toBe(1);
    expect(s.balance).toMatch(/stockouts/);
  });

  it("calls a leaner inventory with steady availability a real gain", () => {
    const s = buildScorecard(
      p({ daysOfInventory: 120, inStockRate: 0.96 }),
      p({ daysOfInventory: 180, inStockRate: 0.961 }),
    );
    expect(s.balance).toMatch(/real/);
  });

  it("has no verdicts without a comparison period", () => {
    const s = buildScorecard(p({ daysOfInventory: 120 }), null);
    expect(s.measured).toBe(0);
  });
});
