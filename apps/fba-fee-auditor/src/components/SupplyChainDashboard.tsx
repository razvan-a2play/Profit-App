"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@platform/ui";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { SkuAssessment, SupplyChainReport, Verdict } from "@platform/supply-chain-data";

const usd = (n: number | null | undefined, dp = 2) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n);
const num = (n: number | null | undefined, dp = 0) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: dp }).format(n);
const pct = (n: number | null | undefined) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

interface Payload extends SupplyChainReport {
  error?: string;
  /** True once the month is final — cached for good on both sides. */
  settled?: boolean;
  billedReady: boolean;
  billedStatus: string | null;
  storageReady: boolean;
  monthUnavailable: boolean;
  awdSkus: number;
}

const VERDICT: Record<Verdict, { label: string; className: string; blurb: string }> = {
  stockout_risk: {
    label: "Running out",
    className: "bg-warning text-warning-foreground",
    blurb: "Under 28 days of cover — the low-inventory-level fee starts here.",
  },
  dead_stock: {
    label: "Dead stock",
    className: "bg-destructive text-destructive-foreground",
    blurb: "Nothing sold in 90 days, still paying storage.",
  },
  overstocked: {
    label: "Overstocked",
    className: "bg-warning text-warning-foreground",
    blurb: "More than 180 days of cover; aged surcharges start at 181 days in a fulfilment centre.",
  },
  storage_heavy: {
    label: "Costly to hold",
    className: "bg-warning/70 text-warning-foreground",
    blurb: "Storage and handling is more than 5% of the SKU's monthly revenue.",
  },
  healthy: { label: "OK", className: "bg-success text-success-foreground", blurb: "Selling, with no cover or cost flags." },
  no_data: { label: "No data", className: "bg-muted text-muted-foreground", blurb: "No sales and no stock in the window." },
};

const ORDER: Verdict[] = ["dead_stock", "overstocked", "stockout_risk", "storage_heavy", "healthy", "no_data"];

function lastMonths(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 1; i <= n; i++) {
    const c = new Date(d);
    c.setUTCMonth(c.getUTCMonth() - i);
    out.push(`${c.getUTCFullYear()}-${String(c.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function SupplyChainDashboard() {
  const months = useMemo(() => lastMonths(6), []);
  const [month, setMonth] = useState(months[0]);
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Verdict | "all">("all");

  const seen = useRef(new Map<string, Payload>());

  const load = useCallback(async (m: string) => {
    const hit = seen.current.get(m);
    if (hit) {
      setData(hit);
      if (hit.settled) return; // final: nothing to re-fetch
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/supply-chain?month=${m}`);
      const j = (await res.json()) as Payload;
      if (!res.ok) throw new Error(j.error ?? "Load failed");
      seen.current.set(m, j);
      setData(j);
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Load failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(month);
  }, [month, load]);

  // The AWD share of every SKU's cost comes from the billed fees; until that
  // scan lands the allocation is incomplete, so keep checking.
  useEffect(() => {
    if (data?.billedStatus !== "scanning") return;
    const t = setTimeout(() => void load(month), 20_000);
    return () => clearTimeout(t);
  }, [data?.billedStatus, data?.month, month, load]);

  const rows = (data?.skus ?? []).filter((s) => filter === "all" || s.verdict === filter);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {months.map((m) => (
          <button
            key={m}
            onClick={() => setMonth(m)}
            className={cn(
              "rounded-md px-2.5 py-1 text-sm transition-colors",
              m === month ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {m}
          </button>
        ))}
        <Button variant="outline" size="sm" onClick={() => load(month)} disabled={busy}>
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
        </div>
      )}

      {data?.billedStatus === "scanning" && (
        <div className="rounded-md border border-info/40 bg-info/10 p-3 text-sm">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Still reading {month}&apos;s charges from Amazon. The AWD share of each SKU&apos;s cost is
          incomplete until that finishes — FBA storage below is already final.
        </div>
      )}

      {/* What to do, before any table. */}
      {data && data.headlines.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">What the month says</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {data.headlines.map((h, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter("all")}
          className={cn(
            "rounded-full border px-3 py-1 text-sm",
            filter === "all" ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground",
          )}
        >
          All {data?.skus.length ?? 0}
        </button>
        {ORDER.filter((v) => (data?.counts?.[v] ?? 0) > 0).map((v) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            title={VERDICT[v].blurb}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              filter === v ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground",
            )}
          >
            {VERDICT[v].label} {data?.counts?.[v]}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Cost to hold and move, by product — {data?.month ?? month}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            <strong>FBA storage</strong> is what Amazon billed for that ASIN. <strong>AWD</strong> is this
            SKU&apos;s share of charges Amazon bills to the account as one figure, split by units held at
            AWD — fine for comparing products, not for disputing a charge.
            {data && ` ${usd(data.measuredTotal, 0)} billed per ASIN, ${usd(data.allocatedTotal, 0)} allocated.`}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Verdict</TableHead>
                <TableHead className="text-right">Sold /90d</TableHead>
                <TableHead className="text-right">FBA units</TableHead>
                <TableHead className="text-right">AWD units</TableHead>
                <TableHead className="text-right">Cover</TableHead>
                <TableHead className="text-right">FBA storage</TableHead>
                <TableHead className="text-right">AWD (alloc.)</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Per unit sold</TableHead>
                <TableHead className="text-right">% of revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <SkuRow key={s.sku} s={s} />
              ))}
            </TableBody>
          </Table>
          {rows.length === 0 && !busy && (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing in this group.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SkuRow({ s }: { s: SkuAssessment }) {
  const v = VERDICT[s.verdict];
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{s.sku}</div>
        {s.productName && (
          <div className="max-w-xs truncate text-xs text-muted-foreground">{s.productName}</div>
        )}
        <div className="mt-0.5 max-w-sm text-xs text-muted-foreground">{s.reasons[0]}</div>
      </TableCell>
      <TableCell>
        <Badge className={v.className}>{v.label}</Badge>
      </TableCell>
      <TableCell className="text-right tabular-nums">{num(s.unitsSoldT90)}</TableCell>
      <TableCell className="text-right tabular-nums">{num(s.fbaUnits)}</TableCell>
      <TableCell className="text-right tabular-nums">{num(s.awdUnits)}</TableCell>
      <TableCell
        className={cn(
          "text-right tabular-nums",
          s.daysOfSupply != null && (s.daysOfSupply > 180 || s.daysOfSupply < 28) && "text-warning",
        )}
      >
        {s.daysOfSupply != null ? `${num(s.daysOfSupply)}d` : "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">{usd(s.fbaStorage)}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {usd(s.awdStorageAllocated + s.awdHandlingAllocated)}
      </TableCell>
      <TableCell className="text-right font-medium tabular-nums">{usd(s.totalCost)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {s.costPerUnitSold != null ? usd(s.costPerUnitSold, 3) : "—"}
      </TableCell>
      <TableCell
        className={cn("text-right tabular-nums", (s.costShareOfRevenue ?? 0) > 0.05 && "text-warning")}
      >
        {pct(s.costShareOfRevenue)}
      </TableCell>
    </TableRow>
  );
}
