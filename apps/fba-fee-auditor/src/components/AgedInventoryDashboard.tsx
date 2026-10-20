"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, Button, Badge, Input, cn } from "@platform/ui";
import { Loader2, RefreshCw, AlertTriangle, Clock } from "lucide-react";
import type { AgedSku, AgedTotals } from "@/lib/agedInventory";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const usd0 = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
const num = (n: number) => new Intl.NumberFormat("en-US").format(n);

interface Payload {
  ready: boolean;
  status: string;
  reportId: string | null;
  dataAsOf: string | null;
  stale: boolean;
  totals: AgedTotals | null;
  rows: AgedSku[];
  error?: string;
}

/** Bucket columns, oldest first — the direction the money runs. */
const COLS: { key: keyof AgedSku; label: string; rate: number | null }[] = [
  { key: "age365Plus", label: "365+", rate: 6.9 },
  { key: "age331_365", label: "331-365", rate: 4.3 },
  { key: "age271_330", label: "271-330", rate: 1.4 },
  { key: "age181_270", label: "181-270", rate: 0.5 },
  { key: "age91_180", label: "91-180", rate: null },
  { key: "age0_90", label: "0-90", rate: null },
];
// Rates above are $ per CUBIC FOOT per month, not per unit.

type Filter = "all" | "paying" | "crossing" | "risk";

