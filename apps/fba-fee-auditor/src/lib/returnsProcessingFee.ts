// Amazon FBA Returns Processing Fee — 2026 rate card + category thresholds.
// Source: Seller Central "2026 returns processing fee changes".
//
// Key mechanics this encodes:
//  1. Charged on all categories EXCEPT apparel/shoes (those pay per returned
//     unit with no threshold — different, cheaper rate card).
//  2. For everything else, only returned units ABOVE the product's category
//     return-rate threshold are charged.
//  3. Return rate = returned units ÷ units shipped, measured over the ship
//     month + following 2 calendar months.
//  4. Exempt if fewer than 25 units shipped in a month.
//  5. FBA New Selection: first 20 units per eligible parent ASIN exempt.
//  6. **Returnless resolutions are NOT charged this fee** (per the FBA
//     Returnless Resolutions policy) — which is why switching a SKU off
//     returnless can ADD fee exposure.

export type SizeTier =
  | "small_standard"
  | "large_standard"
  | "bulky"
  | "xl_0_50"
  | "xl_50_70"
  | "xl_70_150"
  | "xl_150_plus";

/** Category → return-rate threshold (fraction, e.g. 0.047 = 4.7%). */
export const RETURN_RATE_THRESHOLDS: Record<string, number> = {
  "Amazon Device Accessories": 0.113,
  "Amazon Explore": 0.048,
  "Automotive and Powersports": 0.091,
  "Baby Products": 0.093,
  "Backpacks, Handbags, and Luggage": 0.128,
  "Base Equipment Power Tools": 0.071,
  "Beauty, Health and Personal Care": 0.055,
  "Business, Industrial, and Scientific Supplies": 0.06,
  "Compact Appliances": 0.126,
  Computers: 0.114,
  "Consumer Electronics": 0.112,
  "Electronics Accessories": 0.088,
  "Everything Else": 0.048,
  Eyewear: 0.121,
  "Fine Art": 0.056,
  "Full-Size Appliances": 0.119,
  Furniture: 0.096,
  "Gift Cards": 0.048,
  "Grocery and Gourmet": 0.029,
  "Home and Kitchen": 0.081,
  Jewelry: 0.108,
  "Lawn and Garden": 0.077,
  "Lawn mowers and Snow Throwers": 0.095,
  Mattresses: 0.093,
  "Media - Books, DVD, Music, Software, Video": 0.051,
  "Musical Instruments and AV Production": 0.092,
  "Office Products": 0.044,
  "Pet Products": 0.102,
  "Sports and Outdoors": 0.087,
  Tires: 0.087,
  "Tools and Home Improvement": 0.087,
  "Toys and Games": 0.047,
  "Video Game Consoles": 0.107,
  "Video Games and Gaming Accessories": 0.065,
  Watches: 0.12,
};

export const DEFAULT_CATEGORY = "Toys and Games";

/** Threshold lookup with a safe fallback to the "Everything Else" rate. */
export function thresholdForCategory(category?: string | null): number {
  if (!category) return RETURN_RATE_THRESHOLDS[DEFAULT_CATEGORY];
  return (
    RETURN_RATE_THRESHOLDS[category] ??
    RETURN_RATE_THRESHOLDS[
      Object.keys(RETURN_RATE_THRESHOLDS).find(
        (k) => k.toLowerCase() === category.toLowerCase(),
      ) ?? "Everything Else"
    ] ??
    RETURN_RATE_THRESHOLDS["Everything Else"]
  );
}

// ── Rate card: all products EXCLUDING apparel & shoes ───────────────────────
// Bands are [maxWeightOz inclusive, feeUsd]; first match wins.

const SMALL_STANDARD_BANDS: [number, number][] = [
  [2, 1.78],
  [4, 1.84],
  [6, 1.9],
  [8, 1.96],
  [10, 2.02],
  [12, 2.08],
  [14, 2.14],
  [16, 2.21],
];

const LARGE_STANDARD_BANDS: [number, number][] = [
  [4, 2.36],
  [8, 2.7],
  [12, 3.05],
  [16, 3.39],
  [20, 3.7], // 1 to 1.25 lb
  [24, 4.01], // 1.25 to 1.5 lb
  [28, 4.32], // 1.5 to 1.75 lb
  [32, 4.63], // 1.75 to 2 lb
  [36, 4.66], // 2 to 2.25 lb
  [40, 4.68], // 2.25 to 2.5 lb
  [44, 4.71], // 2.5 to 2.75 lb
  [48, 4.73], // 2.75 to 3 lb
];

/**
 * Returns-processing fee per unit for non-apparel products.
 * @param tier      product size tier
 * @param weightOz  shipping weight in ounces (greater of unit / dimensional)
 */
