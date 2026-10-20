import { describe, it, expect } from "vitest";
import { runReturnsModel, tiesOut, refundAdminFee, type ModelInput } from "./returnsModel";

// SEZ0101002, exactly as `Returnless analysis - all SKUs v26.xlsx` holds it.
// Every expected value below is read off that workbook, so if this file passes
// the app and the spreadsheet agree cell for cell.
const SEZ: ModelInput = {
  sku: "SEZ0101002",
  price: 23.3658,
  referralFee: 3.5049,
  fbaFee: 5.66,
  cogs: 4.1447,
  removalCostPerUnsellable: 2.0893,
  unitsShipped: 73_700,
  refunds: 3_677,
  sellableReturns: 568,
  unsellableReturns: 292,
  reimbursedCameBack: 47,
  reimbursedStayedAway: 334,
  backToStockShare: 0.0647,
  reimbursedShare: 0.0149,
  returnsProcessingFeeYear: 330.93,
  actualReturnRate: 0.7,
};

describe("the derived rates", () => {
  const r = runReturnsModel(SEZ);
  it("prices the reimbursement by Amazon's rule, not an average", () => {
    expect(r.reimbursementPerUnit).toBeCloseTo(14.2009, 3); // B65 / B66
  });
  it("counts only the fees that are never given back", () => {
    // Referral is refunded, so it is NOT in here. FBA + admin only.
    expect(r.feesLostPerRefund).toBeCloseTo(6.361, 3); // B67
  });
  it("reproduces the workbook's derived shares", () => {
    expect(r.returnRate).toBeCloseTo(0.0499, 4); // B63
    expect(r.resellableShare).toBeCloseTo(0.6605, 3); // B62
    expect(r.reimbursementRateOnKept).toBeCloseTo(0.1186, 3); // B64
    expect(r.keptByCustomer).toBe(2_817); // B48
  });
});

describe("net per unit, by outcome", () => {
  const by = Object.fromEntries(
    runReturnsModel(SEZ).outcomes.map((o) => [o.key, o.perUnit]),
  );
  it("matches every cell in the workbook's B69:B73", () => {
    expect(by.cameBackResold).toBeCloseTo(2.6694, 3);
    expect(by.cameBackAmazonPaid).toBeCloseTo(3.6953, 3);
    expect(by.cameBackUnsellable).toBeCloseTo(-11.531, 3);
    expect(by.stayedAmazonPaid).toBeCloseTo(3.6953, 3);
    expect(by.stayedWeAteIt).toBeCloseTo(-10.5057, 3);
  });

  it("charges the FBA fee twice on a resale and once everywhere else", () => {
    // The cleanest statement of the claim: add a dollar to the fee and the
    // resold figure drops by two, while eating the loss drops by one.
    const per = (m: ReturnType<typeof runReturnsModel>, k: string) =>
      m.outcomes.find((o) => o.key === k)!.perUnit;
    const base = runReturnsModel(SEZ);
    const dearer = runReturnsModel({ ...SEZ, fbaFee: SEZ.fbaFee + 1 });
    expect(per(base, "cameBackResold") - per(dearer, "cameBackResold")).toBeCloseTo(2, 6);
    expect(per(base, "stayedWeAteIt") - per(dearer, "stayedWeAteIt")).toBeCloseTo(1, 6);
  });

  it("pays the same whether or not the unit came back", () => {
    // Amazon reimburses the sale, not the fate of the goods.
    const o = runReturnsModel(SEZ).outcomes;
    expect(o.find((x) => x.key === "cameBackAmazonPaid")!.perUnit).toBeCloseTo(
      o.find((x) => x.key === "stayedAmazonPaid")!.perUnit,
      6,
    );
  });
});

