"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@platform/ui";
import { Loader2, RefreshCw, Search, ExternalLink, ArrowRight, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { StrategyResult, CurrentStatus } from "@/lib/returnsStrategy";
import { DashboardPastePanel } from "./DashboardPastePanel";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const moneyPrecise = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

type StrategyRow = StrategyResult & {
  countSource?: "dashboard_paste" | "csv_upload" | "sp_api";
};

interface Response {
  ready: boolean;
  status: string;
  reportId: string | null;
  refundsReportId: string | null;
  results: StrategyRow[];
  noPriceSkus: string[];
  windowDays: number;
  uploads?: {
    dashboardPaste: { pastedAt: string; asinCount: number; totalUnits: number } | null;
  };
}

const STATUS_TONE: Record<CurrentStatus, string> = {
  returnless_dominant: "border-info/50 text-info",
  physical_dominant: "border-success/40 text-success",
  mixed_policy: "border-warning/50 text-warning",
  no_returns: "border-border text-muted-foreground",
};

const VERDICT_META: Record<
  StrategyResult["verdict"],
  { label: string; className: string }
> = {
  switch_to_return_required: {
    label: "Switch to return-required",
    className: "bg-success text-success-foreground",
  },
  keep_returnless: { label: "Keep current", className: "bg-info text-info-foreground" },
  marginal: { label: "Marginal", className: "bg-warning text-warning-foreground" },
  insufficient_data: { label: "Not enough data", className: "bg-muted text-muted-foreground" },
};

type FilterKey = "all" | "returnless_dominant" | "physical_dominant" | "mixed_policy" | "switch_only";

export function ReturnsStrategyDashboard() {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<Response | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/returns-strategy", { cache: "no-store" });
      const body = (await res.json()) as Response;
      setData(body);
      if (!body.ready) {
        toast.message("Amazon reports still generating — reload in a minute.");
      } else {
        const savings = body.results
          .filter((r) => r.verdict === "switch_to_return_required")
          .reduce((s, r) => s + r.annualDelta, 0);
        toast.success(
          savings > 0
            ? `${body.results.length} SKUs analysed — ${money(savings)}/yr on the table if you switch the flagged ones.`
            : "Your current returnless setup is close to optimal.",
        );
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const results = data?.results ?? [];
  const filtered = useMemo(
    () =>
      results.filter((r) => {
        if (filter === "switch_only" && r.verdict !== "switch_to_return_required") return false;
        if (
          filter !== "all" &&
          filter !== "switch_only" &&
          r.currentStatus !== filter
        )
          return false;
        if (q && !r.sku.toLowerCase().includes(q.toLowerCase())) return false;
        return true;
      }),
    [results, filter, q],
  );

  // Summary buckets
  const returnlessOnly = results.filter((r) => r.currentStatus === "returnless_dominant");
  const physicalOnly = results.filter((r) => r.currentStatus === "physical_dominant");
  const mixed = results.filter((r) => r.currentStatus === "mixed_policy");

  const totalCurrentCost = results.reduce((s, r) => s + r.currentAnnualCost, 0);
  const totalIfAllPhysical = results.reduce((s, r) => s + r.ifAllPhysicalAnnualCost, 0);
  const totalSavingsIfSwitchAll = totalCurrentCost - totalIfAllPhysical;

  return (
    <div className="space-y-6">
      <DashboardPastePanel onChanged={load} />

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={load} disabled={busy} variant="outline">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Reload
        </Button>
        {data && !data.ready && (
          <span className="text-sm text-warning">Amazon reports still generating — reload in ~1 min.</span>
        )}
        {data && data.noPriceSkus.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {data.noPriceSkus.length} SKU{data.noPriceSkus.length === 1 ? "" : "s"} omitted (no price on file)
          </span>
        )}
      </div>

      {/* Undercount warning when no authoritative source is loaded */}
      {data && results.length > 0 && !data.uploads?.dashboardPaste && (
        <div className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning-light/40 px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            <strong>Numbers below are undercounted.</strong> Without the dashboard paste above, returnless refunds are
            derived from SP-API only — which captures roughly <strong>35%</strong> of your actual returns. Savings
            estimates are floors, not real totals. Paste the dashboard table to fix.
          </span>
        </div>
      )}

      {/* Top strategy summary — big picture */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs uppercase text-muted-foreground">Actual 12-mo refund cost</div>
            <div className="mt-1 text-3xl font-bold text-destructive tabular-nums">
              {money(totalCurrentCost)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              What you're paying today at your current returnless/physical mix
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs uppercase text-muted-foreground">Cost if 100% return-required</div>
            <div className="mt-1 text-3xl font-bold text-warning tabular-nums">
              {money(totalIfAllPhysical)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Hypothetical — every current returnless refund switched to physical return
            </div>
          </CardContent>
        </Card>
        <Card className={cn(totalSavingsIfSwitchAll > 0 ? "border-success/40" : "border-border")}>
          <CardContent className="pt-6">
            <div className="text-xs uppercase text-muted-foreground">Δ if you switched everything</div>
            <div
              className={cn(
                "mt-1 text-3xl font-bold tabular-nums",
                totalSavingsIfSwitchAll > 0 ? "text-success" : "text-muted-foreground",
              )}
            >
              {totalSavingsIfSwitchAll > 0 ? "+" : ""}
              {money(totalSavingsIfSwitchAll)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Blanket switch ceiling. Real recommended switch (verdict = green) below.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2 text-xs">
        {(
          [
            { key: "all", label: "All", n: results.length },
            { key: "returnless_dominant", label: "Returnless-dominant", n: returnlessOnly.length },
            { key: "physical_dominant", label: "Physical-only", n: physicalOnly.length },
            { key: "mixed_policy", label: "Mixed", n: mixed.length },
            {
              key: "switch_only",
              label: "Recommended switch",
              n: results.filter((r) => r.verdict === "switch_to_return_required").length,
            },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={cn(
              "rounded-full border px-3 py-1 transition-colors",
              filter === t.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted",
            )}
          >
            {t.label}
            <span className="ml-1.5 tabular-nums opacity-70">{t.n}</span>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Per-SKU status &amp; strategy comparison</CardTitle>
            <p className="text-sm text-muted-foreground">
              For each SKU: current returnless/physical mix, actual 12-mo cost, cost if every refund used the OTHER
              strategy, and net delta from switching.
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search SKU"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-7 h-8 w-40"
            />
          </div>
        </CardHeader>
        <CardContent>
          {!data ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No SKUs match.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Current status</TableHead>
                    <TableHead className="text-right">Refunds 12mo</TableHead>
                    <TableHead className="text-right">Actual cost / yr</TableHead>
                    <TableHead>If switched →</TableHead>
                    <TableHead className="text-right">New cost / yr</TableHead>
                    <TableHead className="text-right">Δ if switched</TableHead>
                    <TableHead>Verdict</TableHead>
                    <TableHead>Why</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...filtered]
                    .sort((a, b) => b.annualDelta - a.annualDelta)
                    .map((r) => {
                      // If returnless-dominant, the switch alternative = go 100% physical.
                      // If physical-only, the alternative = 100% returnless.
                      const goingPhysical = r.currentStatus !== "physical_dominant";
                      const alternativeCost = goingPhysical
                        ? r.ifAllPhysicalAnnualCost
                        : r.ifAllReturnlessAnnualCost;
                      const delta = r.currentAnnualCost - alternativeCost;
                      const verdictMeta = VERDICT_META[r.verdict];
                      return (
                        <TableRow key={r.sku}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-1.5">
                              {r.sku}
                              {r.price > 75 && (
                                <Badge
                                  variant="outline"
                                  className="border-muted-foreground/40 text-[9px] text-muted-foreground"
                                  title="Amazon's $75 returnless ceiling — this SKU is auto-excluded regardless of settings."
                                >
                                  &gt;$75
                                </Badge>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {moneyPrecise(r.price)} · sellable-back {(r.sellableBackRate * 100).toFixed(0)}%
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[r.currentStatus])}>
                              {r.currentStatusLabel}
                            </Badge>
                            <div className="mt-1 text-[10px] text-muted-foreground">
                              {r.returnlessCount} returnless · {r.physicalReturnCount} physical
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{r.returnsCount}</TableCell>
                          <TableCell className="text-right tabular-nums text-destructive">
                            {money(r.currentAnnualCost)}
                          </TableCell>
                          <TableCell className="text-xs">
                            <span className="inline-flex items-center gap-1">
                              {goingPhysical ? "100% return-required" : "100% returnless"}
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            </span>
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right tabular-nums",
                              alternativeCost < r.currentAnnualCost ? "text-success" : "text-warning",
                            )}
                          >
                            {money(alternativeCost)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right tabular-nums font-semibold",
                              delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground",
                            )}
                          >
                            {delta > 0 ? "+" : ""}
                            {money(delta)}
                          </TableCell>
                          <TableCell>
                            <Badge className={cn("text-[10px]", verdictMeta.className)}>{verdictMeta.label}</Badge>
                          </TableCell>
                          <TableCell className="max-w-[260px]">
                            <span className="text-[11px] text-muted-foreground leading-snug">{r.reason}</span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">How the numbers are calculated · Amazon's returnless eligibility rules</summary>
        <div className="mt-2 space-y-2 pl-4">
          <div className="rounded-md border border-info/30 bg-info-light/40 p-3">
            <p className="font-medium text-foreground">Amazon's actual per-return eligibility (from Seller Central docs):</p>
            <p>A return uses returnless ONLY when ALL apply — evaluated per individual return, not per SKU:</p>
            <ul className="mt-1 list-disc pl-4">
              <li>Item ASP ≤ <strong>$75</strong> (Amazon's hard ceiling — items priced above never use returnless)</li>
              <li>Customer has no history of returnless abuse</li>
              <li>Item isn't in an excluded category (dangerous goods, recalled, gift cards, heavy/bulky, non-returnable)</li>
              <li>Seller is in good standing</li>
            </ul>
            <p className="mt-2 text-[11px]">
              So even with returnless enabled at the account level, most refunds may still be physical — usually because
              the specific CUSTOMER failed Amazon's abuse-history check. Enrollment ≠ every return uses returnless.
              <a
                href="https://sellercentral.amazon.com/help/hub/reference/G3RZC8DVQCDTCQ3B"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 underline"
              >
                Amazon's doc
              </a>
            </p>
          </div>
          <p>
            <strong>Current status</strong> — computed from your actual 12-month refund mix. ≥60% returnless =
            "Returnless-dominant"; ≥60% physical = "Physical-only"; in between = "Mixed policy". Mixed usually means
            some customers passed Amazon's eligibility check and some didn't.
          </p>
          <p>
            <strong>Returnless cost per refund</strong> = full item price (customer keeps it, no recovery).
          </p>
          <p>
            <strong>Physical-return net cost per refund</strong> = return shipping ($4.50–$12 by price) + $2 processing
            − price × your SKU's sellable-back rate − price × (1 − sellable-back rate) × ~30% recovery on unsellables.
            Often negative (net gain) for higher-value items.
          </p>
          <p>
            <strong>Actual annual cost</strong> = returnless_count × price + physical_count × physical_net_cost.
          </p>
          <p>
            <strong>New cost if switched</strong> = the OPPOSITE pure strategy applied to all refunds. If you excluded
            this SKU via Seller Central&apos;s returnless settings (price threshold OR CSV exclusion list), Amazon would
            force 100% physical for it going forward.
          </p>
          <p>
            <strong>Δ if switched</strong> = actual − new cost. Positive = money saved by switching.
          </p>
        </div>
      </details>
    </div>
  );
}
