// Amazon FBA fee schedule + calculation helpers.
// Extracted from apps/pnl-calculator/src/components/FBACalculation.tsx so the math
// can be shared across apps and tested in isolation.

import { calculateDimensionalWeight } from "./dimensionalWeight";

export interface FbaFeeRow {
  tier: string;
  weightRange: string;
  nonPeak: number;
  peak: number;
  weightBasis: string;
  /**
   * Amazon charges by the item's SELLING price as well as its size and weight:
   * products under $10 get Low-Price FBA rates, over $50 a higher rate. The
   * published table has a column per band. Supplied on rows parsed from a
   * published rate card; the built-in table carries only the mid band, so these
   * stay undefined there and `nonPeak` is used for every price.
   */
  lowPrice?: number | null;
  highPrice?: number | null;
  /**
   * Bulky, extra-large and the top large-standard band are not flat rates.
   * Amazon publishes them as a base plus a surcharge per weight interval above
   * a threshold — and the interval is NOT always a pound:
   *   "$8.84 + $0.38/lb interval above first lb"          -> interval 1 lb
   *   "$6.15 + $0.08 per 4 oz interval above first 3 lb"  -> interval 0.25 lb
   *   "$6.15 + $0.16/half-lb interval above first 3 lb"   -> interval 0.5 lb
   * so the interval size is carried explicitly. Absent on flat rows, where
   * `nonPeak` is the whole fee.
   */
  surchargePerInterval?: number | null;
  surchargeIntervalLb?: number | null;
  surchargeAboveLb?: number | null;
}

export interface SizeTier {
  name: string;
  maxWeight: number | null;
  maxLongest: number | null;
  maxMedian: number | null;
  maxShortest: number | null;
  maxLPG: number | null;
  weightBasis: string;
}

export interface ReferralCondition {
  rate: number;
  operator: "<" | "<=" | "≤" | ">" | ">=" | "=" | null;
  limit: number | null;
  minFee: number;
}

export const FBA_FEES: ReadonlyArray<FbaFeeRow> = [
  { tier: "small standard", weightRange: "2 oz or less", nonPeak: 2.43, peak: 3.25, weightBasis: "Unit weight" },
  { tier: "small standard", weightRange: "2+ to 4 oz", nonPeak: 2.49, peak: 3.34, weightBasis: "Unit weight" },
  { tier: "small standard", weightRange: "4+ to 6 oz", nonPeak: 2.56, peak: 3.44, weightBasis: "Unit weight" },
  { tier: "small standard", weightRange: "6+ to 8 oz", nonPeak: 2.66, peak: 3.53, weightBasis: "Unit weight" },
  { tier: "small standard", weightRange: "8+ to 10 oz", nonPeak: 2.77, peak: 3.64, weightBasis: "Unit weight" },
  { tier: "small standard", weightRange: "10+ to 12 oz", nonPeak: 2.82, peak: 3.74, weightBasis: "Unit weight" },
  { tier: "small standard", weightRange: "12+ to 14 oz", nonPeak: 2.92, peak: 3.82, weightBasis: "Unit weight" },
  { tier: "small standard", weightRange: "14+ to 16 oz", nonPeak: 2.95, peak: 3.87, weightBasis: "Unit weight" },
  { tier: "large standard", weightRange: "4 oz or less", nonPeak: 2.91, peak: 3.92, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "4+ to 8 oz", nonPeak: 3.13, peak: 4.16, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "8+ to 12 oz", nonPeak: 3.38, peak: 4.43, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "12+ to 16 oz", nonPeak: 3.78, peak: 4.84, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "1+ to 1.25 lb", nonPeak: 4.22, peak: 5.29, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "1.25+ to 1.5 lb", nonPeak: 4.60, peak: 5.68, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "1.5+ to 1.75 lb", nonPeak: 4.75, peak: 5.84, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "1.75+ to 2 lb", nonPeak: 5.00, peak: 6.10, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "2+ to 2.25 lb", nonPeak: 5.10, peak: 6.24, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "2.25+ to 2.5 lb", nonPeak: 5.28, peak: 6.44, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "2.5+ to 2.75 lb", nonPeak: 5.44, peak: 6.61, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "2.75+ to 3 lb", nonPeak: 5.85, peak: 7.03, weightBasis: "Greater of unit or dimensional weight" },
];

