// Plain-English wording for packaging savings, shared by the product page and
// the Live SKU dashboard so both say the same thing.
import type { FeeSnapshot, PackagingSaving, WeightSaving } from "@platform/calc";

/** A box cut or weight cut this small counts as an easy packaging change. */
export const CLOSE_CUT_CM = 2;
export const CLOSE_CUT_KG = 0.1;

const SIDE: Record<string, string> = { length: "length", width: "width", height: "height" };

const cm = (n: number) => `${Number(n.toFixed(2))} cm`;

/** Shipping weight in oz up to a pound, lb above. */
export function fmtWeight(lb: number): string {
  return lb <= 1 ? `${(lb * 16).toFixed(2)} oz` : `${lb.toFixed(2)} lb`;
}

/** Rate-card band worth showing ("0+ lb" formula rows carry no band). */
export function bandLabel(s: FeeSnapshot): string | null {
  return s.weightBand && s.weightBand !== "0+ lb" ? s.weightBand : null;
}

/** "Trim height 17.1 → 17 cm (−0.1 cm)" / "... and width ..." */
export function describeCuts(s: PackagingSaving): string {
  return (
    "Trim " +
    s.cuts.map((c) => `${SIDE[c.side]} ${cm(c.fromCm)} → ${cm(c.toCm)} (−${cm(c.byCm)})`).join(" and ")
  );
}

/** "73 g lighter (1.32 → 1.247 kg)" */
export function describeWeightCut(w: WeightSaving): string {
  return `${Math.round(w.byKg * 1000)} g lighter (${Number(w.fromKg.toFixed(3))} → ${Number(w.toKg.toFixed(3))} kg)`;
}

/** What the change does in Amazon's terms. */
export function describeEffect(s: { before: FeeSnapshot; after: FeeSnapshot }): string {
  const { before, after } = s;
  const weight = `shipping weight ${fmtWeight(before.billableWeightLb)} → ${fmtWeight(after.billableWeightLb)}`;
  if (before.tier !== after.tier) return `size tier ${before.tier} → ${after.tier}, ${weight}`;
  const b1 = bandLabel(before);
  const b2 = bandLabel(after);
  return b1 && b2 && b1 !== b2 ? `${weight}, weight band ${b1} → ${b2}` : weight;
}

const feeChange = (s: { before: FeeSnapshot; after: FeeSnapshot; savingPerUnit: number }) =>
  `FBA fee $${s.before.fbaFee.toFixed(2)} → $${s.after.fbaFee.toFixed(2)}, saves $${s.savingPerUnit.toFixed(2)} per unit.`;

/** One line for a tooltip. */
export function describeSaving(s: PackagingSaving): string {
  return `${describeCuts(s)}: ${describeEffect(s)}. ${feeChange(s)}`;
}

export function describeWeightSaving(w: WeightSaving): string {
  return `${describeWeightCut(w)}: ${describeEffect(w)}. ${feeChange(w)}`;
}
