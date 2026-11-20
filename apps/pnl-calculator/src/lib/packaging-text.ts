// Plain-English wording for a packaging saving, shared by the FBA fees card
// and the Live SKU dashboard so both say the same thing.
import type { PackagingSaving } from "@platform/calc";

const SIDE: Record<string, string> = { length: "length", width: "width", height: "height" };

const cm = (n: number) => `${Number(n.toFixed(2))} cm`;

/** Shipping weight in oz up to a pound, lb above. */
export function fmtWeight(lb: number): string {
  return lb <= 1 ? `${(lb * 16).toFixed(2)} oz` : `${lb.toFixed(2)} lb`;
}

/** "Trim height 17.1 → 17 cm (−0.1 cm)" / "... and width ..." */
export function describeCuts(s: PackagingSaving): string {
  return (
    "Trim " +
    s.cuts.map((c) => `${SIDE[c.side]} ${cm(c.fromCm)} → ${cm(c.toCm)} (−${cm(c.byCm)})`).join(" and ")
  );
}

/** What the trim changes in Amazon's terms. */
export function describeEffect(s: PackagingSaving): string {
  const { before, after } = s;
  const weight = `shipping weight ${fmtWeight(before.billableWeightLb)} → ${fmtWeight(after.billableWeightLb)}`;
  if (before.tier !== after.tier) return `size tier ${before.tier} → ${after.tier}, ${weight}`;
  const bandChanged =
    before.weightBand && after.weightBand && before.weightBand !== after.weightBand;
  return bandChanged ? `${weight}, weight band ${before.weightBand} → ${after.weightBand}` : weight;
}

/** One line for a tooltip. */
export function describeSaving(s: PackagingSaving): string {
  return (
    `${describeCuts(s)}: ${describeEffect(s)}. ` +
    `FBA fee $${s.before.fbaFee.toFixed(2)} → $${s.after.fbaFee.toFixed(2)}, ` +
    `saves $${s.savingPerUnit.toFixed(2)} per unit.`
  );
}