describe("the units, before and after", () => {
  const r = runReturnsModel(SEZ);
  const u = Object.fromEntries(r.outcomes.map((o) => [o.key, o]));

  it("matches the workbook's two columns", () => {
    expect(u.cameBackResold.unitsToday).toBe(521);
    expect(Math.round(u.cameBackResold.unitsAfter)).toBe(1_823);
    expect(u.cameBackUnsellable.unitsToday).toBe(292);
    expect(Math.round(u.cameBackUnsellable.unitsAfter)).toBe(962);
    expect(u.stayedAmazonPaid.unitsToday).toBe(334);
    expect(Math.round(u.stayedAmazonPaid.unitsAfter)).toBe(100);
    expect(u.stayedWeAteIt.unitsToday).toBe(2_483);
    expect(Math.round(u.stayedWeAteIt.unitsAfter)).toBe(745);
  });

  it("leaves Amazon's own damage untouched by the policy", () => {
    // Requiring returns cannot create or prevent carrier damage.
    expect(u.cameBackAmazonPaid.unitsToday).toBe(47);
    expect(u.cameBackAmazonPaid.unitsAfter).toBe(47);
  });

  it("still covers every refund in both columns", () => {
    expect(tiesOut(r, SEZ.refunds)).toBe(true);
  });

  it("ties out at any assumption, not just 70%", () => {
    for (const arr of [0, 0.25, 0.5, 0.9, 1]) {
      expect(tiesOut(runReturnsModel({ ...SEZ, actualReturnRate: arr }), SEZ.refunds)).toBe(true);
    }
  });
});

describe("the decision", () => {
  it("reproduces the workbook's totals", () => {
    const r = runReturnsModel(SEZ);
    expect(Math.round(r.totalToday)).toBe(-26_654);
    expect(Math.round(r.totalAfter)).toBe(-13_833);
    expect(Math.round(r.difference)).toBe(12_821);
    expect(r.verdict).toBe("switch");
  });

  it("gets worse as the removal cost rises, not better", () => {
    // Requiring returns brings MORE units back, so a dearer removal hurts.
    const dear = runReturnsModel({ ...SEZ, removalCostPerUnsellable: 6 });
    expect(dear.difference).toBeLessThan(runReturnsModel(SEZ).difference);
  });

  it("gets worse as reimbursements rise, because switching gives them up", () => {
    const generous = runReturnsModel({ ...SEZ, reimbursedStayedAway: 1_500 });
    expect(generous.difference).toBeLessThan(runReturnsModel(SEZ).difference);
  });

  it("calls a small positive immaterial rather than a switch", () => {
    // SPBATH0007's shape: real, but $5 is not a decision.
    const tiny = runReturnsModel({ ...SEZ, refunds: 29, unitsShipped: 1_000,
      sellableReturns: 15, unsellableReturns: 2, reimbursedCameBack: 0,
      reimbursedStayedAway: 3, returnsProcessingFeeYear: 0 });
    expect(["immaterial", "keep"]).toContain(tiny.verdict);
  });

  it("charges the returns-processing fee only in the switched column", () => {
    const free = runReturnsModel({ ...SEZ, returnsProcessingFeeYear: 0 });
    expect(free.totalToday).toBeCloseTo(runReturnsModel(SEZ).totalToday, 6);
    expect(free.difference - runReturnsModel(SEZ).difference).toBeCloseTo(330.93, 2);
  });
});

describe("refundAdminFee", () => {
  it("is 20% of the referral fee", () => {
    expect(refundAdminFee(3.5049)).toBeCloseTo(0.701, 4);
  });
  it("caps at $5 on an expensive item", () => {
    expect(refundAdminFee(100)).toBe(5);
  });
});

describe("edge cases that should not explode", () => {
  it("handles a SKU with no returns at all", () => {
    const r = runReturnsModel({ ...SEZ, refunds: 0, sellableReturns: 0, unsellableReturns: 0,
      reimbursedCameBack: 0, reimbursedStayedAway: 0, returnsProcessingFeeYear: 0 });
    expect(r.totalToday).toBe(0);
    expect(r.difference).toBe(0);
    expect(Number.isFinite(r.resellableShare)).toBe(true);
  });

  it("handles a SKU where nothing ever comes back", () => {
    const r = runReturnsModel({ ...SEZ, sellableReturns: 0, unsellableReturns: 0,
      reimbursedCameBack: 0 });
    expect(r.resellableShare).toBe(0);
    expect(tiesOut(r, SEZ.refunds)).toBe(true);
  });
});
