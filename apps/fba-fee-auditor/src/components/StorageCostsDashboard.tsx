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
import { Loader2, RefreshCw, Warehouse } from "lucide-react";
import { toast } from "sonner";
import type { BilledFees, PlanningRow, StorageFeeResult } from "@platform/supply-chain-data";

const usd = (n: number | null | undefined, dp = 2) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
      }).format(n);

const num = (n: number | null | undefined, dp = 0) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: dp }).format(n);

interface Payload {
  month: string;
  fetchedAt: string;
  cached?: boolean;
  /** True once Amazon has given everything for this month — then it never changes. */
  settled?: boolean;
  warning?: string;
  error?: string;
  monthUnavailable?: boolean;
  storage: StorageFeeResult | null;
  billed: BilledFees | null;
  planning: PlanningRow[];
}

/** The cost groups, in the order they're worth reading. */
const GROUPS: { key: string; label: string; hint: string }[] = [
  { key: "fba_storage", label: "FBA storage", hint: "Monthly storage at Amazon's fulfilment centres" },
  { key: "awd_storage", label: "AWD storage", hint: "Monthly storage at Amazon Warehousing & Distribution" },
  { key: "awd_receiving", label: "AWD receiving", hint: "AWD processing fee, charged per inbound shipment" },
  { key: "awd_transportation", label: "AWD transport", hint: "Moving stock from AWD into FBA" },
  { key: "fba_inbound", label: "FBA inbound", hint: "Placement service and inbound defect fees" },
  { key: "fba_removal", label: "Removals", hint: "Disposal and removal orders" },
];

/** Amazon starts charging a utilisation surcharge above 26 weeks of cover. */
const UTILISATION_LIMIT = 26;

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

