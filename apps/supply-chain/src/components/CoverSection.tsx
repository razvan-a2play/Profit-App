"use client";

import { useEffect, useMemo, useState } from "react";
import { storageVsTarget, type CoverChannel, type CoverMonth, type InventorySkuRow, type PeriodSummary } from "@platform/supply-chain-data";
import { count, money, money2, monthLabel } from "@/lib/format";
import { periodLabel } from "@/lib/metrics";
import { DeltaArrow, TONE } from "./ui";

const CHANNEL = {
  fba: { stock: "FBA stock", storage: "FBA storage", id: "fba" },
  awd: { stock: "AWD stock", storage: "AWD storage", id: "awd" },
  total: { stock: "stock (FBA + AWD)", storage: "storage", id: "total" },
} as const;

/**
 * What storage would have cost holding exactly the target days of stock,
 * against what Amazon charged. Money lost to excess and money saved by
 * running lean are shown apart, so one cannot hide the other.
 */
export function CoverSection({
  rows,
  period,
  base = null,
  channel = "total",
}: {
  rows: InventorySkuRow[];
  period: PeriodSummary;
  /** The comparison period (same months last year, or the prior period). */
  base?: PeriodSummary | null;
  channel?: CoverChannel;
}) {
  const c = CHANNEL[channel];
  const storeKey = `supply-chain:target-days:${channel}`;
  const withAged = channel !== "awd";
  // AWD has no per-unit cubic feet from Amazon, so its target is priced per unit only.
  const cubic = channel !== "awd";
  const [target, setTarget] = useState(60);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(storeKey));
      if (saved >= 7 && saved <= 365) setTarget(saved);
    } catch {
      /* storage unavailable: keep 60 */
    }
  }, [storeKey]);
  const choose = (v: number) => {
    setTarget(v);
    try {
      localStorage.setItem(storeKey, String(v));
    } catch {
      /* not remembered, still applied */
    }
  };

  const report = useMemo(() => storageVsTarget(rows, target, channel), [rows, target, channel]);
  const inPeriod = new Set(period.months);
  const months = report.months.filter((m) => inPeriod.has(m.month));
  const total = (k: "actualStorage" | "agedSurcharge" | "idealStorage" | "overstockCost" | "leanSaving" | "net") =>
    months.reduce((a, m) => a + m[k], 0);
  const name = periodLabel(period.key, period.granularity, true);
  const missing = period.months.filter((m) => !months.some((x) => x.month === m));

  // Per SKU over the period: excess cost summed, cover from the period's totals.
  const skus = useMemo(() => {
    const by = new Map<string, { sku: string; name: string; held: number; target: number; demand: number; actual: number; aged: number; ideal: number; excess: number; n: number; cuft: number | null; cuftHeld: number; cuftTarget: number; capped: boolean }>();
    for (const r of report.rows) {
      if (!inPeriod.has(r.month)) continue;
      const cur = by.get(r.sku) ?? { sku: r.sku, name: r.productName, held: 0, target: 0, demand: 0, actual: 0, aged: 0, ideal: 0, excess: 0, n: 0, cuft: null, cuftHeld: 0, cuftTarget: 0, capped: false };
      if (r.cuftPerUnit) cur.cuft = r.cuftPerUnit;
      cur.held += r.unitsHeld;
      cur.target += r.targetUnits;
      cur.demand += r.dailyDemand;
      cur.actual += r.actualStorage;
      cur.aged += r.agedSurcharge;
      cur.ideal += r.idealStorage;
      cur.excess += r.excessCost;
      cur.cuftHeld += r.cuftHeld ?? 0;
      cur.cuftTarget += r.cuftTarget ?? 0;
      if (r.capped) cur.capped = true;
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
        <label htmlFor={`target-days-${c.id}`} className="text-muted-foreground">
          Target cover
        </label>
        <input
          id={`target-days-${c.id}`}
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
        <span className="text-muted-foreground">days of {c.stock}, every day of the month</span>
      </div>

      {months.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {channel === "awd"
            ? `No month in ${name} has its AWD storage invoiced yet (Amazon bills it the following month), so there is no AWD price to scale.`
            : `No month in ${name} has Amazon's per-SKU storage report yet, so there is no storage price to scale. Months from December 2025 on have it.`}
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
                  on {c.storage} in {name} against holding {target} days of {c.stock}
                </span>
              </>
            ) : (
              <>
                <span className="font-semibold" style={{ color: TONE.good }}>
                  {money(-net)} saved
                </span>{" "}
                <span className="text-muted-foreground">
                  on {c.storage} in {name} against holding {target} days of {c.stock}
                </span>
              </>
            )}
          </p>
          <p className="mb-4 text-sm text-muted-foreground">
            {c.storage[0].toUpperCase() + c.storage.slice(1)} charged {money(total("actualStorage") + total("agedSurcharge"))}
            {withAged ? ` (aged surcharge ${money(total("agedSurcharge"))})` : ""}; at{" "}
            {target} days it would have been {money(total("idealStorage"))}. Excess stock cost {money(total("overstockCost"))}; running
            below target saved {money(total("leanSaving"))}, with the stockout risk that carries.
            {missing.length
              ? ` Not judged: ${missing.map((m) => monthLabel(m)).join(", ")} (${channel === "awd" ? "AWD storage not invoiced yet" : "no per-SKU storage report"}).`
              : ""}
            {trailing ? " The latest months are sized on trailing demand until 60 days of what followed are known." : ""}
          </p>

          {base ? <Comparison report={report.months} period={period} base={base} target={target} withAged={withAged} cubic={cubic} /> : null}

          <div className="mb-6 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Month</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Days of cover held</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Units for {target} days</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Units held</th>
                  {cubic ? <th scope="col" className="px-3 py-2 text-right font-medium">Cu ft for {target} days</th> : null}
                  {cubic ? <th scope="col" className="px-3 py-2 text-right font-medium">Cu ft held</th> : null}
                  <th scope="col" className="px-3 py-2 text-right font-medium">Storage charged</th>
                  {withAged ? <th scope="col" className="px-3 py-2 text-right font-medium">Aged surcharge</th> : null}
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
                    <td className="px-3 py-2 text-right tabular-nums">{count(m.targetUnits)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{count(m.unitsHeld)}</td>
                    {cubic ? <td className="px-3 py-2 text-right tabular-nums">{count(m.cuftTarget)}</td> : null}
                    {cubic ? <td className="px-3 py-2 text-right tabular-nums">{count(m.cuftHeld)}</td> : null}
                    <td className="px-3 py-2 text-right tabular-nums">{money(m.actualStorage)}</td>
                    {withAged ? <td className="px-3 py-2 text-right tabular-nums">{money(m.agedSurcharge)}</td> : null}
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

          <h3 className="mb-2 text-sm font-medium">SKUs in {name}, most costly excess first ({c.stock})</h3>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">SKU</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium" title="Units shipped per day over the 60 days after mid-month">Daily demand</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Units for {target} days</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Avg units held</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Days held</th>
                  {cubic ? (
                    <>
                      <th scope="col" className="px-3 py-2 text-right font-medium" title="Cubic feet per unit, as Amazon measured it for storage">Cu ft / unit</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Cu ft for {target} days</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Cu ft held</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium" title="Storage charged ÷ cubic feet held: Amazon's monthly rate for this SKU">$ / cu ft</th>
                    </>
                  ) : (
                    <th scope="col" className="px-3 py-2 text-right font-medium" title="Storage charged ÷ units held: what one unit cost to store for a month">$ / unit-month</th>
                  )}
                  <th scope="col" className="px-3 py-2 text-right font-medium">Fee at {target} days</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Fee charged</th>
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
                    <td className="px-3 py-2 text-right tabular-nums">{(s.demand / s.n).toFixed(1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{count(Math.round(s.target / s.n))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{count(Math.round(s.held / s.n))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.demand > 0 ? `${count(Math.round(s.held / s.demand))} d` : "no sales"}</td>
                    {cubic ? (
                      <>
                        <td className="px-3 py-2 text-right tabular-nums">{s.cuft != null ? s.cuft.toFixed(3) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.cuft != null ? count(Math.round(s.cuftTarget / s.n)) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.cuft != null ? count(Math.round(s.cuftHeld / s.n)) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.cuftHeld > 0 ? money2(s.actual / s.cuftHeld) : "—"}</td>
                      </>
                    ) : (
                      <td className="px-3 py-2 text-right tabular-nums">{s.held > 0 ? (s.actual / s.held).toFixed(3) : "—"}</td>
                    )}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(s.ideal)}
                      {s.capped ? <span className="block text-xs text-muted-foreground">capped at 4×</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(s.actual + s.aged)}</td>
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
              {cubic ? (
                <p>
                  Fee at {target} days = units for {target} days × cu ft per unit × the $ per cu ft Amazon charged that
                  SKU that month (storage charged ÷ cu ft held, so it follows Amazon&apos;s standard and oversize rates and the
                  October–December peak rate).
                </p>
              ) : null}
              <p>
                {channel === "awd"
                  ? `Units held are the SKU's average AWD stock, worked back from today's AWD stock through the shipments in and replenishment orders out. AWD storage at target keeps its price per unit (its share of the month's AWD invoice, by AWD units held) and scales it to the target quantity.`
                  : channel === "fba"
                    ? `Units held are the SKU's average FBA stock from Amazon's ledger. FBA storage at target keeps its real price per unit, from Amazon's per-ASIN storage report, and scales it to the target quantity. Stock that turns within the target never reaches 181 days, so the aged surcharge is all counted as excess.`
                    : `Storage at target keeps each SKU's real price per unit (FBA storage from Amazon's per-ASIN report plus its share of AWD storage) and scales it to the target quantity. The aged surcharge is all counted as excess.`}{" "}
                Running below target is capped at 4× the storage charged, so a SKU holding a sliver of its target can&apos;t
                dominate the savings.
              </p>
              <p>Amazon charged no low-inventory fee in any month read, so running lean has cost nothing in fees.</p>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

interface Totals {
  storage: number;
  overStorage: number;
  held: number;
  demand: number;
  cuftHeld: number;
  cuftTarget: number;
  charged: number;
  aged: number;
  over: number;
  lean: number;
  net: number;
}

function totals(ms: CoverMonth[]): Totals {
  const s = (k: keyof CoverMonth) => ms.reduce((a, m) => a + (m[k] as number), 0);
  return {
    storage: s("actualStorage"),
    overStorage: s("overstockStorage"),
    held: s("unitsHeld"),
    demand: s("dailyDemand"),
    cuftHeld: s("cuftHeld"),
    cuftTarget: s("cuftTarget"),
    charged: s("actualStorage") + s("agedSurcharge"),
    aged: s("agedSurcharge"),
    over: s("overstockCost"),
    lean: s("leanSaving"),
    net: s("net"),
  };
}

const days = (t: Totals) => (t.demand > 0 ? t.held / t.demand : null);
const excessShare = (t: Totals, aged = true) =>
  aged ? (t.charged > 0 ? t.over / t.charged : null) : t.storage > 0 ? t.overStorage / t.storage : null;
const space = (t: Totals) => (t.cuftTarget > 0 ? t.cuftHeld / t.cuftTarget : null);

type Verdict = "improving" | "worse" | "holding" | null;

/**
 * This period against the comparison, on the months both have judged. Volume
 * grows year on year, so the verdicts rest on rates (days held, share of the
 * bill paid for excess), not on dollars.
 */
function Comparison({
  report,
  period,
  base,
  target,
  withAged,
  cubic,
}: {
  report: CoverMonth[];
  period: PeriodSummary;
  base: PeriodSummary;
  target: number;
  withAged: boolean;
  cubic: boolean;
}) {
  const byMonth = new Map(report.map((m) => [m.month, m]));
  const pairs = period.months.map((m, i) => ({ cur: m, prev: base.months[i] }));
  const both = pairs.filter((p) => byMonth.has(p.cur) && byMonth.has(p.prev));
  const dropped = pairs.filter((p) => !(byMonth.has(p.cur) && byMonth.has(p.prev)));
  const baseName = periodLabel(base.key, base.granularity, true);
  const name = periodLabel(period.key, period.granularity, true);
  const before = period.months[0].slice(5) === base.months[0].slice(5) ? "A year before" : baseName;

  if (both.length === 0) {
    return (
      <p className="mb-4 text-sm text-muted-foreground">
        No comparison with {baseName}: {dropped.map((p) => monthLabel(byMonth.has(p.prev) ? p.cur : p.prev)).join(", ")} ha
        {dropped.length === 1 ? "s" : "ve"} no per-SKU storage report to judge.
      </p>
    );
  }

  const cur = totals(both.map((p) => byMonth.get(p.cur)!));
  const prev = totals(both.map((p) => byMonth.get(p.prev)!));
  // Until both sides' aged surcharge reports are read, compare storage alone:
  // counting an unread month's aged stock as $0 would flatter it.
  const agedOk = !withAged || both.every((p) => byMonth.get(p.cur)!.agedKnown && byMonth.get(p.prev)!.agedKnown);
  const share = (t: Totals) => excessShare(t, agedOk);
  const paid = (t: Totals) => (agedOk ? `${money(t.over)} of ${money(t.charged)}` : `${money(t.overStorage)} of ${money(t.storage)}`);
  const mixedBasis = both.some((p) => byMonth.get(p.cur)!.trailingShare > 0.5 || byMonth.get(p.prev)!.trailingShare > 0.5);

  // Closer to the target is better either side of it: under means stockout risk.
  const toTarget = (a: number | null, b: number | null): Verdict =>
    a == null || b == null ? null : Math.abs(a - target) < Math.abs(b - target) - 3 ? "improving" : Math.abs(a - target) > Math.abs(b - target) + 3 ? "worse" : "holding";
  const lower = (a: number | null, b: number | null, tol: number): Verdict =>
    a == null || b == null ? null : a < b - tol ? "improving" : a > b + tol ? "worse" : "holding";

  const pctTxt = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
  const rows: Array<{ label: string; note: string; cur: string; prev: string; verdict: Verdict }> = [
    {
      label: "Days of cover held",
      note: `Closer to ${target} is better: above it pays for space, below it risks stockouts`,
      cur: days(cur) != null ? `${Math.round(days(cur)!)} d` : "—",
      prev: days(prev) != null ? `${Math.round(days(prev)!)} d` : "—",
      verdict: toTarget(days(cur), days(prev)),
    },
    ...(cubic
      ? [
          {
            label: "Space held against space needed",
            note: `Cu ft held as a share of the cu ft ${target} days needed; 100% is on target`,
            cur: `${pctTxt(space(cur))} (${count(cur.cuftHeld)} of ${count(cur.cuftTarget)} cu ft)`,
            prev: `${pctTxt(space(prev))} (${count(prev.cuftHeld)} of ${count(prev.cuftTarget)} cu ft)`,
            // Weighted by bulk, not by sales, so it can disagree with days held; shown, not judged.
            verdict: null,
          },
        ]
      : []),
    {
      label: "Share of the storage bill paid for excess",
      note: agedOk
        ? "Excess stock cost ÷ storage charged; fair across years as volume grows"
        : "Excess stock cost ÷ storage charged, aged surcharge left out on both sides until both years' aged reports are read",
      cur: `${pctTxt(share(cur))} (${paid(cur)})`,
      prev: `${pctTxt(share(prev))} (${paid(prev)})`,
      verdict: lower(share(cur), share(prev), 0.02),
    },
    ...(withAged
      ? [
          {
            label: "Aged surcharge",
            note: "Stock older than 181 days; should be zero",
            cur: both.every((p) => byMonth.get(p.cur)!.agedKnown) ? money(cur.aged) : "not read yet",
            prev: both.every((p) => byMonth.get(p.prev)!.agedKnown) ? money(prev.aged) : "not read yet",
            verdict: agedOk ? lower(cur.aged, prev.aged, 25) : null,
          },
        ]
      : []),
    {
      label: "Saved running lean",
      note: "Below target: cheaper storage, but stockout risk",
      cur: money(cur.lean),
      prev: money(prev.lean),
      verdict: null,
    },
    {
      label: `Net against ${target} days`,
      note: "Excess paid minus lean saved",
      cur: cur.net >= 0 ? `${money(cur.net)} lost` : `${money(-cur.net)} saved`,
      prev: prev.net >= 0 ? `${money(prev.net)} lost` : `${money(-prev.net)} saved`,
      verdict: null,
    },
  ];

  const VERDICT = { improving: { text: "Improving", color: TONE.good }, worse: { text: "Worse", color: TONE.bad }, holding: { text: "Holding", color: TONE.muted } };

  return (
    <div className="mb-6">
      <h3 className="mb-1 text-sm font-medium">
        {name} against {baseName}
      </h3>
      <p className="mb-2 text-xs text-muted-foreground">
        Like-for-like: {both.map((p) => monthLabel(p.cur)).join(", ")} against {both.map((p) => monthLabel(p.prev)).join(", ")}.
        {dropped.length
          ? ` Left out: ${dropped.map((p) => `${monthLabel(p.cur)} (${byMonth.has(p.prev) ? monthLabel(p.cur) : monthLabel(p.prev)} has no per-SKU storage report)`).join(", ")}.`
          : ""}
        {mixedBasis ? " Months marked trailing demand are sized on past sales, so they read less exactly." : ""}
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Measure</th>
              <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">{name}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">{baseName}</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-border">
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  <span className="block font-medium">{r.label}</span>
                  <span className="block text-xs text-muted-foreground">{r.note}</span>
                </th>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{r.cur}</td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-muted-foreground">{r.prev}</td>
                <td className="px-3 py-2 whitespace-nowrap font-medium" style={{ color: r.verdict ? VERDICT[r.verdict].color : TONE.muted }}>
                  {r.verdict === "improving" ? <DeltaArrow dir="up" /> : r.verdict === "worse" ? <DeltaArrow dir="down" /> : null}
                  {r.verdict ? VERDICT[r.verdict].text : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {both.length > 1 ? (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">Month</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Days held</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{before}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Bill paid for excess</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{before}</th>
              </tr>
            </thead>
            <tbody>
              {both.map((p) => {
                const a = totals([byMonth.get(p.cur)!]);
                const b = totals([byMonth.get(p.prev)!]);
                return (
                  <tr key={p.cur} className="border-t border-border">
                    <th scope="row" className="px-3 py-2 text-left font-normal whitespace-nowrap">
                      {monthLabel(p.cur, "long")} <span className="text-muted-foreground">vs {monthLabel(p.prev)}</span>
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums">{days(a) != null ? `${Math.round(days(a)!)} d` : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{days(b) != null ? `${Math.round(days(b)!)} d` : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pctTxt(share(a))}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{pctTxt(share(b))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
