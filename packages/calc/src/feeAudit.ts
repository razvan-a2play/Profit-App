// FBA fee auditor — compares what Amazon *measured & charges* against your
// *real* box measurements, and flags where Amazon's mis-measurement bumps you
// into a higher size tier (and a higher fulfilment fee) than reality warrants.
//
// The "correct" fee is derived from your real dimensions via the shared fee
// engine (calculateFBATierAndFee), so this stays the single source of truth for
// Amazon's fee schedule. This module is pure: it does no I/O. The app feeds it
// rows it has already fetched from the SP-API report and the Product Library.

import { calculateFBATierAndFee, type FeeTableOverride } from "./fbaFees";

const CM_PER_INCH = 2.54;
const KG_PER_LB = 0.453592;

/** Amazon's MEASURED values for a SKU, from GET_FBA_ESTIMATED_FBA_FEES report.
 *  Dimensions are in `unitOfDimension` (almost always inches) and weight in
 *  `unitOfWeight` (almost always pounds) — exactly as Amazon returns them. */
export interface AmazonMeasuredRow {
  sku: string;
  asin?: string;
  productName?: string;
  yourPrice?: number | null;
  longestSide?: number | null;
  medianSide?: number | null;
  shortestSide?: number | null;
  unitOfDimension?: string;
  itemPackageWeight?: number | null;
  unitOfWeight?: string;
  productSizeTier?: string;
  /** The per-unit fulfilment fee Amazon actually charges. */
  expectedFulfillmentFee?: number | null;
  currency?: string;
}

/** Your REAL measured box for a SKU, from the Product Library. Metric — matches
 *  the calc engine's expected inputs (cm / kg). */
export interface RealMeasurement {
  sku: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  hazmat?: boolean;
  /**
   * SIPP-certified (Ships in Product Packaging). A stated fact about the
   * listing - undefined means not stated, and SIPP is then left out entirely.
   * Never inferred from the fee: treating a lower charge as proof of
   * certification would let a missing discount pass as "not certified".
   */
  sippCertified?: boolean;
  /** Optional: units sold in the lookback window, to scale recoverable $. */
  unitsSold?: number;
}

export type AuditStatus =
  | "overcharge"          // Amazon charges more than your real dims warrant
  | "undercharge"         // Amazon charges less (don't dispute — informational)
  | "measurement_variance" // Amazon measured LARGER than your box and that
                           // crossed a fee band — real money, but the fix is a
                           // re-measurement, not a billing dispute
  | "ok"                  // within tolerance
  | "missing_measurement" // no real box dims in the Library for this SKU
  | "missing_amazon";     // SKU in Library but absent from Amazon's report

export type Confidence = "high" | "medium" | "low";

export interface Sides {
  longest: number;
  median: number;
  shortest: number;
}

export interface AuditFinding {
  sku: string;
  asin?: string;
  productName?: string;
  status: AuditStatus;
  confidence: Confidence;

  amazonTier?: string;
  correctTier?: string;
  /** True when Amazon's tier is strictly larger than the real-dims tier. */
  tierInflated: boolean;

  amazonFee?: number | null;   // per-unit fee Amazon charges
  correctFee?: number;          // per-unit fee from real dims (non-peak)
  feeDeltaPerUnit: number;      // amazonFee - correctFee (positive = overcharge)

  /** Both in inches for an apples-to-apples view. */
  amazonSides?: Sides;
  realSides?: Sides;
  amazonWeightLb?: number | null;
  realWeightLb?: number;

  /** Any-direction differences (Amazon vs ours) beyond tolerance — bigger OR
   *  smaller. Distinct from the *Inflated flags, which are Amazon-larger only. */
  dimsDiffer: boolean;
  weightDiffer: boolean;

  /** Whether the SKU is marked SIPP-certified (undefined = not stated). */
  sippCertified?: boolean;
  /** SIPP discount included in correctFee, per unit (positive), if any. */
  sippDiscount?: number;

  unitsSold?: number;
  /** Per-unit recoverable = max(0, feeDeltaPerUnit). */
  recoverablePerUnit: number;
  /** recoverablePerUnit * unitsSold (0 when units unknown). */
  recoverableTotal: number;

  notes: string[];
}

