"use client";

// FBA fee check, right under the box-size inputs. Whoever is trying package
// options (R&D or Live) sees, as they type: what the fee is now, what sets it
// (the actual weight or the box size), and the smallest weight or box change
// that would drop it to a cheaper tier or weight band, with the saving.
import type { AmazonFbaFeeBreakdown, PackagingSaving, WeightSaving } from "@platform/calc";
import {
  CLOSE_CUT_CM,
  CLOSE_CUT_KG,
  bandLabel,
  describeCuts,
  describeEffect,
  describeWeightCut,
  fmtWeight,
} from "@/lib/packaging-text";

interface PackagingCheckProps {
  fees: AmazonFbaFeeBreakdown;
  driver: "actual weight" | "box size";
  unitWeightLb: number;
  boxSavings: PackagingSaving[];
  weightSavings: WeightSaving[];
  /** Widest box cut searched, for the "nothing found" sentence. */
  boxSearchCm: { oneSide: number; twoSides: number };
  scheduleLabel: string;
}

function Option({
  close,
  what,
  effect,
  saving,
}: {
  close: boolean;
  what: string;
  effect: string;
  saving: number;
}) {
  return (
    <li>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <span className={close ? "font-semibold text-gray-900" : "text-gray-800"}>
          {what}
          {close && <span className="ml-2 text-xs font-semibold text-emerald-700">small change</span>}
        </span>
        <span className={`font-semibold ${close ? "text-emerald-700" : "text-gray-700"}`}>
          saves ${saving.toFixed(2)} per unit
        </span>
      </div>
      <div className="text-xs text-gray-600">{effect}</div>
    </li>
  );
}

export default function PackagingCheck({
  fees,
  driver,
  unitWeightLb,
  boxSavings,
  weightSavings,
  boxSearchCm,
  scheduleLabel,
}: PackagingCheckProps) {
  const closeWin =
    boxSavings.some((s) => s.totalCutCm <= CLOSE_CUT_CM) ||
    weightSavings.some((w) => w.byKg <= CLOSE_CUT_KG + 1e-9);
  const band = bandLabel({
    tier: fees.tier,
    weightBand: fees.fba.weightBand,
    billableWeightLb: fees.billableWeight,
    dimWeightLb: fees.dimWeight,
    fbaFee: fees.fbaWeighted,
  });

  return (
    <section
      className={`rounded-xl border-2 p-5 shadow-sm ${
        closeWin ? "border-emerald-500 bg-emerald-50" : "border-amber-400 bg-white"
      }`}
      aria-label="FBA fee check"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-lg font-semibold text-gray-900">
          FBA fee check{closeWin ? ": a small packaging change saves money" : ""}
        </h4>
        <span className="text-xs text-gray-500">{scheduleLabel}</span>
      </div>

      <p className="mt-2 text-sm text-gray-800">
        Now: <span className="font-semibold">{fees.tier}</span>
        {band ? `, ${band} band` : ""} · FBA fee{" "}
        <span className="font-semibold">${fees.fbaWeighted.toFixed(2)}</span> per unit
      </p>
      <p className="text-sm text-gray-700">
        {driver === "actual weight"
          ? `Priced on the actual weight (${fmtWeight(unitWeightLb)}); the box's dimensional weight is only ${fmtWeight(fees.dimWeight)}.`
          : `Priced on the box size: dimensional weight ${fmtWeight(fees.dimWeight)} is more than the actual weight (${fmtWeight(unitWeightLb)}).`}
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <h5 className="text-sm font-semibold text-gray-900">Lighter</h5>
          {weightSavings.length ? (
            <ul className="mt-1 space-y-2 text-sm">
              {weightSavings.map((w) => (
                <Option
                  key={w.byKg}
                  close={w.byKg <= CLOSE_CUT_KG + 1e-9}
                  what={describeWeightCut(w)}
                  effect={`${describeEffect(w)} · FBA fee $${w.before.fbaFee.toFixed(2)} → $${w.after.fbaFee.toFixed(2)}`}
                  saving={w.savingPerUnit}
                />
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-gray-600">
              {driver === "box size"
                ? "Losing weight won't change the fee: the box size sets it."
                : "No weight reduction of up to half the weight lowers the fee."}
            </p>
          )}
        </div>

        <div>
          <h5 className="text-sm font-semibold text-gray-900">Smaller box</h5>
          {boxSavings.length ? (
            <ul className="mt-1 space-y-2 text-sm">
              {boxSavings.map((s) => (
                <Option
                  key={s.cuts.map((c) => `${c.side}${c.toCm}`).join("-")}
                  close={s.totalCutCm <= CLOSE_CUT_CM}
                  what={describeCuts(s)}
                  effect={`${describeEffect(s)} · FBA fee $${s.before.fbaFee.toFixed(2)} → $${s.after.fbaFee.toFixed(2)}`}
                  saving={s.savingPerUnit}
                />
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-gray-600">
              {driver === "actual weight"
                ? "A smaller box won't change the fee: the actual weight sets it, not the box size."
                : `No cut of up to ${boxSearchCm.oneSide} cm on one side, or ${boxSearchCm.twoSides} cm on two sides, lowers the fee.`}
            </p>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs text-gray-500">
        &quot;Small change&quot; = up to {CLOSE_CUT_CM} cm off the box or {CLOSE_CUT_KG * 1000} g lighter. Amazon
        weighs and measures every unit itself, so leave a little margin below each line.
      </p>
    </section>
  );
}