export function AgedInventoryDashboard() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("paying");
  const [q, setQ] = useState("");

  async function load() {
    setBusy(true);
    try {
      const r = await fetch("/api/aged-inventory");
      setData((await r.json()) as Payload);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const byFilter =
      filter === "paying"
        ? all.filter((r) => r.chargedUnits > 0)
        : filter === "crossing"
          ? all.filter((r) => r.crossingUnits > 0)
          : filter === "risk"
          ? all.filter((r) => r.riskUnits > 0)
          : all;
    const needle = q.trim().toLowerCase();
    return needle
      ? byFilter.filter(
          (r) =>
            r.sku.toLowerCase().includes(needle) ||
            (r.productName ?? "").toLowerCase().includes(needle),
        )
      : byFilter;
  }, [data, filter, q]);

  const t = data?.totals;

  if (!data && busy) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Pulling the inventory age report…
      </div>
    );
  }

  if (data?.error) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-4 text-sm text-destructive">{data.error}</CardContent>
      </Card>
    );
  }

  if (data && !data.ready) {
    return (
      <Card className="border-warning/50">
        <CardContent className="space-y-2 p-4 text-sm">
          <p className="font-medium">Amazon is still generating the report.</p>
          <p className="text-muted-foreground">
            Status <code className="rounded bg-muted px-1">{data.status}</code>
            {data.reportId ? ` · report ${data.reportId}` : ""}. It usually lands within a few
            minutes.
          </p>
          <Button size="sm" variant="outline" onClick={load} disabled={busy}>
            {busy ? (
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-3 w-3" />
            )}
            Check again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {t && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className={t.monthlyLtsf > 0 ? "border-destructive/40" : undefined}>
              <CardContent className="p-4">
                <div className="text-xs uppercase text-muted-foreground">Next charge</div>
                <div className="text-2xl font-semibold tabular-nums">
                  {usd(t.monthlyLtsf)}
                  <span className="text-sm font-normal text-muted-foreground">/mo</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Amazon&apos;s estimate on {num(t.chargedUnits)} units — {num(t.activeUnits)}{" "}
                  already aged plus {num(t.crossingUnits)} crossing before then
                </div>
              </CardContent>
            </Card>
            <Card className={t.projectedMonthlyLtsf > 0 ? "border-warning/50" : undefined}>
              <CardContent className="p-4">
                <div className="text-xs uppercase text-muted-foreground">Next in line</div>
                <div className="text-2xl font-semibold tabular-nums">
                  {usd(t.projectedMonthlyLtsf)}
                  <span className="text-sm font-normal text-muted-foreground">/mo</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {num(t.riskUnits)} units aged 91–180 at their own volume, if none sell
                  before day 181
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs uppercase text-muted-foreground">Aged stock value</div>
                <div className="text-2xl font-semibold tabular-nums">
                  {usd0(t.agedRetailValue)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  retail value of the 181+ units — what removal gives up
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs uppercase text-muted-foreground">On hand</div>
                <div className="text-2xl font-semibold tabular-nums">{num(t.totalUnits)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {num(t.skus)} SKUs ·{" "}
                  {t.totalUnits > 0
                    ? ((t.activeUnits / t.totalUnits) * 100).toFixed(1)
                    : "0.0"}
                  % of units are aged
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-4">
              <div className="mb-2 text-xs uppercase text-muted-foreground">
                Every unit on hand, by age
              </div>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
                {COLS.slice()
                  .reverse()
                  .map((c) => {
                    const units = t[c.key as keyof AgedTotals] as number;
                    const pct = t.totalUnits > 0 ? (units / t.totalUnits) * 100 : 0;
                    if (pct <= 0) return null;
                    const tone =
                      c.rate == null
                        ? c.label === "91-180"
                          ? "bg-warning"
                          : "bg-success"
                        : "bg-destructive";
                    return (
                      <div
                        key={c.label}
                        className={tone}
                        style={{ width: `${Math.max(pct, 0.4)}%` }}
                        title={`${c.label}: ${num(units)} units`}
                      />
                    );
                  })}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                {COLS.slice()
                  .reverse()
                  .map((c) => (
                    <span key={c.label}>
                      <strong className="text-foreground">{c.label}</strong>{" "}
                      {num(t[c.key as keyof AgedTotals] as number)}
                      {c.rate != null && ` · $${c.rate.toFixed(2)}/cu ft/mo`}
                    </span>
                  ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["paying", "Being charged"],
            ["crossing", "Crossing next"],
            ["risk", "At risk (91-180)"],
            ["all", "All SKUs"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              filter === key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {label}
          </button>
        ))}
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search SKU or product"
          className="ml-auto h-8 w-56"
        />
        <Button size="sm" variant="outline" onClick={load} disabled={busy}>
          {busy ? (
            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-3 w-3" />
          )}
          Refresh
        </Button>
      </div>

      {data?.stale && (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-light/30 p-2 text-xs">
          <Clock className="h-3 w-3 shrink-0" />
          Showing the last report Amazon finished
          {data.dataAsOf ? ` (${new Date(data.dataAsOf).toLocaleString()})` : ""}. A fresh one is
          being generated.
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-2 text-left">SKU</th>
              {COLS.map((c) => (
                <th key={c.label} className="p-2 text-right">
                  {c.label}
                </th>
              ))}
              <th className="p-2 text-right">Total</th>
              <th className="p-2 text-right">Crossing</th>
              <th className="p-2 text-right">Sells in</th>
              <th className="p-2 text-right">Amazon&apos;s estimate</th>
              <th className="p-2 text-right">Aged value</th>
              <th className="p-2 text-left">Oldest</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sku} className="border-t border-border align-top">
                <td className="p-2">
                  <div className="font-mono text-xs">{r.sku}</div>
                  {r.productName && (
                    <div className="max-w-[22rem] truncate text-[11px] text-muted-foreground">
                      {r.productName}
                    </div>
                  )}
                </td>
                {COLS.map((c) => {
                  const v = r[c.key] as number;
                  return (
                    <td
                      key={c.label}
                      className={cn(
                        "p-2 text-right tabular-nums",
                        v === 0 && "text-muted-foreground/40",
                        v > 0 && c.rate != null && "font-medium text-destructive",
                        v > 0 && c.label === "91-180" && "font-medium text-warning",
                      )}
                    >
                      {v === 0 ? "—" : num(v)}
                    </td>
                  );
                })}
                <td className="p-2 text-right tabular-nums">{num(r.totalUnits)}</td>
                <td className="p-2 text-right tabular-nums">
                  {r.crossingUnits > 0 ? (
                    <span className="font-medium text-warning">{num(r.crossingUnits)}</span>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </td>
                <td
                  className={cn(
                    "p-2 text-right tabular-nums text-xs",
                    r.daysToClearCrossing != null && r.daysToClearCrossing > 30 && "text-destructive",
                  )}
                  title={
                    r.crossingUnits > 0
                      ? `${num(r.unitsShippedT30)} sold in 30 days, ${num(r.unitsShippedT90)} in 90`
                      : undefined
                  }
                >
                  {r.crossingUnits === 0 ? (
                    <span className="text-muted-foreground/40">—</span>
                  ) : r.daysToClearCrossing == null ? (
                    <span className="text-destructive">no sales</span>
                  ) : (
                    `${r.daysToClearCrossing}d`
                  )}
                </td>
                <td className="p-2 text-right tabular-nums">
                  {r.monthlyLtsf > 0 ? (
                    <span className="font-medium text-destructive">{usd(r.monthlyLtsf)}/mo</span>
                  ) : r.projectedMonthlyLtsf != null && r.projectedMonthlyLtsf > 0 ? (
                    <span className="text-warning">{usd(r.projectedMonthlyLtsf)}/mo soon</span>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </td>
                <td className="p-2 text-right tabular-nums">
                  {r.agedRetailValue > 0 ? usd0(r.agedRetailValue) : "—"}
                </td>
                <td className="p-2">
                  {r.oldestBucket && (
                    <Badge
                      className={cn(
                        "whitespace-nowrap",
                        r.activeUnits > 0
                          ? "bg-destructive text-destructive-foreground"
                          : r.riskUnits > 0
                            ? "bg-warning text-warning-foreground"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {r.oldestBucket}
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLS.length + 7} className="p-8 text-center text-sm text-muted-foreground">
                  {filter === "paying"
                    ? "Amazon is charging no surcharge at the next charge date."
                    : filter === "crossing"
                      ? "Nothing is due to tip into a charged tier next time."
                      : "Nothing matches."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info-light/40 p-3 text-xs">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <div className="space-y-0.5">
          <p>
            The aged-inventory surcharge is priced <strong>per cubic foot</strong>, not per unit —{" "}
            <strong>$0.50</strong> at 181 days rising to <strong>$6.90</strong> past a year. On
            small items that is cents per unit, which is why <em>Surcharge now</em> is Amazon&apos;s
            own per-SKU estimate from the report rather than a rate applied to unit counts.
          </p>
          <p className="text-muted-foreground">
            <strong>Crossing</strong> is not a guess: Amazon publishes the quantity it will charge at
            the <em>next</em> charge date, so a unit still at 175 days today already appears there.
            <em> Sells in</em> is how long those units take to clear at the faster of the last 30-
            and 90-day rates — longer than about 30 days and they will be charged before they sell.
          </p>
          <p className="text-muted-foreground">
            <em>Next in line</em> is the only projection here: 91&ndash;180 units × their cubic feet ×
            the $0.50 entry rate, for the months after next. SKUs where Amazon reports no volume are
            left out of it rather than guessed at.
          </p>
          <p className="text-muted-foreground">
            Buckets come from the FBA Inventory Planning report — the Aged Inventory report has been
            returning FATAL, so this reads the same age columns from the report that completes.
          </p>
        </div>
      </div>
    </div>
  );
}