export interface AuditOptions {
  /** Dimension tolerance in inches before a side counts as mismatched. */
  dimToleranceIn?: number;
  /** Weight tolerance in pounds before weight counts as mismatched. */
  weightToleranceLb?: number;
  /** Minimum per-unit fee gap (in currency) to flag as an overcharge. */
  feeToleranceUsd?: number;
  /**
   * Fuel & Inflation surcharge applied on top of the base FBA fulfilment fee.
   * Amazon's reported/charged fee is base × (1 + this rate); our base fee table
   * excludes it, so we add it here to compare like-for-like. ~3.5% currently.
   */
  fuelSurchargeRate?: number;
  /**
   * Flag products charged the Dangerous Goods (hazmat) rate that aren't marked
   * hazmat in the Library. Enable ONLY when the Library reliably tracks hazmat —
   * otherwise every genuinely-hazmat SKU would false-positive.
   */
  detectHazmatMischarge?: boolean;
  /**
   * Published rate card to audit against, replacing the built-in fee tables.
   * Supply this whenever you have one: the built-in tables go stale when Amazon
   * revises rates, and a stale table shows up as a false "overcharge" — which
   * is exactly how a routine rate rise was once reported as a Dangerous Goods
   * mis-classification. Omitted, behaviour is unchanged.
   */
  feeTable?: FeeTableOverride;
}

const DEFAULTS: Required<Omit<AuditOptions, "feeTable">> = {
  dimToleranceIn: 0.5,
  weightToleranceLb: 0.1,
  feeToleranceUsd: 0.1,
  fuelSurchargeRate: 0.035,
  detectHazmatMischarge: false,
};

/** Collapse Amazon's many tier spellings ("Large standard-size", "Small
 *  standard", "Extra-large 0 to 50 lb") and the calc engine's lowercase names
 *  into a single comparable rank. Larger number = bigger/heavier tier. */
export function tierRank(raw?: string | null): number {
  if (!raw) return -1;
  const t = raw.toLowerCase();
  if (t.includes("extra")) return 4;
  if (t.includes("large") && t.includes("bulky")) return 3;
  if (t.includes("small") && t.includes("bulky")) return 2;
  if (t.includes("large") && t.includes("standard")) return 1;
  if (t.includes("small") && t.includes("standard")) return 0;
  return -1;
}

