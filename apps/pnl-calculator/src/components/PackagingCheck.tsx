"use client";

// Live FBA packaging check, shown right under the box-size inputs so that
// whoever is trying package options (R&D or Live) sees, as they type, when the
// box is just past a line where Amazon's fee steps up.
import type { PackagingSaving } from "@platform/calc";
import { describeCuts, describeEffect } from "@/lib/packaging-text";

interface PackagingCheckProps {
  savings: PackagingSaving[];
  /** e.g. "2026 rates": which Amazon fee schedule the check priced with. */
  scheduleLabel: string;
}

export default function PackagingCheck({ savings, scheduleLabel }: PackagingCheckProps) {
  if (!savings.length) {
    return (
      <p className="text-xs text-gray-500">
        FBA packaging check ({scheduleLabel}): no cut of up to 2 cm on one or two sides of this box
        lowers the FBA fee.
      </p>
    );
  }
  return (
    <div className="rounded-lg border-2 border-emerald-300 bg-white p-4">
      <h4 className="font-semibold text-gray-800">
        This box is just past an FBA fee line: a slightly smaller box costs less
      </h4>
      <ul className="mt-2 space-y-2 text-sm">
        {savings.map((s) => (
          <li key={s.cuts.map((c) => `${c.side}${c.toCm}`).join("-")}>
            <div className="flex flex-wrap justify-between gap-x-4">
              <span className="text-gray-800">{describeCuts(s)}</span>
              <span className="font-semibold text-emerald-700">
                saves ${s.savingPerUnit.toFixed(2)} per unit
              </span>
            </div>
            <div className="text-xs text-gray-500">
              {describeEffect(s)} · FBA fee ${s.before.fbaFee.toFixed(2)} → ${s.after.fbaFee.toFixed(2)}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-gray-500">
        {scheduleLabel}. Checked every cut of up to 2 cm on one or two sides. Amazon measures each box and
        bills the greater of unit and dimensional weight, so leave a few millimetres of margin.
      </p>
    </div>
  );
}
