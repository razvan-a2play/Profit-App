// One Amazon FBA fee breakdown for the P&L calculator.
//
// The product P&L, the "Amazon FBA Fees" card and the Live SKU dashboard all
// read their Amazon numbers from here, so they can't drift apart again (they
// had: the card took $0.86 off under-$10 items, the P&L total $0.77, the
// dashboard nothing).
//
// Order of operations, as Amazon bills it:
//   fulfillment fee for the price column  (rate card)
//   + fuel & logistics surcharge          (% of that fee, rounded to the cent)
//   - SIPP discount                       (flat, AFTER the surcharge)
//   + battery fee                         (app setting, $0.11)
//   = FBA fee per unit, separately for non-peak and holiday peak
// Weighted = (non-peak x 9 + peak x 3) / 12: peak runs Oct 15 - Jan 14.

import {
  calculateFBATierAndFee,
  calculateReferralFee,
  calculateReturnProcessingFee,
  checkSippEligibility,
  type FbaTierResult,
} from "./fbaFees";
import { priceBandOf, type FeeSchedule, type PriceBand } from "./feeSchedules";

/** Per-unit battery fee the calculator has always used for "Contains batteries". */
export const BATTERY_FEE_PER_UNIT = 0.11;
/** Months of the year at holiday-peak rates (Oct 15 - Jan 14). */
export const PEAK_MONTHS = 3;

export interface AmazonFbaFeeInput {
  /** cm */
  length: number;
  width: number;
  height: number;
  /** kg */
  weight: number;
  sellingPrice: number;
  category: string;
  hazmat?: boolean;
  containsBatteries?: boolean;
  /**
   * The user's SIPP switch. The unit is treated as SIPP-certified when this is
   * not false AND the box meets Amazon's minimum (L > 6", W > 4", H > 0.375").
   */
  sippEligibleOverride?: boolean;
}

export interface AmazonFbaFeeBreakdown {
  scheduleId: FeeSchedule["id"];
  scheduleLabel: string;
  priceBand: PriceBand;
  /** Raw engine result: tier, billable/dimensional weight, rate-card fees. */
  fba: FbaTierResult;
  tier: string;
  billableWeight: number;
  dimWeight: number;

  /** Rate-card fulfillment fee for this tier, weight band and price column. */
  fulfillmentNonPeak: number;
  fulfillmentPeak: number;
  fuelSurchargeRate: number;
  surchargeNonPeak: number;
  surchargePeak: number;
  sippCertified: boolean;
  /** Positive amount taken off (0 when none applies). */
  sippDiscount: number;
  batteryFee: number;

  /** fulfillment + surcharge - SIPP + battery. */
  fbaNonPeak: number;
  fbaPeak: number;
  fbaWeighted: number;

  referralFee: number;
  referralRate: number;
  referralError?: string;

  /** FBA fee + referral fee. */
  totalNonPeak: number;
  totalPeak: number;
  totalWeighted: number;

  /**
   * Fulfillment + surcharge, peak-weighted, before SIPP and battery: the fee
   * lost on a returned unit in the returns-cost formula (which subtracts SIPP
   * itself).
   */
  fulfillmentWeightedWithSurcharge: number;
  returnProcessingFee: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const weighted = (nonPeak: number, peak: number) =>
  (nonPeak * (12 - PEAK_MONTHS) + peak * PEAK_MONTHS) / 12;

export function computeAmazonFbaFees(
  input: AmazonFbaFeeInput,
  schedule: FeeSchedule,
): AmazonFbaFeeBreakdown {
  const length = input.length || 0;
  const width = input.width || 0;
  const height = input.height || 0;
  const weight = input.weight || 0;
  const price = Number.isFinite(input.sellingPrice) ? input.sellingPrice : 0;
  const hazmat = !!input.hazmat;

  const sippCertified =
    input.sippEligibleOverride !== false &&
    length > 0 &&
    width > 0 &&
    height > 0 &&
    checkSippEligibility(length, width, height) === "YES";

  const fba = calculateFBATierAndFee(
    length,
    width,
    height,
    weight,
    price,
    hazmat,
    schedule.table ?? undefined,
    sippCertified,
  );

  const rate = schedule.fuelSurchargeRate;
  const surchargeNonPeak = round2(fba.feeNonPeak * rate);
  const surchargePeak = round2(fba.feePeak * rate);

  // The engine reports SIPP as a signed amount: negative = discount,
  // positive = packaging fee for a non-certified unit (when the schedule has
  // that table). Apply it either way.
  const sippAmount = fba.sipp?.amount ?? 0;
  const sippDiscount = sippAmount < 0 ? -sippAmount : 0;
  const packagingFee = sippAmount > 0 ? sippAmount : 0;
  const batteryFee = input.containsBatteries && fba.feeNonPeak > 0 ? BATTERY_FEE_PER_UNIT : 0;

  const fbaNonPeak = fba.feeNonPeak > 0
    ? fba.feeNonPeak + surchargeNonPeak - sippDiscount + packagingFee + batteryFee
    : 0;
  const fbaPeak = fba.feePeak > 0
    ? fba.feePeak + surchargePeak - sippDiscount + packagingFee + batteryFee
    : 0;

  const referral = calculateReferralFee(input.category ?? "", price);
  const referralFee = referral.fee ?? 0;

  return {
    scheduleId: schedule.id,
    scheduleLabel: schedule.label,
    priceBand: priceBandOf(price),
    fba,
    tier: fba.tier,
    billableWeight: fba.billableWeight,
    dimWeight: fba.dimWeight,

    fulfillmentNonPeak: fba.feeNonPeak,
    fulfillmentPeak: fba.feePeak,
    fuelSurchargeRate: rate,
    surchargeNonPeak,
    surchargePeak,
    sippCertified,
    sippDiscount,
    batteryFee,

    fbaNonPeak,
    fbaPeak,
    fbaWeighted: weighted(fbaNonPeak, fbaPeak),

    referralFee,
    referralRate: referral.rate ?? 0,
    referralError: referral.error,

    totalNonPeak: fbaNonPeak + referralFee,
    totalPeak: fbaPeak + referralFee,
    totalWeighted: weighted(fbaNonPeak, fbaPeak) + referralFee,

    fulfillmentWeightedWithSurcharge: weighted(
      fba.feeNonPeak + surchargeNonPeak,
      fba.feePeak + surchargePeak,
    ),
    returnProcessingFee: calculateReturnProcessingFee(fba.tier, fba.billableWeight * 16),
  };
}
