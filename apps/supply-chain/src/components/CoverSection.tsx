"use client";

import { useEffect, useMemo, useState } from "react";
import { storageVsTarget, type InventorySkuRow, type PeriodSummary } from "@platform/supply-chain-data";
import { count, money, monthLabel } from "@/lib/format";
import { periodLabel } from "@/lib/metrics";
import { TONE } from "./ui";

const STORE_KEY = "supply-chain:target-days";

/**
 * What storage would have cost holding exactly the target days of stock,
 * against what Amazon charged. Money lost to excess and money saved by
 * running lean are shown apart, so one cannot hide the other.
 */
export function CoverSection({ rows, period }: { rows: InventorySkuRow[]; period: PeriodSummary }) {
  const [target, setTarget] = useState(60);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(STORE_KEY));
      if (saved >= 7 && saved <= 365) setTarget(saved);
    } catch {
      /* storage unavailable: keep 60 */
    }
  }, []);
  const choose = (v: number) => {
    setTarget(v);
    try {
      localStorage.setItem(STORE_KEY, String(v));
    } catch {
      /* not remembered, still applied */
    }
  };

  const report = useMemo(() => storageVsTarget(rows, target), [rows, target]);
  const inPeriod = new Set(period.months);
  const months = report.months.filter((m) => inPeriod.has(m.month));
  const total = (k: "actualStorage" | "agedSurcharge" | "idealStorage" | "overstockCost" | "leanSaving" | "net") =>
    months.reduce((a, m) => a + m[k], 0);
  const name = periodLabel(period.key, period.granularity, true);
  const missing = period.months.filter((m) => !months.some((x) => x.month === m));

  // Per SKU over the period: excess cost summed, cover from the period's totals.
  const skus = useMemo(() => {
    const by = new Map<string, { sku: string; name: string; held: number; target: number; demand: number; actual: number; aged: number; ideal: number; excess: number; n: number }>();
    for (const r of report.rows) {
      if (!inPeriod.has(r.month)) continue;
      const cur = by.get(r.sku) ?? { sku: r.sku, name: r.productName, held: 0, target: 0, demand: 0, actual: 0, aged: 0, ideal: 0, excess: 0, n: 0 };
      cur.held += r.unitsHeld;
      cur.target += r.targetUnits;
      cur.demand += r.dailyDemand;
      cur.actual += r.actualStorage;
      cur.aged += r.agedSurcharge;
      cur.ideal += r.idealStorage;
      cur.excess += r.excessCost;
      cur.n += 1;
      by.set(r.sku, cur);
    }
    return [...by.values()].sort((a, b) => b.excess - a.excess);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, period.key]);

  const net = total("net");
  const trailing = months.some((m) => m.trailingShare > 0.5);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <label htmlFor="target-days" className="text-muted-foreground">
          Target cover
        </label>
        <input
          id="target-days"
          type="number"
          min={7}
          max={365}
          step={1}
          value={target}
          onChange={(e) => {
            const v = Math.round(Number(e.target.value));
            if (v >= 7 && v <= 365) choose(v);
          }}
          className="h-11 w-24 rounded-md border border-input bg-background px-3 tabular-nums sm:h-9"
        />
        <span className="text-muted-foreground">days of stock (FBA + AWD), every day of the month</span>
      </div>

      {months.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No month in {name} has Amazon&apos;s per-SKU storage report yet, so there is no storage price to scale. Months from
          December 2025 on have it.
        </p>
      ) : (
        <>
          <p className="mb-1 text-lg">
            {net >= 0 ? (
              <>
                <span className="font-semibold" style={{ color: TONE.bad }}>
                  {money(net)} lost
                </span>{" "}
                <span className="text-muted-foreground">
                  in {name} against holding {target} days of stock
                </span>
              </>
            ) : (
              <>
                <span className="font-semibold" style={{ color: TONE.good }}>
                  {money(-net)} saved
                </span>{" "}
                <span className="text-muted-foreground">
                  in {name} against holding {target} days of stock
                </span>
              </>
            )}
          </p>
          <p className="mb-4 text-sm text-muted-foreground">
            Storage charged {money(total("actualStorage") + total("agedSurcharge"))} (aged surcharge {money(total("agedSurcharge"))}); at{" "}
            {target} days it would have been {money(total("idealStorage"))}. Excess stock cost {money(total("overstockCost"))}; running
            below target saved {money(total("leanSaving"))}, with the stockout risk that carries.
            {missing.length ? ` Not judged: ${missing.map((m) => monthLabel(m)).join(", ")} (no per-SKU storage report).` : ""}
            {trailing ? " The latest months are sized on trailing demand until 60 days of what followed are known." : ""}
          </p>

          <div className="mb-6 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Month</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Days of cover held</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Storage charged</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Aged surcharge</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">At {target} days</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Paid for excess</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Saved running lean</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody>
                {[...report.months].reverse().map((m) => (
                  <tr key={m.month} className={inPeriod.has(m.month) ? "border-t border-border bg-primary-light" : "border-t border-border"}>
                    <th scope="row" className="px-3 py-2 text-left font-normal whitespace-nowrap">
                      {monthLabel(m.month, "long")}
                      {m.trailingShare > 0.5 ? <span className="block text-xs text-muted-foreground">trailing demand</span> : null}
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums">{m.coverDays != null ? `${count(m.coverDays)} d` : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(m.actualStorage)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(m.agedSurcharge)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(m.idealStorage)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: m.overstockCost > 0 ? TONE.bad : undefined }}>
                      {money(m.overstockCost)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(m.leanSaving)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums" style={{ color: m.net > 0 ? TONE.bad : m.net < 0 ? TONE.good : undefined }}>
                      {m.net > 0 ? `${money(m.net)} lost` : m.net < 0 ? `${money(-m.net)} saved` : money(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="mb-2 text-sm font-medium">SKUs in {name}, most costly excess first</h3>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">SKU</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Days of cover held</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Avg units held</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Target units</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Storage charged</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">At {target} days</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Lost (saved)</th>
                </tr>
              </thead>
              <tbody>
                {skus.map((s) => (
                  <tr key={s.sku} className="border-t border-border">
                    <th scope="row" className="max-w-[20rem] px-3 py-2 text-left font-normal">
                      <span className="block font-medium">{s.sku}</span>
                      {s.name ? <span className="block truncate text-xs text-muted-foreground">{s.name}</span> : null}
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums">{s.demand > 0 ? `${count(Math.round(s.held / s.demand))} d` : "no sales"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{count(Math.round(s.held / s.n))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{count(Math.round(s.target / s.n))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(s.actual + s.aged)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(s.ideal)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums" style={{ color: s.excess > 0.5 ? TONE.bad : s.excess < -0.5 ? TONE.good : undefined }}>
                      {s.excess >= 0 ? money(s.excess) : `(${money(-s.excess)})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">How this is worked out</summary>
            <div className="mt-2 space-y-1 text-muted-foreground">
              <p>
                Target stock is {target} days of the demand that actually followed: units shipped over the 60 days after
                mid-month (half the month, the next month, half the month after). The latest months use the trailing rate.
              </p>
              <p>
                Storage at target keeps each SKU&apos;s real price per unit — its FBA storage from Amazon&apos;s per-ASIN report
                plus its share of AWD storage — and scales it to the target quantity. Stock that turns within {target} days
                never reaches 181, so the aged surcharge is all counted as excess. Running below target is capped at 4× the
                storage charged, so a SKU holding a sliver of its target can&apos;t dominate the savings.
              </p>
              <p>Amazon charged no low-inventory fee in any month read, so running lean has cost nothing in fees.</p>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