export function returnsProcessingFee(tier: SizeTier, weightOz: number): number {
  const lb = weightOz / 16;

  if (tier === "small_standard") {
    for (const [maxOz, fee] of SMALL_STANDARD_BANDS) {
      if (weightOz <= maxOz) return fee;
    }
    return SMALL_STANDARD_BANDS[SMALL_STANDARD_BANDS.length - 1][1];
  }

  if (tier === "large_standard") {
    for (const [maxOz, fee] of LARGE_STANDARD_BANDS) {
      if (weightOz <= maxOz) return fee;
    }
    // 3+ lb to 20 lb: $5.00 + $0.05 per 4 oz interval above the first 3 lb
    const intervals = Math.ceil(Math.max(0, weightOz - 48) / 4);
    return 5.0 + 0.05 * intervals;
  }

  if (tier === "bulky") {
    // $6.74 + $0.32 per 1 lb interval above the first lb
    return 6.74 + 0.32 * Math.ceil(Math.max(0, lb - 1));
  }

  if (tier === "xl_0_50") {
    return 26.33 + 0.38 * Math.ceil(Math.max(0, lb - 1));
  }
  if (tier === "xl_50_70") {
    return 40.12 + 0.75 * Math.ceil(Math.max(0, lb - 51));
  }
  if (tier === "xl_70_150") {
    return 52.45 + 0.75 * Math.ceil(Math.max(0, lb - 71));
  }
  // 150+ lb
  return 157.35 + 0.19 * Math.ceil(Math.max(0, lb - 151));
}

/** Apparel & shoes pay per returned unit with no threshold (cheaper card). */
const APPAREL_SMALL_BANDS: [number, number][] = [
  [4, 1.65],
  [8, 1.75],
  [12, 1.85],
  [16, 1.95],
];
const APPAREL_LARGE_BANDS: [number, number][] = [
  [4, 2.04],
  [8, 2.12],
  [12, 2.19],
  [16, 2.27],
  [24, 2.62],
  [32, 2.98],
  [40, 3.33],
  [48, 3.69],
];

export function apparelReturnsFee(tier: SizeTier, weightOz: number): number {
  if (tier === "small_standard") {
    for (const [maxOz, fee] of APPAREL_SMALL_BANDS) if (weightOz <= maxOz) return fee;
    return 1.95;
  }
  if (tier === "large_standard") {
    for (const [maxOz, fee] of APPAREL_LARGE_BANDS) if (weightOz <= maxOz) return fee;
    // 3+ to 20 lb: $3.89 + $0.10 per half-lb interval above first 3 lb
    const halfLbIntervals = Math.ceil(Math.max(0, weightOz - 48) / 8);
    return 3.89 + 0.1 * halfLbIntervals;
  }
  // Bulky and XL use the same card as non-apparel.
  return returnsProcessingFee(tier, weightOz);
}

// ── Exposure model ──────────────────────────────────────────────────────────

export interface FeeExposureInput {
  /** Total refunds in the window (returnless + physical). */
  totalRefunds: number;
  /** Refunds that were physical returns (fee-eligible). */
  physicalRefunds: number;
  /** Displayed return rate as a fraction (e.g. 0.0555). From the dashboard. */
  displayedReturnRate: number;
  /** Category threshold as a fraction. */
  threshold: number;
  /** Per-unit fee from the rate card. */
  feePerUnit: number;
}

export interface FeeExposure {
  /** Units shipped, derived from refunds ÷ displayed rate. */
  unitsShipped: number;
  /** Fee-charged units under the CURRENT returnless/physical mix. */
  chargedUnitsNow: number;
  /** Fee-charged units if every refund became a physical return. */
  chargedUnitsIfAllPhysical: number;
  annualFeeNow: number;
  annualFeeIfAllPhysical: number;
  /** Extra fee you'd take on by switching off returnless (>= 0). */
  additionalFeeIfSwitched: number;
}

/**
 * Model returns-processing-fee exposure now vs. after switching a SKU off
 * returnless.
 *
 * Only PHYSICAL returns are charged the fee (returnless is exempt), and only
 * units above the threshold are charged. So the charged count is:
 *     max(0, physical_returns − threshold × units_shipped)
 */
export function modelFeeExposure(i: FeeExposureInput): FeeExposure {
  const unitsShipped =
    i.displayedReturnRate > 0 ? i.totalRefunds / i.displayedReturnRate : 0;
  const allowance = i.threshold * unitsShipped;

  const chargedUnitsNow = Math.max(0, i.physicalRefunds - allowance);
  const chargedUnitsIfAllPhysical = Math.max(0, i.totalRefunds - allowance);

  const annualFeeNow = chargedUnitsNow * i.feePerUnit;
  const annualFeeIfAllPhysical = chargedUnitsIfAllPhysical * i.feePerUnit;

  return {
    unitsShipped: Math.round(unitsShipped),
    chargedUnitsNow: Math.round(chargedUnitsNow),
    chargedUnitsIfAllPhysical: Math.round(chargedUnitsIfAllPhysical),
    annualFeeNow: Math.round(annualFeeNow * 100) / 100,
    annualFeeIfAllPhysical: Math.round(annualFeeIfAllPhysical * 100) / 100,
    additionalFeeIfSwitched:
      Math.round((annualFeeIfAllPhysical - annualFeeNow) * 100) / 100,
  };
}