export function StorageCostsDashboard() {
  const months = useMemo(() => lastMonths(6), []);
  const [month, setMonth] = useState(months[0]);
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Months already fetched stay in memory, so flipping between them is instant
  // instead of a round trip each time.
  const seen = useRef(new Map<string, Payload>());

  const load = useCallback(async (m: string, refresh = false) => {
    const hit = seen.current.get(m);
    if (hit && !refresh) {
      // Show what we have at once; a settled month is final, an unsettled one
      // keeps loading underneath so the figures fill in.
      setData(hit);
      if (hit.settled) return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/storage-costs?month=${m}${refresh ? "&refresh=1" : ""}`);
      const j = (await res.json()) as Payload;
      if (!res.ok) throw new Error(j.error ?? "Load failed");
      seen.current.set(m, j);
      setData(j);
      setError(null);
      if (j.warning) toast.warning(j.warning);
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

  // The first look at a month leaves the gateway paging Amazon in the
  // background (minutes). Poll until it lands rather than making the user
  // guess when to press Refresh.
  const scanning = data?.billed?.status === "scanning";
  useEffect(() => {
    if (!scanning) return;
    // No forced refresh: the server serves the cached month for 45 seconds and
    // then re-checks only the half that is still missing.
    const t = setTimeout(() => void load(month), 20_000);
    return () => clearTimeout(t);
  }, [scanning, month, load, data?.fetchedAt]);

  const storage = data?.storage;
  const billed = data?.billed;
  const totals = storage?.totals;

  // Per-SKU storage joined to how fast that SKU actually sells, since a storage
  // bill only means something next to the sell-through paying for it.
  const planBySku = useMemo(() => {
    const m = new Map<string, PlanningRow>();
    for (const p of data?.planning ?? []) {
      if (p.asin) m.set(p.asin, p);
    }
    return m;
  }, [data?.planning]);

  const rows = (storage?.rows ?? []).filter((r) => r.country === (storage?.country ?? "US"));
  // The headline is logistics only. Marketing (deals, coupons, Vine) and the
  // selling-plan subscription turn up in the same sweep but are not the cost of
  // holding and moving stock; "other" is whatever has no label yet, which must
  // not be quietly counted as logistics either.
  const LOGISTICS = new Set(GROUPS.map((g) => g.key));
  const billedTotal = Object.entries(billed?.by_group ?? {})
    .filter(([g]) => LOGISTICS.has(g))
    .reduce((t, [, v]) => t + (v ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
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
        </div>
        <Button variant="outline" size="sm" onClick={() => load(month, true)} disabled={busy}>
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
          Refresh
        </Button>
        {data?.cached && (
          <span className="text-xs text-muted-foreground">
            cached {new Date(data.fetchedAt).toLocaleString()}
          </span>
        )}
      </div>

      {/* What was actually billed, by cost type. */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {GROUPS.map((g) => (
          <Card key={g.key}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground" title={g.hint}>
                {g.label}
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {usd(billed?.by_group?.[g.key as keyof typeof billed.by_group] ?? 0, 0)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</div>
      )}

      {data?.monthUnavailable && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          Amazon hasn&apos;t published storage charges for {month} yet — it closes a month&apos;s storage
          billing partway through the next one, and cancels the report until then. The billed fees below
          are still read from the financial events.
        </div>
      )}

      {scanning && (
        <div className="rounded-md border border-info/40 bg-info/10 p-3 text-sm">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Reading what Amazon billed for {month}. There is no report for this — the charges have to be
          read out of the financial-event stream page by page, which takes a few minutes for a month.
          It is cached once done, so this wait happens once per month. The storage figures below are
          already live.
        </div>
      )}

      {data?.billed?.status === "failed" && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          The fee scan for {month} stopped early: {data.billed.error ?? "unknown error"}. Press Refresh
          to start it again.
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Warehouse className="h-4 w-4" />
            {month} — {usd(billedTotal, 0)} of storage and logistics cost
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {totals && (
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <Metric
                label="Storage utilisation"
                value={`${num(totals.utilization_ratio_weeks, 1)} weeks`}
                tone={totals.utilization_ratio_weeks > UTILISATION_LIMIT ? "bad" : "good"}
                hint={`Amazon charges a surcharge above ${UTILISATION_LIMIT} weeks of cover by volume. Yours is ${num(totals.utilization_ratio_weeks, 1)}.`}
              />
              <Metric label="Utilisation surcharge" value={usd(totals.surcharge_fee)} />
              <Metric label="Volume stored" value={`${num(totals.volume, 0)} ${totals.volume_units}`} />
              <Metric label="SKUs charged" value={num(totals.skus)} />
              {totals.incentive_discount > 0 && (
                <Metric label="Incentive discount" value={usd(totals.incentive_discount)} tone="good" />
              )}
            </div>
          )}

          {/* The estimate Amazon published during the month against the invoice. */}
          {totals && billed?.ready && (
            <p className="text-xs text-muted-foreground">
              The storage report estimated {usd(totals.fee)} of FBA storage for {month}; Amazon billed{" "}
              {usd(billed.by_group?.fba_storage ?? 0)} in the same window. The two are produced at different
              times, so a small gap is normal — a large one is worth asking about.
            </p>
          )}

          {storage?.by_country && Object.keys(storage.by_country).length > 1 && (
            <p className="text-xs text-muted-foreground">
              Marketplaces are kept apart: {Object.entries(storage.by_country)
                .map(([c, t]) => `${c} ${t.currency} ${num(t.fee, 2)}`)
                .join(" · ")}
              . Figures below are {storage.country}.
            </p>
          )}

          {billed && billed.unrecognised_fee_types.length > 0 && (
            <p className="text-xs text-warning">
              New fee type(s) Amazon billed that this page has no label for:{" "}
              <span className="font-mono">{billed.unrecognised_fee_types.join(", ")}</span>. They are counted
              in the total but not in a group.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Every charge Amazon billed, by type. */}
      {billed && billed.by_type.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">What Amazon billed</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Charge</TableHead>
                  <TableHead>Amazon&apos;s fee type</TableHead>
                  <TableHead className="text-right">Charges</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {billed.by_type.map((t) => (
                  <TableRow key={t.fee_type}>
                    <TableCell>
                      {t.description}
                      {(t.group === "marketing" || t.group === "overhead") && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          not logistics
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{t.fee_type}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.count}</TableCell>
                    <TableCell className="text-right tabular-nums">{usd(t.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Storage cost per SKU, against the sell-through paying for it. */}
      {rows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">FBA storage by SKU — {month}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ASIN</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Avg units</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead className="text-right">Storage</TableHead>
                  <TableHead className="text-right">Per unit</TableHead>
                  <TableHead className="text-right">Next month est.</TableHead>
                  <TableHead className="text-right">Sell-through</TableHead>
                  <TableHead className="text-right">Days cover</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const p = planBySku.get(r.asin);
                  return (
                    <TableRow key={`${r.asin}-${r.month}`}>
                      <TableCell className="font-mono text-xs">{r.asin}</TableCell>
                      <TableCell className="max-w-sm truncate text-xs text-muted-foreground">
                        {r.product_name}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{num(r.avg_units)}</TableCell>
                      <TableCell className="text-right tabular-nums">{num(r.total_volume_cuft, 1)}</TableCell>
                      <TableCell className="text-right tabular-nums">{usd(r.fee)}</TableCell>
                      <TableCell className="text-right tabular-nums">{usd(r.fee_per_unit, 3)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {p?.estimated_storage_cost_next_month != null
                          ? usd(p.estimated_storage_cost_next_month)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p?.sell_through != null ? num(p.sell_through, 2) : "—"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          (p?.days_of_supply ?? 0) > 180 && "text-warning",
                        )}
                      >
                        {p?.days_of_supply != null ? num(p.days_of_supply) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* AWD charges carry the shipment they belong to, so they can be read per movement. */}
      {billed && billed.charges.some((c) => c.group.startsWith("awd")) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">AWD charges, by shipment</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Charge</TableHead>
                  <TableHead>Shipment / order</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {billed.charges
                  .filter((c) => c.group.startsWith("awd"))
                  .sort((a, b) => b.amount - a.amount)
                  .map((c, i) => (
                    <TableRow key={`${c.reference}-${c.fee_type}-${i}`}>
                      <TableCell>{c.description}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{c.reference}</TableCell>
                      <TableCell className="text-right tabular-nums">{usd(c.amount)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {!busy && !storage?.ready && !billed && (
        <p className="text-sm text-muted-foreground">
          Nothing for {month} yet. Amazon takes a few minutes to generate the storage report the first time a
          month is asked for — press Refresh again shortly.
        </p>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
  hint?: string;
}) {
  return (
    <div title={hint}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone === "bad" && "text-warning",
          tone === "good" && "text-success",
        )}
      >
        {value}
      </div>
    </div>
  );
}