// Hazmat (Dangerous Goods) FBA Fee Data — effective January 15, 2026
export const HAZMAT_FBA_FEES: ReadonlyArray<FbaFeeRow> = [
  { tier: "small standard", weightRange: "2 oz or less", nonPeak: 3.40, peak: 4.37, weightBasis: "Unit weight" },
  { tier: "small standard", weightRange: "2+ to 4 oz", nonPeak: 3.43, peak: 4.46, weightBasis: "Unit weight" },
  { tier: "small standard", weightRange: "4+ to 6 oz", nonPeak: 3.48, peak: 4.56, weightBasis: "Unit weight" },
  { tier: "small standard", weightRange: "6+ to 8 oz", nonPeak: 3.55, peak: 4.65, weightBasis: "Unit weight" },
  { tier: "small standard", weightRange: "8+ to 10 oz", nonPeak: 3.64, peak: 4.76, weightBasis: "Unit weight" },
  { tier: "small standard", weightRange: "10+ to 12 oz", nonPeak: 3.65, peak: 4.85, weightBasis: "Unit weight" },
  { tier: "small standard", weightRange: "12+ to 14 oz", nonPeak: 3.73, peak: 4.93, weightBasis: "Unit weight" },
  { tier: "small standard", weightRange: "14+ to 16 oz", nonPeak: 3.77, peak: 5.02, weightBasis: "Unit weight" },
  { tier: "large standard", weightRange: "4 oz or less", nonPeak: 3.73, peak: 5.09, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "4+ to 8 oz", nonPeak: 3.94, peak: 5.33, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "8+ to 12 oz", nonPeak: 4.17, peak: 5.59, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "12+ to 16 oz", nonPeak: 4.37, peak: 5.81, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "1+ to 1.25 lb", nonPeak: 4.82, peak: 6.28, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "1.25+ to 1.5 lb", nonPeak: 5.20, peak: 6.68, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "1.5+ to 1.75 lb", nonPeak: 5.35, peak: 6.85, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "1.75+ to 2 lb", nonPeak: 5.49, peak: 7.01, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "2+ to 2.25 lb", nonPeak: 5.56, peak: 7.10, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "2.25+ to 2.5 lb", nonPeak: 5.74, peak: 7.30, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "2.5+ to 2.75 lb", nonPeak: 5.90, peak: 7.47, weightBasis: "Greater of unit or dimensional weight" },
  { tier: "large standard", weightRange: "2.75+ to 3 lb", nonPeak: 6.31, peak: 7.89, weightBasis: "Greater of unit or dimensional weight" },
];

export const SIZE_TIERS: ReadonlyArray<SizeTier> = [
  { name: "Small standard", maxWeight: 1, maxLongest: 15, maxMedian: 12, maxShortest: 0.75, maxLPG: null, weightBasis: "Unit weight" },
  { name: "Large standard", maxWeight: 20, maxLongest: 18, maxMedian: 14, maxShortest: 8, maxLPG: null, weightBasis: "Greater of unit or dimensional weight" },
  { name: "Large bulky", maxWeight: 50, maxLongest: 59, maxMedian: 33, maxShortest: 33, maxLPG: null, weightBasis: "Greater of unit or dimensional weight" },
  // No upper weight bound: Amazon publishes an "Extra-large 150+ lb" rate, so
  // a heavier unit is still extra-large. Capping this at 150 classified those
  // units as "Unknown" and returned a $0 fee, which reads as no overcharge.
  { name: "Extra-large", maxWeight: null, maxLongest: 108, maxMedian: null, maxShortest: null, maxLPG: 165, weightBasis: "Greater of unit or dimensional weight" },
];

