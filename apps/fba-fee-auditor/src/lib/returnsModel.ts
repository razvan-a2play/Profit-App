// The returns decision, as the workbook computes it.
//
// The app's original model was one line — `sellableRate x COGS - returns fee`.
// That is right about the fees (identical whether the customer ships the item
// back or keeps it) and wrong about everything the unit does afterwards: a
// returned unit is resold and pays the FBA fee a SECOND time, or arrives
// unsellable and is written off with a removal fee on top, and a unit that
// stays away is often reimbursed by Amazon under the 60-day rule — money you
// stop collecting the moment you require returns.
//
// This is the model from `Returnless analysis - all SKUs v26.xlsx`, cell for
// cell. Every refund lands in exactly one of five outcomes, each outcome has a
// net value per unit, and requiring returns moves units between them.
//
//   today          the five outcomes as measured
//   if we switch   the kept-by-customer pool splits: a share comes back and
//                  divides into resellable and unsellable; the rest stays away
//                  and keeps its reimbursement rate on a smaller base
//
// Verified against the workbook's own figures in returnsModel.test.ts.

/** Amazon keeps a refund administration fee: lesser of $5.00 or 20% of referral. */
export function refundAdminFee(referralFee: number): number {
  return Math.min(5, referralFee * 0.2);
}

export interface ModelInput {
  sku: string;
  /** Price the model runs at — realised ASP, or today's list. */
  price: number;
  /** Referral fee AT THAT PRICE, not at list. */
  referralFee: number;
  fbaFee: number;
  /** Landed cost of one unit: manufacturing + freight. */
  cogs: number;
  /** What Amazon bills to remove one unsellable unit, however it disposes of it. */
  removalCostPerUnsellable: number;

  unitsShipped: number;
  refunds: number;
  /** Physical returns graded sellable, and everything else. */
  sellableReturns: number;
  unsellableReturns: number;
  /** Reimbursed units that came back, and that never did. */
  reimbursedCameBack: number;
  reimbursedStayedAway: number;

  /** What happens to an unsellable unit — shares of 1, from the returns report. */
  backToStockShare: number;
  reimbursedShare: number;

  /** Returns-processing fee for the year if every refund became physical. */
  returnsProcessingFeeYear: number;

  /** Share of switched refunds that actually come back. The one assumption. */
  actualReturnRate: number;
}

export type OutcomeKey =
  | "cameBackResold"
  | "cameBackAmazonPaid"
  | "cameBackUnsellable"
  | "stayedAmazonPaid"
  | "stayedWeAteIt";

export interface Outcome {
  key: OutcomeKey;
  label: string;
  unitsToday: number;
  unitsAfter: number;
  perUnit: number;
}

export interface ModelResult {
  sku: string;
  /** Price less referral less FBA fee — Amazon's own reimbursement rule. */
  reimbursementPerUnit: number;
  /** FBA fee + admin fee: gone whether or not the unit comes back. */
  feesLostPerRefund: number;
  returnRate: number;
  resellableShare: number;
  reimbursementRateOnKept: number;
  keptByCustomer: number;
  outcomes: Outcome[];
  totalToday: number;
  totalAfter: number;
  /** After − today. Positive means requiring returns is worth more. */
  difference: number;
  /** Charged only in the switched scenario, and only above the threshold. */
  returnsProcessingFee: number;
  verdict: "switch" | "keep" | "immaterial";
}

const LABELS: Record<OutcomeKey, string> = {
  cameBackResold: "Came back, resold",
  cameBackAmazonPaid: "Came back, Amazon paid us",
  cameBackUnsellable: "Came back, unsellable",
  stayedAmazonPaid: "Stayed with customer, Amazon paid us",
  stayedWeAteIt: "Stayed with customer, we ate it",
};

/** Below this the difference is noise, not a decision. */
export const MATERIALITY_USD = 250;

