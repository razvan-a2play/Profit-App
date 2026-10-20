// Returnless-vs-return-required decision, COGS-based.
//
// Validated against SPBATH0034 with the user's real numbers. The core insight:
// every fee is paid identically whether the customer ships the item back or
// keeps it. The ONLY difference is whether you get the unit back.
//
//   Sale (both):        + price − referral − fbaFee − COGS
//   Returnless refund:  − price + referral − refundAdmin + 0
//   Physical return:    − price + referral − refundAdmin − returnsFee
//                       + sellableRate × COGS
//
//   difference = sellableRate × COGS − extra returns-processing fee
//
// Return shipping is NOT charged to FBA sellers (verified absent from the
// user's financial events). The FBA fulfilment fee is never refunded and is
// lost in both scenarios.

import { modelFeeExposure, type FeeExposure } from "./returnsProcessingFee";

/** Amazon keeps a refund administration fee: lesser of $5.00 or 20% of referral. */
export function refundAdminFee(referralFee: number): number {
  return Math.min(5, referralFee * 0.2);
}

/** Recovery on damaged units if Grade & Resell / Liquidation is enabled. */
export const DAMAGED_RECOVERY_RATE = 0.3;

export interface DecisionInput {
  sku: string;
  asin?: string | null;
  price: number;
  referralFee: number;
  fbaFee: number;
  /** Landed cost to put one sellable unit back into FBA. */
  cogs: number;
  cogsSource: "explicit" | "components" | "ratio";
  /** Fraction of physical returns graded SELLABLE (0–1). */
  sellableRate: number;
  /** Fraction graded CUSTOMER_DAMAGED (0–1) — partially recoverable. */
  damagedRate: number;
  /** Total refunds in the window (returnless + physical). */
  totalRefunds: number;
  physicalRefunds: number;
  returnlessRefunds: number;
  /** Displayed return rate as a fraction, from the dashboard. */
  displayedReturnRate: number | null;
  /** Category return-rate threshold as a fraction. */
  threshold: number;
  /** Per-unit returns-processing fee from Amazon's rate card. */
  returnsFeePerUnit: number;
  /** True when Grade & Resell / Liquidation is enabled on damaged units. */
  valueRecoveryEnabled?: boolean;
  /** Annualised units sold — drives the revenue ranking. */
  annualUnits?: number | null;
  /** Where `price` came from: realised ASP over the window, or today's list. */
  priceSource?: "asp" | "list" | "none";
  /** Per-unit disposal fee Amazon charges to remove one unsellable unit. */
  disposalFeePerUnit?: number;
  /** True when the disposal fee is a size-tier estimate, not this SKU's own. */
  disposalFeeEstimated?: boolean;
}

export type Verdict =
  | "switch_to_return_required"
  | "keep_returnless"
  | "marginal"
  | "insufficient_data"
  | "no_cogs";

export interface Decision {
  sku: string;
  asin: string | null;
  price: number;
  cogs: number | null;
  cogsSource: "explicit" | "components" | "ratio" | "none";
  sellableRate: number;

  totalRefunds: number;
  physicalRefunds: number;
  returnlessRefunds: number;
  returnlessSharePct: number;

  // ── Per-refund economics
  /** Fees you eat on ANY refund: lost FBA fee + refund admin fee. */
  unrecoverableFeePerRefund: number;
  /** Total cost of one returnless refund (fees + full COGS). */
  returnlessCostPerRefund: number;
  /** Total cost of one physical return (fees + unrecovered COGS + returns fee). */
  physicalCostPerRefund: number;
  /** physical − returnless, i.e. what switching saves per refund. */
  savingsPerRefund: number;

  // ── Annual
  currentAnnualCost: number;
  ifAllPhysicalAnnualCost: number;
  annualDelta: number;
  /** annualDelta without the disposal fee — what the model said before. */
  annualDeltaBeforeDisposal: number;

  // ── Fee exposure
  feeExposure: FeeExposure | null;
  extraFeeIfSwitched: number;
  /** Per-refund returns-processing fee if every refund became physical.
   *  $0 when the SKU stays under its category allowance. */
  returnsFeePerRefundIfSwitched: number;
  /** Return rate if every refund became physical — vs threshold. */
  rateIfAllPhysical: number | null;
  threshold: number;
  breachesThresholdIfSwitched: boolean;

  verdict: Verdict;
  reason: string;
  /** Profit on one sale, for context. */
  profitPerSale: number;
  /** How many sales one refund destroys. */
  salesLostPerReturnlessRefund: number;