export const REFERRAL_FEES: Readonly<Record<string, ReadonlyArray<ReferralCondition>>> = {
  "amazon device accessories": [{ rate: 45, operator: null, limit: null, minFee: 0.30 }],
  "automotive and powersports": [{ rate: 12, operator: null, limit: null, minFee: 0.30 }],
  "baby products": [
    { rate: 8, operator: "<=", limit: 10, minFee: 0.30 },
    { rate: 15, operator: ">", limit: 10, minFee: 0.30 },
  ],
  "backpacks, handbags, and luggage": [{ rate: 15, operator: null, limit: null, minFee: 0.30 }],
  "beauty": [
    { rate: 8, operator: "<=", limit: 10, minFee: 0.30 },
    { rate: 15, operator: ">", limit: 10, minFee: 0.30 },
  ],
  "books": [{ rate: 15, operator: null, limit: null, minFee: 0.30 }],
  "cell phone devices": [{ rate: 8, operator: null, limit: null, minFee: 0.30 }],
  "cell phone accessories": [{ rate: 15, operator: null, limit: null, minFee: 0.30 }],
  "clothing and accessories": [{ rate: 17, operator: null, limit: null, minFee: 0.30 }],
  "computers": [{ rate: 8, operator: null, limit: null, minFee: 0.30 }],
  "consumer electronics": [{ rate: 8, operator: null, limit: null, minFee: 0.30 }],
  "electronics accessories": [{ rate: 15, operator: null, limit: null, minFee: 0.30 }],
  "furniture and decor": [
    { rate: 15, operator: "<=", limit: 200, minFee: 0.30 },
    { rate: 10, operator: ">", limit: 200, minFee: 0.30 },
  ],
  "grocery and gourmet food": [{ rate: 8, operator: null, limit: null, minFee: 0.30 }],
  "health and personal care": [
    { rate: 8, operator: "<=", limit: 10, minFee: 0.30 },
    { rate: 15, operator: null, limit: null, minFee: 0.30 },
  ],
  "home and garden": [{ rate: 15, operator: null, limit: null, minFee: 0.30 }],
  "industrial and scientific": [{ rate: 12, operator: null, limit: null, minFee: 0.30 }],
  "jewelry": [
    { rate: 20, operator: "<=", limit: 250, minFee: 0.30 },
    { rate: 5, operator: ">", limit: 250, minFee: 0.30 },
  ],
  "musical instruments": [{ rate: 15, operator: null, limit: null, minFee: 0.30 }],
  "office products": [{ rate: 15, operator: null, limit: null, minFee: 0.30 }],
  "personal computers": [{ rate: 6, operator: null, limit: null, minFee: 0.30 }],
  "pet supplies": [{ rate: 15, operator: null, limit: null, minFee: 0.30 }],
  "shoes, handbags, and sunglasses": [{ rate: 15, operator: null, limit: null, minFee: 0.30 }],
  "sports and outdoors": [{ rate: 15, operator: null, limit: null, minFee: 0.30 }],
  "toys and games": [{ rate: 15, operator: null, limit: null, minFee: 0.30 }],
  "watches": [
    { rate: 16, operator: "<=", limit: 1500, minFee: 0.30 },
    { rate: 3, operator: ">", limit: 1500, minFee: 0.30 },
  ],
};

/** What Ships in Product Packaging did to this fee, if anything. */
export interface SippEffect {
  /**
   * - discount: certified, and the published SIPP table had a matching row
   * - packaging_fee: not certified, and the table charges a packaging fee here
   * - no_rate: certified, but no SIPP row covers this tier/band, so the fee is
   *   shown WITHOUT a discount rather than with a guessed one
   * - none: nothing applies
   */
  status: "discount" | "packaging_fee" | "no_rate" | "none";
  /**
   * Signed per-unit change, applied AFTER the fuel surcharge: negative for a
   * discount, positive for a packaging fee.
   */
  amount: number;
  /** Where the figure came from: the pasted SIPP card, or the built-in table. */
  source?: "published" | "built-in";
}

export interface FbaTierResult {
  tier: string;
  feeNonPeak: number;
  feePeak: number;
  billableWeight: number;
  dimWeight: number;
  weightBasis?: string;
  sipp?: SippEffect;
}

/**
 * Classify a product into an Amazon FBA size tier and compute fulfillment fees.
 * All inputs are in metric (cm, kg). Selling price is unused but kept for API parity.
 */
/**
 * Optional replacement for the built-in fee tables.
 *
 * The built-in tables go stale whenever Amazon revises its rates, and a stale
 * table silently turns into false "overcharge" findings. Callers that hold a
 * freshly-entered published rate card pass it here so the comparison is made
 * against what Amazon publishes today. Omit it and the built-in tables are
 * used exactly as before.
 */
export interface FeeTableOverride {
  regular: ReadonlyArray<FbaFeeRow>;
  hazmat: ReadonlyArray<FbaFeeRow>;
  /**
   * Ships in Product Packaging, from the published SIPP rate card. Same row
   * shape as the fee tables, but every figure is a per-unit DISCOUNT for a
   * certified unit (already resolved from a lowered fee where the page stated
   * one), by the same price bands.
   */
  sipp?: ReadonlyArray<FbaFeeRow>;
  /** Per-unit packaging fee Amazon adds to units that are NOT SIPP-certified. */
  nonSippPackaging?: ReadonlyArray<FbaFeeRow>;
}

