"use client";

import { count, money } from "@/lib/format";

export interface AgeNow {
  date: string;
  bySku: Record<string, Record<string, number>>;
}

const BUCKETS = [
  ["age_0_90", "0–90"],
  ["age_91_180", "91–180"],
  ["age_181_270", "181–270"],
  ["age_271_330", "271–330"],
  ["age_331_365", "331–365"],
  ["age_365_plus", "365+"],
] as const;

/** FBA stock by age, from the latest daily snapshot. Only SKUs holding stock past 90 days. */
export function AgePanel({ ageNow, days, names }: { ageNow: AgeNow | null; days: number; names: Record<string, string> }) {
  if (!ageNow) {
    return (
      <p className="text-sm text-muted-foreground">
        No age snapshot recorded yet. The gateway records one each morning at 06:15; Amazon only reports inventory age as
        &ldquo;now&rdquo;, so this history starts from the first one.
      </p>
    );
  }
  const rows = Object.entries(ageNow.bySku)
    .map(([sku, b]) => ({
      sku,
      b,
      old: (b.age_91_180 ?? 0) + (b.age_181_270 ?? 0) + (b.age_271_330 ?? 0) + (b.age_331_365 ?? 0) + (b.age_365_plus ?? 0),
    }))
    .filter((r) => r.old > 0)
    .sort((a, b) => (b.b.ais_monthly ?? 0) - (a.b.ais_monthly ?? 0) || b.old - a.old);

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">
        Snapshot of {ageNow.date}. {days} day{days === 1 ? "" : "s"} recorded so far. Units in FBA by days since they
        arrived; the aged surcharge starts at 181.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">SKU</th>
              {BUCKETS.map(([, label]) => (
                <th key={label} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                  {label} days
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap" title="Amazon's estimate of next month's aged surcharge">
                Next surcharge
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sku} className="border-t border-border">
                <td className="max-w-[18rem] px-3 py-2">
                  <div className="font-medium">{r.sku}</div>
                  {names[r.sku.toUpperCase()] && (
                    <div className="truncate text-xs text-muted-foreground">{names[r.sku.toUpperCase()]}</div>
                  )}
                </td>
                {BUCKETS.map(([k]) => (
                  <td key={k} className="px-3 py-2 text-right tabular-nums">
                    {r.b[k] ? count(r.b[k]) : <span className="text-muted-foreground">·</span>}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums">{r.b.ais_monthly ? money(r.b.ais_monthly) : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={BUCKETS.length + 2} className="px-3 py-6 text-center text-muted-foreground">
                  Nothing older than 90 days in FBA.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