  // ── Revenue ranking (for the Pareto filter)
  /** Annualised units sold, from the velocity endpoint. */
  annualUnits: number | null;
  /** Annualised revenue = annualUnits x price. */
  annualRevenue: number | null;
  /** Cumulative share of total catalogue revenue, 0-1, when ranked desc. */
  cumulativeRevenueShare: number | null;
  priceSource: "asp" | "list" | "none";
  /** Inputs for the return-rate simulator (null when the rate is unknown). */
  lifecycle: Lifecycle | null;
  /** Purchase-order view of the same decision. */
  pnl: Pnl | null;
}

/**
 * The decision restated as two purchase orders.
 *
 * Demand is fixed: the same units ship and the same refunds are issued either
 * way, so every revenue and fee line is identical. Only two things move —
 * how much stock you buy, and how many unsellable units you pay to dispose of.
 * That is the whole decision, and it is the framing a CFO can check.
 */
export interface Pnl {
  /** Refunds that would switch from returnless to physical. */
  switchedRefunds: number;
  /** Of those, the ones that come back graded SELLABLE and go back on the shelf. */
  unitsRecovered: number;
  /** Stock you no longer have to buy: unitsRecovered x COGS. */
  inventorySaved: number;
  /** Units that come back unsellable and must be disposed of. */
  extraDisposals: number;
  disposalFeePerUnit: number;
  disposalFeeEstimated: boolean;
  /** Cost of disposing of them. */
  disposalCost: number;
  /** Extra returns-processing fee once the fee-relevant rate rises. */
  extraReturnsFee: number;
  /** inventorySaved - disposalCost - extraReturnsFee. */
  net: number;
}