/**
 * Does a published weight band contain this weight? Bands are written four
 * ways: "4 oz or less", "4+ to 8 oz", "0 to 50 lb", and the open-ended "150+ lb".
 * Ounce bands compare the billable weight in ounces, pound bands in pounds.
 */
export function weightBandMatches(weightRange: string, billableWeight: number): boolean {
  const range = weightRange.toLowerCase();
  const weightOz = billableWeight * 16;
  if (range.includes("or less")) {
    const max = parseFloat(range.match(/([\d.]+)/)?.[1] || "0");
    return range.includes("oz") ? weightOz <= max : billableWeight <= max;
  }
  if (range.includes("+ to")) {
    const parts = range.match(/([\d.]+)\+\s*to\s*([\d.]+)/);
    if (!parts) return false;
    const min = parseFloat(parts[1]);
    const max = parseFloat(parts[2]);
    return range.includes("oz")
      ? weightOz > min && weightOz <= max
      : billableWeight > min && billableWeight <= max;
  }
  if (range.includes("to")) {
    const parts = range.match(/([\d.]+)\s*to\s*([\d.]+)/);
    if (!parts) return false;
    const min = parseFloat(parts[1]);
    const max = parseFloat(parts[2]);
    return range.includes("oz")
      ? weightOz >= min && weightOz <= max
      : billableWeight >= min && billableWeight <= max;
  }
  // Open-ended top band, e.g. "150+ lb": a lower bound and nothing above it.
  const parts = range.match(/^([\d.]+)\+\s*(oz|lb)$/);
  if (!parts) return false;
  const min = parseFloat(parts[1]);
  return parts[2] === "oz" ? weightOz > min : billableWeight > min;
}

/**
 * The figure a row carries for this selling price. Amazon's tables have a
 * column per price band - under $10 is the Low-Price FBA rate, over $50 its own
 * rate - and auditing an item against the wrong column invents a variance.
 */
export function bandValue(row: FbaFeeRow, sellingPrice: number): number {
  if (sellingPrice > 0) {
    if (sellingPrice < 10 && row.lowPrice != null) return row.lowPrice;
    if (sellingPrice > 50 && row.highPrice != null) return row.highPrice;
  }
  return row.nonPeak;
}

