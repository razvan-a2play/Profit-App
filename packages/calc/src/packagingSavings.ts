// "Would a slightly smaller box lower the FBA fee?"
//
// Amazon's fee jumps at hard lines: size-tier limits (18 x 14 x 8 in for large
// standard, ...) and weight bands, where the weight is the greater of unit
// weight and dimensional weight (L x W x H / 139). A box a few millimetres past
// one of those lines pays the higher fee for every unit sold.
//
// Rather than encode each line, this shrinks the box the way a packaging
// change would - one side, or two sides together, by up to maxReductionCm in
// stepCm steps - and re-prices every variant with the same computeAmazonFbaFees
// the P&L uses. So it sees every line the fee engine knows about (tiers, weight
// bands, oversize handling fees) and won't suggest a cut that, say, loses the
// SIPP discount and ends up dearer.

import { computeAmazonFbaFees, type AmazonFbaFeeInput } from "./amazonFees";
import type { FeeSchedule } from "./feeSchedules";

export type BoxSide = "length" | "width" | "height";

export interface BoxCut {
  side: BoxSide;
  fromCm: number;
  toCm: number;
  byCm: number;
}

export interface FeeSnapshot {
  tier: string;
  /** Rate-card band, e.g. "4+ to 8 oz" (formula tiers read "0+ lb"). */
  weightBand?: string;
  /** Weight Amazon prices on: unit or dimensional, whichever is greater. */
  billableWeightLb: number;
  dimWeightLb: number;
  /** FBA fee per unit as the P&L uses it (surcharge, SIPP, peak-weighted). */
  fbaFee: number;
}

export interface PackagingSaving {
  cuts: BoxCut[];
  totalCutCm: number;
  savingPerUnit: number;
  before: FeeSnapshot;
  after: FeeSnapshot;
}

export interface PackagingSavingsOptions {
  /** Largest cut considered on any one side (default 2 cm). */
  maxReductionCm?: number;
  /** Search resolution (default 0.1 cm). */
  stepCm?: number;
  /** Sides changed at once: 1, or 2 (default). Never all three. */
  maxSides?: 1 | 2;
  /** Ignore savings smaller than this per unit (default half a cent). */
  minSaving?: number;
  /** Most options returned (default 3). */
  limit?: number;
}

const SIDES: BoxSide[] = ["length", "width", "height"];
const r2 = (n: number) => Math.round(n * 100) / 100;

function snapshot(f: ReturnType<typeof computeAmazonFbaFees>): FeeSnapshot {
  return {
    tier: f.tier,
    weightBand: f.fba.weightBand,
    billableWeightLb: f.billableWeight,
    dimWeightLb: f.dimWeight,
    fbaFee: f.fbaWeighted,
  };
}

/**
 * Box changes of up to `maxReductionCm` on one or two sides that lower the
 * per-unit FBA fee. Returned smallest change first; each later option saves
 * more than every smaller one (the ones that cost more cutting for no extra
 * saving are dropped). Empty when nothing within reach lowers the fee.
 */
export function findPackagingSavings(
  input: AmazonFbaFeeInput,
  schedule: FeeSchedule,
  options: PackagingSavingsOptions = {},
): PackagingSaving[] {
  const { maxReductionCm = 2, stepCm = 0.1, maxSides = 2, minSaving = 0.005, limit = 3 } = options;
  const base = computeAmazonFbaFees(input, schedule);
  if (!(base.fbaWeighted > 0)) return [];

  const steps = Math.round(maxReductionCm / stepCm);
  const cutsCm = Array.from({ length: steps }, (_, i) => r2((i + 1) * stepCm));
  const before = snapshot(base);
  const found: PackagingSaving[] = [];

  const tryCuts = (plan: Array<[BoxSide, number]>) => {
    const next: AmazonFbaFeeInput = { ...input };
    const cuts: BoxCut[] = [];
    for (const [side, by] of plan) {
      const from = input[side];
      const to = r2(from - by);
      if (!(to > 0)) return;
      next[side] = to;
      cuts.push({ side, fromCm: from, toCm: to, byCm: by });
    }
    const f = computeAmazonFbaFees(next, schedule);
    const saving = base.fbaWeighted - f.fbaWeighted;
    if (saving >= minSaving) {
      found.push({
        cuts,
        totalCutCm: r2(cuts.reduce((s, c) => s + c.byCm, 0)),
        savingPerUnit: saving,
        before,
        after: snapshot(f),
      });
    }
  };

  for (const side of SIDES) for (const by of cutsCm) tryCuts([[side, by]]);
  if (maxSides >= 2) {
    for (let i = 0; i < SIDES.length; i++)
      for (let j = i + 1; j < SIDES.length; j++)
        for (const a of cutsCm) for (const b of cutsCm) tryCuts([[SIDES[i], a], [SIDES[j], b]]);
  }

  // Smallest change first; among equal change, fewer sides, then more saving.
  found.sort(
    (x, y) =>
      x.totalCutCm - y.totalCutCm ||
      x.cuts.length - y.cuts.length ||
      y.savingPerUnit - x.savingPerUnit,
  );
  // Keep an option only if it saves more than every smaller change before it.
  const options_: PackagingSaving[] = [];
  let best = 0;
  for (const s of found) {
    if (s.savingPerUnit > best + 0.0049) {
      options_.push(s);
      best = s.savingPerUnit;
    }
  }
  return options_.slice(0, limit);
}