export function decide(i: DecisionInput): Decision {
  const admin = refundAdminFee(i.referralFee);
  const unrecoverable = i.fbaFee + admin;
  const profitPerSale = i.price - i.referralFee - i.fbaFee - i.cogs;

  // Value recovered when a unit physically comes back.
  const damagedRecovery = i.valueRecoveryEnabled
    ? i.damagedRate * DAMAGED_RECOVERY_RATE * i.cogs
    : 0;
  const recoveredPerPhysical = i.sellableRate * i.cogs + damagedRecovery;

  // ── Returns-processing fee exposure. Returnless units are exempt, so
  // switching them to physical can push the fee-relevant rate over the
  // category threshold.
  let feeExposure: FeeExposure | null = null;
  let extraFeeIfSwitched = 0;
  let rateIfAllPhysical: number | null = null;
  if (i.displayedReturnRate && i.displayedReturnRate > 0 && i.totalRefunds > 0) {
    feeExposure = modelFeeExposure({
      totalRefunds: i.totalRefunds,
      physicalRefunds: i.physicalRefunds,
      displayedReturnRate: i.displayedReturnRate,
      threshold: i.threshold,
      feePerUnit: i.returnsFeePerUnit,
    });
    extraFeeIfSwitched = feeExposure.additionalFeeIfSwitched;
    // If every refund became physical, the fee-relevant rate rises to the
    // full displayed rate.
    rateIfAllPhysical = i.displayedReturnRate;
  }

  const perRefundFeeNow =
    i.physicalRefunds > 0 && feeExposure
      ? feeExposure.annualFeeNow / i.physicalRefunds
      : 0;
  const perRefundFeeIfAll =
    i.totalRefunds > 0 && feeExposure
      ? feeExposure.annualFeeIfAllPhysical / i.totalRefunds
      : 0;

  const returnlessCostPerRefund = unrecoverable + i.cogs;
  const physicalCostPerRefund =
    unrecoverable + (i.cogs - recoveredPerPhysical) + perRefundFeeIfAll;

  const savingsPerRefund = returnlessCostPerRefund - physicalCostPerRefund;

  const currentAnnualCost =
    i.returnlessRefunds * returnlessCostPerRefund +
    i.physicalRefunds * (unrecoverable + i.cogs - recoveredPerPhysical + perRefundFeeNow);
  const ifAllPhysicalAnnualCost = i.totalRefunds * physicalCostPerRefund;
  const annualDelta = currentAnnualCost - ifAllPhysicalAnnualCost;

  const breaches =
    rateIfAllPhysical != null && rateIfAllPhysical > i.threshold;

  // ── Purchase-order view. Demand is fixed, so revenue and every fee line are
  // identical under both policies; only stock bought and disposals move.
  const disposalFee = i.disposalFeePerUnit ?? 0;
  const scrapRate = Math.max(0, 1 - i.sellableRate);
  const unitsRecovered = i.returnlessRefunds * i.sellableRate;
  const extraDisposals = i.returnlessRefunds * scrapRate;
  const inventorySaved = unitsRecovered * i.cogs;
  const disposalCost = extraDisposals * disposalFee;
  const pnl: Pnl = {
    switchedRefunds: i.returnlessRefunds,
    unitsRecovered: Math.round(unitsRecovered),
    inventorySaved: round2(inventorySaved),
    extraDisposals: Math.round(extraDisposals),
    disposalFeePerUnit: round2(disposalFee),
    disposalFeeEstimated: i.disposalFeeEstimated ?? false,
    disposalCost: round2(disposalCost),
    extraReturnsFee: round2(extraFeeIfSwitched),
    net: round2(inventorySaved - disposalCost - extraFeeIfSwitched),
  };

  // ── Verdict
  let verdict: Verdict;
  let reason: string;
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const usd0 = (n: number) => `$${Math.round(n).toLocaleString()}`;

  if (i.totalRefunds < 3) {
    verdict = "insufficient_data";
    reason = "Fewer than 3 refunds in the window — not enough signal.";
  } else if (i.returnlessRefunds <= 0) {
    verdict = "keep_returnless";
    reason = "No returnless refunds detected — already effectively return-required.";
  } else if (annualDelta > 250 && savingsPerRefund > 0.5) {
    verdict = "switch_to_return_required";
    reason =
      `Each returned unit is worth ${usd(recoveredPerPhysical)} back (${(i.sellableRate * 100).toFixed(0)}% sellable × ${usd(i.cogs)} COGS). ` +
      `Switching ${i.returnlessRefunds.toLocaleString()} returnless refunds -> ${usd0(annualDelta)}/yr.` +
      (extraFeeIfSwitched > 0 ? ` Net of ${usd0(extraFeeIfSwitched)}/yr new returns-processing fee.` : "");
  } else if (annualDelta <= 0) {
    verdict = "keep_returnless";
    reason = breaches
      ? `Switching pushes the fee rate to ${(rateIfAllPhysical! * 100).toFixed(2)}% (over the ${(i.threshold * 100).toFixed(1)}% threshold), costing ${usd0(extraFeeIfSwitched)}/yr — more than the ${usd(recoveredPerPhysical)}/unit recovered.`
      : `Recovered value ${usd(recoveredPerPhysical)}/unit doesn't beat the cost of switching.`;
  } else {
    verdict = "marginal";
    reason = `Only ${usd0(annualDelta)}/yr — COGS ${usd(i.cogs)} is too low for the returned unit to matter much.`;
  }

  return {
    sku: i.sku,
    asin: i.asin ?? null,
    price: i.price,
    cogs: i.cogs,
    cogsSource: i.cogsSource,
    sellableRate: i.sellableRate,
    totalRefunds: i.totalRefunds,
    physicalRefunds: i.physicalRefunds,
    returnlessRefunds: i.returnlessRefunds,
    returnlessSharePct: i.totalRefunds ? (i.returnlessRefunds / i.totalRefunds) * 100 : 0,
    unrecoverableFeePerRefund: round2(unrecoverable),
    returnlessCostPerRefund: round2(returnlessCostPerRefund),
    physicalCostPerRefund: round2(physicalCostPerRefund),
    savingsPerRefund: round2(savingsPerRefund),
    currentAnnualCost: round2(currentAnnualCost),
    ifAllPhysicalAnnualCost: round2(ifAllPhysicalAnnualCost),
    // The P&L net is the headline: same as the old cost-difference model but
    // with the disposal fee on newly-created unsellable units subtracted.
    annualDelta: pnl.net,
    annualDeltaBeforeDisposal: round2(annualDelta),
    feeExposure,
    extraFeeIfSwitched: round2(extraFeeIfSwitched),
    returnsFeePerRefundIfSwitched: round2(perRefundFeeIfAll),
    rateIfAllPhysical,
    threshold: i.threshold,
    breachesThresholdIfSwitched: breaches,
    verdict,
    reason,
    profitPerSale: round2(profitPerSale),
    salesLostPerReturnlessRefund:
      profitPerSale > 0 ? round2(returnlessCostPerRefund / profitPerSale) : 0,
    annualUnits: i.annualUnits ?? null,
    annualRevenue:
      i.annualUnits != null ? Math.round(i.annualUnits * i.price) : null,
    cumulativeRevenueShare: null, // filled in by the caller after ranking
    priceSource: i.priceSource ?? "list",
    lifecycle:
      i.displayedReturnRate && i.displayedReturnRate > 0 && i.totalRefunds > 0
        ? {
            price: i.price,
            referralFee: i.referralFee,
            fbaFee: i.fbaFee,
            cogs: i.cogs,
            returnRate: i.displayedReturnRate,
            returnlessShare: i.returnlessRefunds / i.totalRefunds,
            sellableRate: i.sellableRate,
            damagedRate: i.damagedRate,
            defectiveRate: Math.max(0, 1 - i.sellableRate - i.damagedRate - 0.004),
            carrierRate: 0.004,
            annualUnits: i.annualUnits ?? null,
            damagedRecoveryRate: i.valueRecoveryEnabled ? DAMAGED_RECOVERY_RATE : 0,
            disposalFee: disposalFee,
          }
        : null,
    pnl,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Decision for a SKU we couldn't price or cost. */
export function noCogsDecision(sku: string, asin: string | null, price: number | null): Decision {
  return {
    sku,
    asin,
    price: price ?? 0,
    cogs: null,
    cogsSource: "none",
    sellableRate: 0,
    totalRefunds: 0,
    physicalRefunds: 0,
    returnlessRefunds: 0,
    returnlessSharePct: 0,
    unrecoverableFeePerRefund: 0,
    returnlessCostPerRefund: 0,
    physicalCostPerRefund: 0,
    savingsPerRefund: 0,
    currentAnnualCost: 0,
    ifAllPhysicalAnnualCost: 0,
    annualDelta: 0,
    annualDeltaBeforeDisposal: 0,
    feeExposure: null,
    extraFeeIfSwitched: 0,
    returnsFeePerRefundIfSwitched: 0,
    rateIfAllPhysical: null,
    threshold: 0,
    breachesThresholdIfSwitched: false,
    verdict: "no_cogs",
    reason: "No landed COGS on file — add it to get a decision.",
    profitPerSale: 0,
    salesLostPerReturnlessRefund: 0,
    annualUnits: null,
    annualRevenue: null,
    cumulativeRevenueShare: null,
    priceSource: "none",
    lifecycle: null,
    pnl: null,
  };
}


// ── Lifecycle model (storage excluded) ──────────────────────────────────────
// Traces one unit of inventory through every terminal state and returns the
// expected margin. Used by the return-rate simulator: the same function is
// evaluated at today's rate and at a target rate, and the difference is the
// annual prize for reducing returns.
//
//   sold, never returned            -> +margin
//   returnless refund               -> -(fees + COGS)
//   physical, SELLABLE, resold      -> -fees + margin      (re-earns contribution)
//   physical, SELLABLE, returned    -> -(2 x fees) - COGS
//   physical, CUSTOMER_DAMAGED      -> -(fees + COGS) + recovery
//   physical, DEFECTIVE             -> -(fees + COGS + disposal)
//   physical, CARRIER_DAMAGED       -> -fees              (COGS reimbursed)

export interface Lifecycle {
  price: number;
  referralFee: number;
  fbaFee: number;
  cogs: number;
  /** Current customer-initiated return rate, as a fraction. */
  returnRate: number;
  /** Share of returns that are returnless, 0-1. */
  returnlessShare: number;
  sellableRate: number;
  damagedRate: number;
  defectiveRate: number;
  carrierRate: number;
  /** Annualised units shipped — scales per-unit figures to a yearly number. */
  annualUnits: number | null;
  /** Recovery on damaged units, 0-1. 0 while Grade & Resell is off. */
  damagedRecoveryRate: number;
  disposalFee: number;
}

export interface LifecycleOverrides {
  returnRate?: number;
  returnlessShare?: number;
  damagedRecoveryRate?: number;
}

/** Expected margin per unit shipped, at the given (or current) settings. */
export function expectedMargin(l: Lifecycle, o: LifecycleOverrides = {}): number {
  const ret = o.returnRate ?? l.returnRate;
  const rl = o.returnlessShare ?? l.returnlessShare;
  const dmgRec = o.damagedRecoveryRate ?? l.damagedRecoveryRate;
  const ph = 1 - rl;

  const fees = l.fbaFee + refundAdminFee(l.referralFee);
  const contribution = l.price - l.referralFee - l.fbaFee;
  const margin = contribution - l.cogs;

  return (
    (1 - ret) * margin +
    ret * rl * -(fees + l.cogs) +
    ret * ph * l.sellableRate * (1 - ret) * (-fees + margin) +
    ret * ph * l.sellableRate * ret * (-fees * 2 - l.cogs) +
    ret * ph * l.damagedRate * (-(fees + l.cogs) + l.cogs * dmgRec) +
    ret * ph * l.defectiveRate * -(fees + l.cogs + l.disposalFee) +
    ret * ph * l.carrierRate * -fees
  );
}

/** Margin with zero returns — the ceiling the drag is measured against. */
export function idealMargin(l: Lifecycle): number {
  return l.price - l.referralFee - l.fbaFee - l.cogs;
}