export function calculateFBATierAndFee(
  length: number,
  width: number,
  height: number,
  weight: number,
  sellingPrice: number,
  hazmat = false,
  feeTableOverride?: FeeTableOverride,
  /**
   * Whether this SKU is SIPP-certified. A fact you state, never inferred from
   * the fee - inferring it from a lower charge would let an overcharge pass as
   * "just not certified". Omitted, SIPP is left out entirely.
   */
  sippCertified?: boolean,
): FbaTierResult {
  if (!length || !width || !height || !weight) {
    return { tier: "Unknown", feeNonPeak: 0, feePeak: 0, billableWeight: 0, dimWeight: 0 };
  }

  // Convert cm to inches and kg to pounds.
  const lengthIn = length / 2.54;
  const widthIn = width / 2.54;
  const heightIn = height / 2.54;
  const weightLb = weight / 0.453592;

  const dims = [lengthIn, widthIn, heightIn].sort((a, b) => b - a);
  const [longest, median, shortest] = dims;
  const girth = 2 * (median + shortest);
  const lengthPlusGirth = longest + girth;

  const dimCalc = calculateDimensionalWeight(length, width, height, weight);
  const dimWeight = dimCalc.dimWeightLbs;

  let sizeTier = "Unknown";
  let weightBasis = "Greater of unit or dimensional weight";

  for (const tier of SIZE_TIERS) {
    const meetsWeight = !tier.maxWeight || weightLb <= tier.maxWeight;
    const meetsLongest = !tier.maxLongest || longest <= tier.maxLongest;
    const meetsMedian = !tier.maxMedian || median <= tier.maxMedian;
    const meetsShortest = !tier.maxShortest || shortest <= tier.maxShortest;
    const meetsLPG = !tier.maxLPG || lengthPlusGirth <= tier.maxLPG;

    if (meetsWeight && meetsLongest && meetsMedian && meetsShortest && meetsLPG) {
      sizeTier = tier.name;
      weightBasis = tier.weightBasis;
      break;
    }
  }

  const billableWeight = weightBasis === "Unit weight" ? weightLb : Math.max(weightLb, dimWeight);

  let feeNonPeak = 0;
  let feePeak = 0;
  // Set when a published rate-card row supplied the bulky/extra-large formula,
  // so the hardcoded fallbacks below don't overwrite it.
  let usedPublishedFormula = false;
  const normalizedTier = sizeTier.toLowerCase();
  // A supplied card wins, but only where it actually has rows for the tier we
  // need — a partial card (e.g. large standard only) falls back per-lookup
  // rather than reporting $0 for everything it doesn't cover.
  const overrideTable = hazmat ? feeTableOverride?.hazmat : feeTableOverride?.regular;
  const builtIn = hazmat ? HAZMAT_FBA_FEES : FBA_FEES;
  const feeTable =
    overrideTable && overrideTable.some((r) => r.tier === sizeTier.toLowerCase())
      ? overrideTable
      : builtIn;

  for (const feeRow of feeTable) {
    if (feeRow.tier === normalizedTier) {
      const matches = weightBandMatches(feeRow.weightRange, billableWeight);

      if (matches) {
        // Pick the selling-price band when the row carries one. Auditing a
        // $6.42 item against the $10-$50 column (or an $11 item against the
        // Low-Price column) manufactures a variance that isn't real.
        feeNonPeak = bandValue(feeRow, sellingPrice);
        feePeak = feeRow.peak;

        // Bulky / extra-large: add the published per-pound surcharge. Amazon
        // charges per whole-pound INTERVAL above the threshold, so a part
        // pound counts as a full interval.
        if (feeRow.surchargePerInterval != null) {
          const above = feeRow.surchargeAboveLb ?? 1;
          const step = feeRow.surchargeIntervalLb ?? 1;
          const intervals = Math.ceil(Math.max(0, billableWeight - above) / step);
          feeNonPeak += intervals * feeRow.surchargePerInterval;
          feePeak += intervals * feeRow.surchargePerInterval;
          usedPublishedFormula = true;
        }
        break;
      }
    }
  }

  // Dynamic fee handling for tiers above the table.
  if (!usedPublishedFormula && normalizedTier === "large standard" && billableWeight > 3) {
    const baseNonPeak = hazmat ? 6.61 : 6.15;
    const basePeak = hazmat ? 7.69 : 7.43;
    const extraWeight = billableWeight - 3;
    const intervals = Math.ceil((extraWeight * 16) / 4); // 4 oz intervals
    feeNonPeak = baseNonPeak + intervals * 0.08;
    feePeak = basePeak + intervals * 0.08;
  }

  if (!usedPublishedFormula && normalizedTier === "small bulky" && billableWeight > 1) {
    const baseNonPeak = hazmat ? 9.30 : 6.69;
    const basePeak = hazmat ? 10.07 : 7.69;
    const extraWeight = Math.max(0, billableWeight - 1);
    feeNonPeak = baseNonPeak + extraWeight * 0.38;
    feePeak = basePeak + extraWeight * 0.38;
  }

  if (!usedPublishedFormula && normalizedTier === "large bulky" && billableWeight > 1) {
    const baseNonPeak = hazmat ? 7.50 : 6.75;
    const basePeak = hazmat ? 8.27 : 7.75;
    const extraWeight = Math.max(0, billableWeight - 1);
    feeNonPeak = baseNonPeak + extraWeight * 0.38;
    feePeak = basePeak + extraWeight * 0.38;
  }

  if (!usedPublishedFormula && normalizedTier === "extra-large") {
    if (billableWeight <= 50) {
      const baseNonPeak = hazmat ? 27.67 : 25.56;
      const basePeak = hazmat ? 28.44 : 26.56;
      const extraWeight = Math.max(0, billableWeight - 1);
      feeNonPeak = baseNonPeak + extraWeight * 0.38;
      feePeak = basePeak + extraWeight * 0.38;
    } else if (billableWeight <= 70) {
      const baseNonPeak = hazmat ? 39.76 : 36.55;
      const basePeak = hazmat ? 40.53 : 37.55;
      const extraWeight = Math.max(0, billableWeight - 51);
      feeNonPeak = baseNonPeak + extraWeight * 0.75;
      feePeak = basePeak + extraWeight * 0.75;
    } else if (billableWeight <= 150) {
      const baseNonPeak = hazmat ? 57.68 : 50.55;
      const basePeak = hazmat ? 58.45 : 51.55;
      const extraWeight = Math.max(0, billableWeight - 71);
      feeNonPeak = baseNonPeak + extraWeight * 0.75;
      feePeak = basePeak + extraWeight * 0.75;
    } else {
      const baseNonPeak = hazmat ? 218.76 : 194.18;
      const basePeak = hazmat ? 219.53 : 195.18;
      const extraWeight = Math.max(0, billableWeight - 151);
      feeNonPeak = baseNonPeak + extraWeight * 0.19;
      feePeak = basePeak + extraWeight * 0.19;
    }
  }

  // Ships in Product Packaging. Reported, NOT folded into feeNonPeak: Amazon
  // takes the discount off the fee AFTER the fuel surcharge, as a flat amount
  // per unit. Measured, not assumed - SEZ0101011 is billed $7.15, which is
  // $7.13 x 1.035 - $0.23; discounting first gives ($7.13 - $0.23) x 1.035 =
  // $7.14. Callers add `sipp.amount` once they've applied the surcharge.
  // Only runs when the caller states certification; unknown changes nothing.
  let sipp: SippEffect | undefined;
  if (sippCertified !== undefined && feeNonPeak > 0) {
    const find = (rows?: ReadonlyArray<FbaFeeRow>) =>
      rows?.find(
        (r) =>
          r.tier === normalizedTier &&
          // A general SIPP row must not discount a Dangerous Goods fee, or the
          // other way round.
          Boolean((r as { hazmat?: boolean }).hazmat) === hazmat &&
          // Amazon sizes the packaging fee by DIMENSIONAL weight - the box it
          // has to wrap - while discounts follow the usual shipping weight. A
          // heavy but compact bulky unit pays a small packaging fee.
          weightBandMatches(
            r.weightRange,
            r.weightBasis === "Dimensional weight" ? dimWeight : billableWeight,
          ),
      );
    if (sippCertified) {
      // A published SIPP card wins; the built-in table covers the gap until
      // one is pasted, exactly as the built-in fee table does for fees.
      const published = feeTableOverride?.sipp?.length ? feeTableOverride.sipp : null;
      const row = find(published ?? (hazmat ? [] : BUILT_IN_SIPP_DISCOUNTS));
      if (row) {
        sipp = {
          status: "discount",
          amount: -bandValue(row, sellingPrice),
          source: published ? "published" : "built-in",
        };
      } else if (normalizedTier === "small standard" || normalizedTier === "large standard") {
        sipp = { status: "no_rate", amount: 0, source: published ? "published" : "built-in" };
      } else {
        // Bulky and extra-large SIPP units get a lower base rate instead of a
        // discount (since 15 Jan 2026), so no row here is the expected case -
        // not a gap in the table worth warning about.
        sipp = { status: "none", amount: 0 };
      }
    } else {
      const row = find(feeTableOverride?.nonSippPackaging);
      sipp = row
        ? { status: "packaging_fee", amount: bandValue(row, sellingPrice), source: "published" }
        : { status: "none", amount: 0 };
    }
  }

  return {
    tier: sizeTier,
    feeNonPeak,
    feePeak,
    billableWeight,
    dimWeight,
    weightBasis,
    ...(sipp ? { sipp } : {}),
  };
}

