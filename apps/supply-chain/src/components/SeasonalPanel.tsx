"use client";

import { useMemo } from "react";
import type { InventorySkuRow } from "@platform/supply-chain-data";
import { count, monthLabel } from "@/lib/format";

const DEFAULT_LEAD = 90;
/** Three months carrying at least this share of a year's shipments reads as seasonal. */
const SUGGEST_SHARE = 0.6;
/** ...and only for a SKU that sold in most months: a launch is all "peak" because it has no history. */
const MIN_ACTIVE = 9;

interface Season {
  sku: string;
  name: string;
  shipped: number;
  /** Share of the last twelve months' shipments in the busiest three in a row. */
  peakShare: number;
  peakFrom: string;
  peakTo: string;
  /** Months of the twelve with any shipments. */
  active: number;
}

const likely = (s: Season) => s.active >= MIN_ACTIVE && s.peakShare >= SUGGEST_SHARE;

/** Each SKU's busiest three months over the last twelve read, from units shipped. */
function seasons(rows: InventorySkuRow[]): Season[] {
  const months = [...new Set(rows.filter((r) => r.unitsShipped != null).map((r) => r.month))].sort().slice(-12);
  if (months.length < 6) return [];
  const by = new Map<string, { name: string; shipped: Map<string, number>; held: number }>();
  for (const r of rows) {
    if (!months.includes(r.month)) continue;
    const cur = by.get(r.sku) ?? { name: r.productName, shipped: new Map(), held: 0 };
    cur.shipped.set(r.month, r.unitsShipped ?? 0);
    cur.held = Math.max(cur.held, r.avgUnitsHeld ?? 0);
    if (r.productName) cur.name = r.productName;
    by.set(r.sku, cur);
  }
  const out: Season[] = [];
  for (const [sku, v] of by) {
    const series = months.map((m) => v.shipped.get(m) ?? 0);
    const total = series.reduce((a, b) => a + b, 0);
    if (total < 100 || v.held <= 0) continue;
    let best = 0;
    let at = 0;
    for (let i = 0; i + 3 <= series.length; i++) {
      const s = series[i] + series[i + 1] + series[i + 2];
      if (s > best) [best, at] = [s, i];
    }
    const active = series.filter((u) => u > 0).length;
    out.push({ sku, name: v.name, shipped: total, peakShare: best / total, peakFrom: months[at], peakTo: months[at + 2], active });
  }
  // Likely seasonal first, then the rest, each by how peaked they are.
  return out.sort((a, b) => Number(likely(b)) - Number(likely(a)) || b.peakShare - a.peakShare);
}

/**
 * Mark the SKUs whose stock has to be built before their season. Their AWD
 * target becomes lead time + target days of the demand ahead, so the build
 * isn't counted as excess; leftovers after the season still are.
 */
export function SeasonalPanel({
  rows,
  value,
  onChange,
  target,
}: {
  rows: InventorySkuRow[];
  value: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
  target: number;
}) {
  const list = useMemo(() => seasons(rows), [rows]);
  const set = Object.keys(value).length;
  const suggested = list.filter((s) => likely(s) && value[s.sku] == null).length;

  const toggle = (sku: string, on: boolean) => {
    const next = { ...value };
    if (on) next[sku] = DEFAULT_LEAD;
    else delete next[sku];
    onChange(next);
  };
  const setLead = (sku: string, days: number) => {
    if (days >= 0 && days <= 365) onChange({ ...value, [sku]: days });
  };

  if (list.length === 0) return null;
  return (
    <details className="mb-6 rounded-lg border border-border">
      <summary className="cursor-pointer px-4 py-3 text-sm">
        <span className="font-medium">Seasonal SKUs</span>
        <span className="text-muted-foreground">
          {" "}
          · {set ? `${set} set` : "none set"}
          {suggested ? ` · ${suggested} look seasonal` : ""}
        </span>
      </summary>
      <div className="border-t border-border px-4 py-3">
        <p className="mb-3 text-sm text-muted-foreground">
          For a seasonal SKU, AWD stock up to what it shipped over its lead time plus {target} days ahead counts as on target, so
          the build before the season isn&apos;t excess. Stock beyond that, or left after the season, still is; running thinner than
          {target} days is still judged on the plain target. FBA keeps the plain target: AWD refills it within weeks.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">Seasonal</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">SKU</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Busiest three months</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Shipped, last 12 months</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Lead time</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const on = value[s.sku] != null;
                return (
                  <tr key={s.sku} className="border-t border-border">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => toggle(s.sku, e.target.checked)}
                        aria-label={`${s.sku} is seasonal`}
                        className="h-5 w-5"
                      />
                    </td>
                    <th scope="row" className="max-w-[18rem] px-3 py-2 text-left font-normal">
                      <span className="block font-medium">{s.sku}</span>
                      {s.name ? <span className="block truncate text-xs text-muted-foreground">{s.name}</span> : null}
                    </th>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {monthLabel(s.peakFrom)} – {monthLabel(s.peakTo)}:{" "}
                      <span className={likely(s) ? "font-medium" : "text-muted-foreground"}>
                        {Math.round(s.peakShare * 100)}% of the year
                      </span>
                      {s.active < MIN_ACTIVE ? <span className="block text-xs text-muted-foreground">sold in only {s.active} of 12 months</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{count(s.shipped)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {on ? (
                        <>
                          <input
                            type="number"
                            min={0}
                            max={365}
                            value={value[s.sku]}
                            onChange={(e) => setLead(s.sku, Math.round(Number(e.target.value)))}
                            aria-label={`${s.sku} lead time in days`}
                            className="h-11 w-20 rounded-md border border-input bg-background px-2 text-right tabular-nums sm:h-8"
                          />{" "}
                          <span className="text-muted-foreground">days</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