export function runReturnsModel(i: ModelInput, materiality = MATERIALITY_USD): ModelResult {
  const admin = refundAdminFee(i.referralFee);
  const feesLost = i.fbaFee + admin;
  // Amazon reimburses the SALE it failed to deliver: what you would have
  // netted. Not COGS — it is not buying the unit from you.
  const reimbursement = i.price - i.referralFee - i.fbaFee;

  const cameBack = i.sellableReturns + i.unsellableReturns;
  const kept = i.refunds - cameBack;
  const returnRate = i.unitsShipped > 0 ? i.refunds / i.unitsShipped : 0;
  const resellableShare = cameBack > 0 ? i.sellableReturns / cameBack : 0;
  const reimbRateKept = kept > 0 ? i.reimbursedStayedAway / kept : 0;

  // ── net per unit, by outcome
  const ateIt = -(i.cogs + feesLost);
  const amazonPaid = ateIt + reimbursement;
  // A resold unit pays the FBA fee TWICE — once to the first customer, once to
  // the second — and can be returned again at the SKU's own return rate.
  const resaleSticks = i.price - i.referralFee - i.fbaFee * 2 - admin - i.cogs;
  const resaleBounces = -(i.cogs + i.fbaFee * 2 + admin * 2);
  const resold = (1 - returnRate) * resaleSticks + returnRate * resaleBounces;
  // Unsellable is not a story but a blend: four destinations, and a removal fee
  // charged on every one of them — including the units Amazon donates.
  const writtenOffShare = 1 - i.backToStockShare - i.reimbursedShare;
  const unsellable =
    i.backToStockShare * resold +
    i.reimbursedShare * amazonPaid +
    writtenOffShare * ateIt -
    i.removalCostPerUnsellable;

  // ── units, before and after
  const movers = kept * i.actualReturnRate;
  const stayAway = kept - movers;
  const outcomes: Outcome[] = [
    {
      key: "cameBackResold",
      label: LABELS.cameBackResold,
      unitsToday: i.sellableReturns - i.reimbursedCameBack,
      unitsAfter: i.sellableReturns - i.reimbursedCameBack + movers * resellableShare,
      perUnit: resold,
    },
    {
      // Amazon damaged these in its own network, which has nothing to do with
      // the returns policy. This count does not move.
      key: "cameBackAmazonPaid",
      label: LABELS.cameBackAmazonPaid,
      unitsToday: i.reimbursedCameBack,
      unitsAfter: i.reimbursedCameBack,
      perUnit: amazonPaid,
    },
    {
      key: "cameBackUnsellable",
      label: LABELS.cameBackUnsellable,
      unitsToday: i.unsellableReturns,
      unitsAfter: i.unsellableReturns + movers * (1 - resellableShare),
      perUnit: unsellable,
    },
    {
      key: "stayedAmazonPaid",
      label: LABELS.stayedAmazonPaid,
      unitsToday: i.reimbursedStayedAway,
      unitsAfter: stayAway * reimbRateKept,
      perUnit: amazonPaid,
    },
    {
      key: "stayedWeAteIt",
      label: LABELS.stayedWeAteIt,
      unitsToday: kept - i.reimbursedStayedAway,
      unitsAfter: stayAway * (1 - reimbRateKept),
      perUnit: ateIt,
    },
  ];

  const totalToday = outcomes.reduce((t, o) => t + o.unitsToday * o.perUnit, 0);
  const fee = i.returnsProcessingFeeYear;
  const totalAfter = outcomes.reduce((t, o) => t + o.unitsAfter * o.perUnit, 0) - fee;
  const difference = totalAfter - totalToday;

  return {
    sku: i.sku,
    reimbursementPerUnit: reimbursement,
    feesLostPerRefund: feesLost,
    returnRate,
    resellableShare,
    reimbursementRateOnKept: reimbRateKept,
    keptByCustomer: kept,
    outcomes,
    totalToday,
    totalAfter,
    difference,
    returnsProcessingFee: fee,
    verdict:
      difference > materiality ? "switch" : difference < 0 ? "keep" : "immaterial",
  };
}

/** Units in each outcome must always add back to the refunds we started with. */
export function tiesOut(r: ModelResult, refunds: number, tolerance = 0.5): boolean {
  const today = r.outcomes.reduce((t, o) => t + o.unitsToday, 0);
  const after = r.outcomes.reduce((t, o) => t + o.unitsAfter, 0);
  return Math.abs(today - refunds) < tolerance && Math.abs(after - refunds) < tolerance;
}