export interface ReferralFeeResult {
  fee: number;
  rate: number;
  error?: string;
}

/**
 * Compute the Amazon referral fee for a category + price.
 * Returns `error` populated when the input is invalid or the category isn't in the table.
 */
export function calculateReferralFee(category: string, price: number): ReferralFeeResult {
  if (!category || typeof price !== "number" || isNaN(price)) {
    return { fee: 0, rate: 0, error: "❌ Invalid input" };
  }

  const normalizedCategory = category.toLowerCase().trim();
  const feeConditions = REFERRAL_FEES[normalizedCategory];

  if (!feeConditions || feeConditions.length === 0) {
    return { fee: 0, rate: 0, error: "❌ Category not found" };
  }

  let fee: number | null = null;
  let appliedRate: number | null = null;
  let applied = false;

  for (const condition of feeConditions) {
    const { rate, operator, limit } = condition;

    if (operator === null) {
      fee = price * (rate / 100);
      applied = true;
      appliedRate = rate;
      break;
    }
    if (limit === null) continue;

    const matches =
      ((operator === "<=" || operator === "≤") && price <= limit) ||
      (operator === "<" && price < limit) ||
      (operator === ">=" && price >= limit) ||
      (operator === ">" && price > limit) ||
      (operator === "=" && price === limit);

    if (matches) {
      fee = price * (rate / 100);
      applied = true;
      appliedRate = rate;
      break;
    }
  }

  if (!applied || fee === null || appliedRate === null) {
    return { fee: 0, rate: 0, error: "❌ Unable to match tier" };
  }

  const minFee = feeConditions[0].minFee;
  return { fee: Math.max(fee, minFee), rate: appliedRate };
}