function realToSidesInches(m: RealMeasurement): Sides {
  const sides = [m.lengthCm, m.widthCm, m.heightCm]
    .map((cm) => cm / CM_PER_INCH)
    .sort((a, b) => b - a);
  return { longest: sides[0], median: sides[1], shortest: sides[2] };
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Audit a single SKU. Returns one finding. Either side may be missing — the
 * status field reflects which.
 */
export function auditSku(
  amazon: AmazonMeasuredRow | undefined,
  real: RealMeasurement | undefined,
  opts: AuditOptions = {},
): AuditFinding {
  const o = { ...DEFAULTS, ...opts };
  const sku = (amazon?.sku ?? real?.sku ?? "").trim();
  const notes: string[] = [];

  // --- Missing-data branches -------------------------------------------------
  if (!real) {
    const sides: Sides | undefined =
      amazon?.longestSide != null && amazon?.medianSide != null && amazon?.shortestSide != null
        ? { longest: amazon.longestSide, median: amazon.medianSide, shortest: amazon.shortestSide }
        : undefined;
    return {
      sku,
      asin: amazon?.asin,
      productName: amazon?.productName,
      status: "missing_measurement",
      confidence: "low",
      amazonTier: amazon?.productSizeTier,
      tierInflated: false,
      amazonFee: amazon?.expectedFulfillmentFee ?? null,
      feeDeltaPerUnit: 0,
      amazonSides: sides,
      amazonWeightLb: amazon?.itemPackageWeight ?? null,
      dimsDiffer: false,
      weightDiffer: false,
      recoverablePerUnit: 0,
      recoverableTotal: 0,
      notes: ["No real box measurement in the Product Library — add dimensions to audit this SKU."],
    };
  }
  if (!amazon) {
    return {
      sku,
      productName: undefined,
      status: "missing_amazon",
      confidence: "low",
      correctTier: undefined,
      tierInflated: false,
      feeDeltaPerUnit: 0,
      dimsDiffer: false,
      weightDiffer: false,
      recoverablePerUnit: 0,
      recoverableTotal: 0,
      notes: ["SKU not present in Amazon's fee report — it may be inactive or out of stock at FBA."],
    };
  }

  // --- Both present: compute the correct tier/fee from real dims -------------
  // Compute BOTH schedules so we can tell which one Amazon applied (regular vs
  // Dangerous Goods / hazmat). Tier is dimensional and identical either way.
  const isHazmat = real.hazmat ?? false;
  const correctRegular = calculateFBATierAndFee(
    real.lengthCm, real.widthCm, real.heightCm, real.weightKg, amazon.yourPrice ?? 0, false,
    o.feeTable, real.sippCertified,
  );
  const correctHazmat = calculateFBATierAndFee(
    real.lengthCm, real.widthCm, real.heightCm, real.weightKg, amazon.yourPrice ?? 0, true,
    o.feeTable, real.sippCertified,
  );
  const correct = isHazmat ? correctHazmat : correctRegular;

  const realSides = realToSidesInches(real);
  const realWeightLb = real.weightKg / KG_PER_LB;
  const amazonSides: Sides | undefined =
    amazon.longestSide != null && amazon.medianSide != null && amazon.shortestSide != null
      ? { longest: amazon.longestSide, median: amazon.medianSide, shortest: amazon.shortestSide }
      : undefined;

  // Dimension / weight mismatch. *Inflated = Amazon LARGER than reality (costs
  // money); *Differ = any direction beyond tolerance (for the change record).
  let dimInflated = false;
  let dimsDiffer = false;
  if (amazonSides) {
    const gaps = [
      amazonSides.longest - realSides.longest,
      amazonSides.median - realSides.median,
      amazonSides.shortest - realSides.shortest,
    ];
    dimInflated = gaps.some((g) => g > o.dimToleranceIn);
    dimsDiffer = gaps.some((g) => Math.abs(g) > o.dimToleranceIn);
    const biggest = Math.max(...gaps);
    if (dimInflated) {
      notes.push(`Amazon's measured envelope is up to ${round(biggest, 1)} in larger than your box.`);
    }
  } else {
    notes.push("Amazon report had no measured dimensions for this SKU.");
  }

  let weightInflated = false;
  let weightDiffer = false;
  let weightGap = 0;
  if (amazon.itemPackageWeight != null) {
    weightGap = amazon.itemPackageWeight - realWeightLb;
    weightInflated = weightGap > o.weightToleranceLb;
    weightDiffer = Math.abs(weightGap) > o.weightToleranceLb;
    if (weightInflated) {
      notes.push(`Amazon's measured weight is ${round(weightGap, 2)} lb heavier than your box.`);
    }
  }

  const amazonTier = amazon.productSizeTier;
  const correctTier = correct.tier;
  const tierInflated = tierRank(amazonTier) > tierRank(correctTier) && tierRank(correctTier) >= 0;
  if (tierInflated) {
    notes.push(`Amazon places this in "${amazonTier}" but your real dims compute to "${correctTier}".`);
  }

  // What the REGULAR schedule costs for the box Amazon itself measured. If
  // Amazon's charge matches this, Amazon applied the ordinary fee table
  // correctly to its own measurement — so any gap against our box is a
  // measurement dispute, never a classification one.
  //
  // This matters at weight-band boundaries: a 0.09 lb difference (2.72 vs 2.81
  // lb) is inside the weight tolerance yet crosses the 2.75 lb band, and the
  // resulting one-band fee gap can land within pennies of the hazmat rate for
  // the lower band. Without this check that coincidence is reported as a
  // high-confidence Dangerous Goods mis-classification.
  // SIPP comes off AFTER the fuel surcharge, as a flat per-unit amount - that
  // order reproduces Amazon's charge to the cent where the other doesn't.
  const surcharged = (r: { feeNonPeak: number; sipp?: { amount: number } }) =>
    r.feeNonPeak * (1 + o.fuelSurchargeRate) + (r.sipp?.amount ?? 0);

  let regularAtAmazonMeasure: number | null = null;
  // Amazon's measurement at the full rate, and as if certified. Used to tell a
  // missing SIPP discount (certified, billed full rate) from an unmarked one
  // (not marked, billed exactly the discounted rate).
  let fullAtAmazonMeasure: number | null = null;
  let sippRateAtAmazonMeasure: number | null = null;
  if (amazonSides && amazon.itemPackageWeight != null && amazon.itemPackageWeight > 0) {
    const at = (certified: boolean | undefined) =>
      calculateFBATierAndFee(
        amazonSides.longest * CM_PER_INCH,
        amazonSides.median * CM_PER_INCH,
        amazonSides.shortest * CM_PER_INCH,
        amazon.itemPackageWeight! * KG_PER_LB,
        amazon.yourPrice ?? 0,
        false, // Amazon's own schedule is judged on the regular table
        o.feeTable,
        certified,
      );
    const atAmazon = at(real.sippCertified);
    regularAtAmazonMeasure = surcharged(atAmazon);
    fullAtAmazonMeasure = atAmazon.feeNonPeak * (1 + o.fuelSurchargeRate);
    const asIfCertified = at(true);
    if (asIfCertified.sipp?.status === "discount") sippRateAtAmazonMeasure = surcharged(asIfCertified);
  }

  const amazonFee = amazon.expectedFulfillmentFee ?? null;
  // Amazon's reported fee includes the fuel & inflation surcharge; our base fee
  // table doesn't — apply it so the comparison is like-for-like.
  const regularFee = surcharged(correctRegular);
  const hazmatFee = surcharged(correctHazmat);
  const correctFee = isHazmat ? hazmatFee : regularFee;
  const feeDelta = amazonFee != null ? amazonFee - correctFee : 0;

  // --- Ships in Product Packaging -------------------------------------------
  const sippEffect = correct.sipp;
  const sippDiscount = sippEffect?.status === "discount" ? -sippEffect.amount : 0;
  // Cents, not the dollar tolerance: SIPP discounts are $0.04-$0.23, so the
  // usual $0.10 tolerance would swallow most of them whole.
  const CENT = 0.011;
  // Judged against BOTH measurements. Amazon's fee report can disagree with
  // its own bill by a hair at a band edge - SEZ0101006 is reported at 1.76 lb
  // yet billed the 1.5-1.75 lb rate, which is what your 1.70 lb box gives - so
  // requiring a match on Amazon's figure alone would miss a listing that is
  // plainly billed as SIPP.
  const ourFull = (isHazmat ? correctHazmat : correctRegular).feeNonPeak * (1 + o.fuelSurchargeRate);
  const ourAsIfCertified = calculateFBATierAndFee(
    real.lengthCm, real.widthCm, real.heightCm, real.weightKg, amazon.yourPrice ?? 0, isHazmat,
    o.feeTable, true,
  );
  const ourSippRate =
    ourAsIfCertified.sipp?.status === "discount" ? surcharged(ourAsIfCertified) : null;

  const pairs: Array<[full: number | null, sippRate: number | null]> = [
    [fullAtAmazonMeasure, sippRateAtAmazonMeasure],
    [ourFull, ourSippRate],
  ];
  const sippMissing =
    real.sippCertified === true &&
    sippDiscount > 0 &&
    amazonFee != null &&
    pairs.some(([full]) => full != null && Math.abs(amazonFee - full) <= CENT);
  const unmarkedMatch =
    real.sippCertified !== true && amazonFee != null
      ? pairs.find(
          ([full, rate]) =>
            full != null && rate != null && full - rate > CENT && Math.abs(amazonFee - rate) <= CENT,
        )
      : undefined;
  const sippUnmarked = unmarkedMatch !== undefined;

  if (real.sippCertified === true) {
    if (sippEffect?.status === "discount") {
      notes.push(
        `SIPP-certified: $${sippDiscount.toFixed(2)}/unit discount included, taken off after the fuel ` +
          `surcharge (${sippEffect.source === "published" ? "from your pasted SIPP rate card" : "built-in SIPP table"}).`,
      );
    } else if (sippEffect?.status === "no_rate") {
      notes.push(
        "Marked SIPP-certified, but no SIPP rate covers this tier and weight band - the fee is shown " +
          "without a discount rather than a guessed one.",
      );
    }
  }
  if (sippEffect?.status === "packaging_fee") {
    notes.push(
      `Not SIPP-certified: $${sippEffect.amount.toFixed(2)}/unit packaging fee included (bulky units ` +
        `that aren't certified pay this).`,
    );
  }
  if (sippUnmarked) {
    notes.push(
      `Amazon bills this exactly as a SIPP-certified unit - $${(unmarkedMatch![0]! - unmarkedMatch![1]!).toFixed(2)}/unit ` +
        `off the published rate - but it isn't marked certified here. Confirm the listing's SIPP ` +
        `status in Seller Central and tick it, so the audit checks the discount keeps being applied.`,
    );
  }

  // Hazmat mis-classification: the product isn't flagged hazmat in the Library,
  // yet Amazon's fee matches the higher Dangerous Goods rate (not the regular
  // rate). That's a real, disputable overcharge — and a costly one. Only checked
  // when the Library actually tracks hazmat (else every true-hazmat SKU would
  // false-positive). Recoverable = the hazmat premium (amazonFee − regularFee).
  const amazonUsedRegularSchedule =
    regularAtAmazonMeasure != null &&
    amazonFee != null &&
    Math.abs(amazonFee - regularAtAmazonMeasure) <= o.feeToleranceUsd;

  let classificationInflated = false;
  if (
    o.detectHazmatMischarge &&
    !isHazmat &&
    // Amazon billing its own measurement at the regular rate rules out a
    // hazmat mis-charge, however close the numbers happen to sit.
    !amazonUsedRegularSchedule &&
    amazonFee != null &&
    hazmatFee - regularFee > o.feeToleranceUsd &&
    Math.abs(amazonFee - hazmatFee) <= o.feeToleranceUsd &&
    amazonFee - regularFee > o.feeToleranceUsd
  ) {
    classificationInflated = true;
    notes.push(
      `Amazon is charging the Dangerous Goods (hazmat) rate (~$${hazmatFee.toFixed(2)}), but this product isn't ` +
        `flagged hazmat in your Library — $${(amazonFee - regularFee).toFixed(2)}/unit above the standard rate ` +
        `($${regularFee.toFixed(2)}). Verify the product's classification and dispute if it isn't hazmat.`,
    );
  }

  if (amazonUsedRegularSchedule && amazonFee != null && feeDelta > o.feeToleranceUsd) {
    notes.push(
      `Amazon charged the standard rate for the box it measured ` +
        `(${round(amazon.itemPackageWeight ?? 0, 2)} lb). The gap is a weight/size ` +
        `difference against your box, not a fee-schedule problem.`,
    );
  }

  // --- Classify --------------------------------------------------------------
  // An overcharge requires PHYSICAL evidence that Amazon over-measured — a
  // bigger size tier, or measured dims/weight beyond tolerance. A bare dollar
  // gap is NOT enough: our internal fee table can drift from Amazon's live
  // rates, so a fee difference with matching dimensions is rate-table noise,
  // not a mis-measurement worth disputing.
  let status: AuditStatus = "ok";
  let confidence: Confidence = "high";

  const overFee = amazonFee != null && feeDelta > o.feeToleranceUsd;
  const underFee = amazonFee != null && feeDelta < -o.feeToleranceUsd;
  const physicalInflation = tierInflated || dimInflated || weightInflated;

  if (sippMissing) {
    // Certified, yet billed the full published rate. The discount is small and
    // sits under the dollar tolerance, which is exactly why it needs its own
    // check - it is money Amazon owes on every unit, and nothing else here
    // would ever surface it.
    status = "overcharge";
    confidence = "medium"; // rests on the certification being current
    notes.push(
      `Marked SIPP-certified, but Amazon is billing the full rate ($${amazonFee!.toFixed(2)}) with no SIPP ` +
        `discount - $${sippDiscount.toFixed(2)}/unit. Check the listing is still certified in Seller Central; ` +
        `if it is, the discount is owed.`,
    );
  } else if (classificationInflated || tierInflated || (physicalInflation && overFee)) {
    // Backed by physical or classification evidence → a genuine, disputable overcharge.
    status = "overcharge";
    if (classificationInflated) confidence = "high"; // wrong fee schedule = costly + clear
    else if (tierInflated && (dimInflated || weightInflated)) confidence = "high";
    else if (tierInflated) confidence = "high";
    else confidence = "medium"; // dims/weight inflated AND fee is higher
  } else if (physicalInflation && !overFee) {
    // Amazon measured larger than reality, but it didn't raise the fee (no tier
    // boundary crossed). Worth knowing, not worth a dispute.
    status = "ok";
    confidence = "medium";
    notes.push(
      "Amazon measured this larger than your box, but it didn't change the fulfilment fee — no overcharge.",
    );
  } else if (overFee && amazonUsedRegularSchedule) {
    // Amazon billed its OWN measurement at the standard rate, yet that costs
    // more than our box would. With the fee schedule identical on both sides,
    // the difference can only be the measurement — via weight or via the
    // dimensional weight implied by the box size.
    //
    // Even a gap too small to breach tolerance costs a full band step once it
    // crosses a boundary: BDRL002 differs by 41 g and pays $0.42/unit. Calling
    // that "rate-table noise" hides real money, so it gets its own status.
    status = "measurement_variance";
    confidence = weightInflated || dimInflated ? "medium" : "low";

    const parts: string[] = [];
    if (Math.abs(weightGap) > 0.005) {
      parts.push(
        `weight ${round(amazon.itemPackageWeight ?? 0, 2)} lb against your ` +
          `${round(realWeightLb, 2)} lb`,
      );
    }
    if (amazonSides && dimsDiffer) {
      parts.push(
        `envelope ${round(amazonSides.longest, 1)}x${round(amazonSides.median, 1)}x` +
          `${round(amazonSides.shortest, 1)} in against your ` +
          `${round(realSides.longest, 1)}x${round(realSides.median, 1)}x` +
          `${round(realSides.shortest, 1)} in`,
      );
    }
    notes.push(
      `Amazon charged the standard rate for the box IT measured — ` +
        `${parts.length ? parts.join("; ") : "its recorded measurements differ from yours"}. ` +
        `That lands in a higher fee band, costing $${Math.abs(feeDelta).toFixed(2)}/unit. ` +
        (weightInflated || dimInflated
          ? "The difference is beyond tolerance — worth re-measuring and disputing."
          : "The difference is within measurement tolerance, so it isn't disputable as an error — " +
            "but re-measuring the packed unit is worth it if the true figure sits under the band edge."),
    );
  } else if (overFee) {
    // Fee is higher but dimensions and tier match → rate-table / rounding gap.
    status = "ok";
    confidence = "low";
    notes.push(
      `Amazon's fee is $${Math.abs(feeDelta).toFixed(2)}/unit above our rate-table estimate, but its measured ` +
        `dimensions and size tier match your real box — a rate-table or rounding difference, not a ` +
        `mis-measurement. Not disputable.`,
    );
  } else if (underFee) {
    status = "ok";
    confidence = "low";
    // Never disputable — but say WHY it differs, because a systematic gap in
    // this direction is also how a false overcharge would be produced in the
    // other. Separate the two causes: our box being bigger than Amazon's
    // measurement is ours to explain; a gap that survives measuring the same
    // box is Amazon charging under its own published rate, which in practice
    // means a per-unit discount on the listing (Ships in Product Packaging and
    // similar programmes) rather than a rate we've read wrong.
    const gap = Math.abs(feeDelta).toFixed(2);
    // A hazmat-flagged product priced against the Dangerous Goods schedule will
    // always look under-charged when Amazon bills the ordinary rate. That is a
    // classification disagreement, not a measurement or rate question, and
    // saying "Amazon measured it smaller" would send you looking in the wrong
    // place. It is worth knowing: one of the two classifications is wrong.
    if (isHazmat && amazonFee != null && amazonFee <= regularFee + o.feeToleranceUsd) {
      notes.push(
        `Your Library marks this Dangerous Goods, but Amazon is charging the ordinary rate ` +
          `($${amazonFee.toFixed(2)} vs $${hazmatFee.toFixed(2)} hazmat). Nothing to dispute — ` +
          `Amazon is charging less — but one of the two classifications is wrong, and if Amazon ` +
          `reclassifies it the fee jumps to the hazmat rate.`,
      );
    } else if (regularAtAmazonMeasure != null && amazonFee != null) {
      const atTheirMeasure = amazonFee - regularAtAmazonMeasure;
      if (atTheirMeasure < -o.feeToleranceUsd) {
        if (!sippUnmarked) {
          notes.push(
            `Amazon charges $${gap}/unit less than the published rate — and still $` +
              `${Math.abs(atTheirMeasure).toFixed(2)} less when priced on Amazon's own measurement, ` +
              `so it isn't a measurement difference. A per-unit discount this audit doesn't model. ` +
              `Nothing to dispute.`,
          );
        }
      } else {
        notes.push(
          `Amazon charges $${gap}/unit less than the published rate, and its own measurement ` +
            `explains it — Amazon measured this smaller than your box. Nothing to dispute.`,
        );
      }
    } else {
      notes.push(`Amazon charges $${gap}/unit less than the published rate — nothing to dispute.`);
    }
  } else {
    status = "ok";
    confidence = amazonFee != null ? "high" : "low";
    if (amazonFee == null) notes.push("Amazon report had no per-unit fee to compare — verify the report type.");
  }

  // Measurement variances are money at stake but contingent on Amazon
  // re-measuring, so they carry a per-unit figure without being counted as
  // confirmed recoverable overcharges in the summary.
  const recoverablePerUnit = sippMissing
    ? sippDiscount
    : status === "overcharge" || status === "measurement_variance"
      ? Math.max(0, feeDelta)
      : 0;
  const unitsSold = real.unitsSold ?? 0;

  return {
    sku,
    asin: amazon.asin,
    productName: amazon.productName,
    status,
    confidence,
    amazonTier,
    correctTier,
    tierInflated,
    amazonFee,
    correctFee: round(correctFee),
    feeDeltaPerUnit: round(feeDelta),
    amazonSides: amazonSides
      ? { longest: round(amazonSides.longest), median: round(amazonSides.median), shortest: round(amazonSides.shortest) }
      : undefined,
    realSides: { longest: round(realSides.longest), median: round(realSides.median), shortest: round(realSides.shortest) },
    amazonWeightLb: amazon.itemPackageWeight ?? null,
    realWeightLb: round(realWeightLb),
    dimsDiffer,
    weightDiffer,
    ...(real.sippCertified !== undefined ? { sippCertified: real.sippCertified } : {}),
    ...(sippDiscount > 0 ? { sippDiscount: round(sippDiscount) } : {}),
    unitsSold: real.unitsSold,
    recoverablePerUnit: round(recoverablePerUnit),
    recoverableTotal: round(recoverablePerUnit * unitsSold),
    notes,
  };
}

export interface AuditSummary {
  totalSkus: number;
  overcharges: number;
  /** SKUs where Amazon's own measurement crossed a fee band against your box. */
  measurementVariances: number;
  /** Per-unit total at stake in those, contingent on a re-measurement. */
  measurementVariancePerUnitTotal: number;
  recoverablePerUnitTotal: number;
  recoverableTotal: number;
}

export interface AuditResult {
  findings: AuditFinding[];
  summary: AuditSummary;
}

/**
 * Audit a whole catalogue. Joins Amazon rows and real measurements by SKU
 * (case-insensitive, trimmed), audits each, and returns findings ranked with
 * the biggest recoverable overcharges first.
 */
export function auditCatalog(
  amazonRows: AmazonMeasuredRow[],
  realMeasurements: RealMeasurement[],
  opts: AuditOptions = {},
): AuditResult {
  const norm = (s: string) => s.trim().toLowerCase();
  const amazonBySku = new Map(amazonRows.map((r) => [norm(r.sku), r]));
  const realBySku = new Map(realMeasurements.map((r) => [norm(r.sku), r]));

  const skus = new Set<string>([...amazonBySku.keys(), ...realBySku.keys()]);
  const findings: AuditFinding[] = [];
  for (const key of skus) {
    findings.push(auditSku(amazonBySku.get(key), realBySku.get(key), opts));
  }

  // Rank: overcharges by recoverable $ (total, then per-unit) first; then the
  // rest by per-unit fee delta. Stable, deterministic ordering.
  const rankStatus = (s: AuditStatus) =>
    s === "overcharge" ? 0 : s === "measurement_variance" ? 1 : s === "undercharge" ? 2 : 3;
  findings.sort((a, b) => {
    if (rankStatus(a.status) !== rankStatus(b.status)) return rankStatus(a.status) - rankStatus(b.status);
    if (b.recoverableTotal !== a.recoverableTotal) return b.recoverableTotal - a.recoverableTotal;
    if (b.recoverablePerUnit !== a.recoverablePerUnit) return b.recoverablePerUnit - a.recoverablePerUnit;
    return b.feeDeltaPerUnit - a.feeDeltaPerUnit;
  });

  const overcharges = findings.filter((f) => f.status === "overcharge");
  const summary: AuditSummary = {
    totalSkus: findings.length,
    overcharges: overcharges.length,
    measurementVariances: findings.filter((f) => f.status === "measurement_variance").length,
    measurementVariancePerUnitTotal: round(
      findings
        .filter((f) => f.status === "measurement_variance")
        .reduce((s2, f) => s2 + f.recoverablePerUnit, 0),
    ),
    recoverablePerUnitTotal: round(overcharges.reduce((s, f) => s + f.recoverablePerUnit, 0)),
    recoverableTotal: round(overcharges.reduce((s, f) => s + f.recoverableTotal, 0)),
  };

  return { findings, summary };
}