/**
 * Amazon return processing fee for a given size tier and shipping weight (oz).
 */
export function calculateReturnProcessingFee(sizeTier: string, shippingWeightOz: number): number {
  if (typeof sizeTier !== "string" || isNaN(shippingWeightOz)) return 0;

  let normalizedTier = sizeTier.toLowerCase().replace(/[^a-z0-9+]/g, " ").replace(/\s+/g, " ").trim();
  if (normalizedTier.includes("small standard")) normalizedTier = "small standard";
  if (normalizedTier.includes("large standard")) normalizedTier = "large standard";
  if (normalizedTier.includes("large bulky")) normalizedTier = "large bulky";
  if (normalizedTier.includes("extra large 0 to 50")) normalizedTier = "extra-large 0 to 50 lb";
  if (normalizedTier.includes("extra large 50") || normalizedTier.includes("50+ to 70")) {
    normalizedTier = "extra-large 50+ to 70 lb";
  }
  if (normalizedTier.includes("extra large 70") || normalizedTier.includes("70+ to 150")) {
    normalizedTier = "extra-large 70+ to 150 lb";
  }
  if (normalizedTier.includes("extra large 150")) normalizedTier = "extra-large 150+ lb";

  const oz = shippingWeightOz;
  const lbs = shippingWeightOz / 16;

  const tiersOz: Record<string, ReadonlyArray<readonly [number, number]>> = {
    "small standard": [
      [2, 1.78], [4, 1.84], [6, 1.90], [8, 1.96],
      [10, 2.02], [12, 2.08], [14, 2.14], [16, 2.21],
    ],
    "large standard": [
      [4, 2.36], [8, 2.70], [12, 3.05], [16, 3.39],
      [20, 3.70], [24, 4.01], [28, 4.32], [32, 4.63],
      [36, 4.66], [40, 4.68], [44, 4.71], [48, 4.73],
    ],
  };

  const tiersLb: Record<string, (lb: number) => number> = {
    "large bulky": (lb) => 6.74 + 0.32 * Math.max(0, lb - 1),
    "extra-large 0 to 50 lb": (lb) => 26.33 + 0.38 * Math.max(0, lb - 1),
    "extra-large 50+ to 70 lb": (lb) => 40.12 + 0.75 * Math.max(0, lb - 51),
    "extra-large 70+ to 150 lb": (lb) => 52.45 + 0.75 * Math.max(0, lb - 71),
    "extra-large 150+ lb": (lb) => 157.35 + 0.19 * Math.max(0, lb - 151),
  };

  if (tiersOz[normalizedTier]) {
    for (const [maxOz, cost] of tiersOz[normalizedTier]) {
      if (oz <= maxOz) return Math.round(cost * 100) / 100;
    }
    if (normalizedTier === "large standard" && oz > 48 && oz <= 320) {
      const extraOz = oz - 48;
      const intervals = Math.ceil(extraOz / 4);
      const fee = 5.0 + 0.05 * intervals;
      return Math.round(fee * 100) / 100;
    }
    return 0;
  }

  if (tiersLb[normalizedTier]) {
    return Math.round(tiersLb[normalizedTier](lbs) * 100) / 100;
  }

  return 0;
}

/**
 * Returns "YES" if a product meets the Amazon SIPP dimension floor (L>6", W>4", H>0.375").
 */
export function checkSippEligibility(lengthCm: number, widthCm: number, heightCm: number): "YES" | "NO" {
  const length = lengthCm / 2.54;
  const width = widthCm / 2.54;
  const height = heightCm / 2.54;
  const dims = [length, width, height].sort((a, b) => b - a);
  return dims[0] > 6 && dims[1] > 4 && dims[2] > 0.375 ? "YES" : "NO";
}

/**
 * Amazon's US Ships in Product Packaging discounts, per certified unit, by tier
 * and weight band. Shared by the P&L calculator (calculateSippDiscount) and the
 * fee engine's fallback, so the figures live in one place.
 */
const SIPP_DISCOUNT_TABLE: ReadonlyArray<readonly [string, string, number]> = [
    ["small standard", "2 oz or less", 0.04],
    ["small standard", "2+ to 4 oz", 0.04],
    ["small standard", "4+ to 6 oz", 0.05],
    ["small standard", "6+ to 8 oz", 0.05],
    ["small standard", "8+ to 10 oz", 0.06],
    ["small standard", "10+ to 12 oz", 0.06],
    ["small standard", "12+ to 14 oz", 0.07],
    ["small standard", "14+ to 16 oz", 0.07],
    ["large standard", "4 oz or less", 0.04],
    ["large standard", "4+ to 8 oz", 0.04],
    ["large standard", "8+ to 12 oz", 0.07],
    ["large standard", "12+ to 16 oz", 0.08],
    ["large standard", "1+ to 1.25 lb", 0.09],
    ["large standard", "1.25+ to 1.5 lb", 0.09],
    ["large standard", "1.5+ to 1.75 lb", 0.10],
    ["large standard", "1.75+ to 2 lb", 0.11],
    ["large standard", "2+ to 2.25 lb", 0.12],
    ["large standard", "2.25+ to 2.5 lb", 0.13],
    ["large standard", "2.5+ to 2.75 lb", 0.14],
    ["large standard", "2.75+ to 3 lb", 0.14],
    ["large standard", "3+ lb to 20 lb", 0.23],
    ["large bulky", "0 to 50 lb", 1.32],
  ];

/**
 * The same table as fee-engine rows, used when no published SIPP card has been
 * pasted. Two deliberate differences:
 *  - "3+ lb to 20 lb" is written "3+ to 20 lb", the spelling every other band
 *    and the band matcher use; as written it matches nothing.
 *  - The large bulky $1.32 row is left out. Amazon withdrew that discount on
 *    15 Jan 2026 and bulky units now pay a packaging fee when NOT certified
 *    instead, so applying it would under-state a bulky fee.
 */
export const BUILT_IN_SIPP_DISCOUNTS: ReadonlyArray<FbaFeeRow> = SIPP_DISCOUNT_TABLE.filter(
  ([tier]) => tier !== "large bulky",
).map(([tier, range, discount]) => ({
  tier,
  weightRange: range.replace(/^(\d+(?:\.\d+)?)\+ lb to /, "$1+ to "),
  nonPeak: discount,
  peak: discount,
  weightBasis: tier === "small standard" ? "Unit weight" : "Greater of unit or dimensional weight",
}));

/**
 * Compute the SIPP discount for an eligible product. Caller is responsible for
 * gating the call on `checkSippEligibility` + any user override.
 */
export function calculateSippDiscount(sizeTier: string, weightOz: number): number {
  const weightLb = weightOz / 16;
  const normalizedTier = sizeTier
    .toLowerCase()
    .trim()
    .replace("small standard-size", "small standard")
    .replace("large standard-size", "large standard");

  const table = SIPP_DISCOUNT_TABLE;

  for (const [tier, range, discount] of table) {
    if (tier !== normalizedTier) continue;

    if (range.includes("oz")) {
      if (range.includes("or less")) {
        const max = parseFloat(range);
        if (weightOz <= max) return discount;
      } else if (range.includes("+ to")) {
        const [minStr, maxStr] = range.replace(" oz", "").split("+ to");
        const min = parseFloat(minStr);
        const max = parseFloat(maxStr);
        if (weightOz > min && weightOz <= max) return discount;
      }
    } else if (range.includes("lb")) {
      if (range.includes("or less")) {
        const max = parseFloat(range);
        if (weightLb <= max) return discount;
      } else if (range.includes("+ to")) {
        const [minStr, maxStr] = range.replace(" lb", "").split("+ to");
        const min = parseFloat(minStr);
        const max = parseFloat(maxStr);
        if (weightLb > min && weightLb <= max) return discount;
      } else if (range.includes("to")) {
        const [minStr, maxStr] = range.replace(" lb", "").split("to");
        const min = parseFloat(minStr);
        const max = parseFloat(maxStr);
        if (weightLb >= min && weightLb <= max) return discount;
      }
    }
  }

  return 0;
}
