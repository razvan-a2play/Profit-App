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
import {
  Loader2, RefreshCw, Search, AlertTriangle, DollarSign,
  ChevronDown, ChevronRight, Trash2, Info, Presentation,
} from "lucide-react";
import { toast } from "sonner";
import { refundAdminFee, type Decision, type Verdict } from "@/lib/returnsDecision";
import { DashboardPastePanel } from "./DashboardPastePanel";
import { CogsPanel } from "./CogsPanel";
import { ReturnRateSimulator } from "./ReturnRateSimulator";
import { ReturnsPresentation } from "./ReturnsPresentation";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const money2 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

interface Resp {
  ready: boolean;
  hasDashboardPaste: boolean;
  cogs: { count: number; defaultRatioOfPrice: number | null; updatedAt: string };
  feeCategory: string;
  threshold: number;
  totals: {
    skus: number; skusWithCogs: number; switchCount: number; switchAnnual: number;
    totalRefunds: number; totalReturnless: number;
    annualUnrecoverableFees: number; currentAnnualCost: number;
    costedRevenue: number; feeRiskSkus: number; avgCostPerRefund: number;
  };
  decisions: Decision[];
  skipped: { sku: string; why: string }[];
  totalAnnualRevenue?: number;
  returnsCsv: { windowStart: string | null; windowEnd: string | null } | null;
}

const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  switch_to_return_required: { label: "Switch to return-required", cls: "bg-success text-success-foreground" },
  keep_returnless: { label: "Keep returnless", cls: "bg-info text-info-foreground" },
  marginal: { label: "Marginal", cls: "bg-warning text-warning-foreground" },
  insufficient_data: { label: "Not enough data", cls: "bg-muted text-muted-foreground" },
  no_cogs: { label: "Need COGS", cls: "bg-destructive text-destructive-foreground" },
};

export function ReturnsDecisionDashboard() {
  const [data, setData] = useState<Resp | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Verdict | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  // Pareto cut: only show the SKUs that make up this share of revenue.
  const [revenueCut, setRevenueCut] = useState<number>(90);
  // Executive view: same numbers, every input panel and control hidden.
  const [present, setPresent] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/returns-decision", { cache: "no-store" });
      const b = (await r.json()) as Resp;
      setData(b);
      if (b.totals.switchCount > 0) {
        toast.success(`${b.totals.switchCount} SKUs worth switching — ${money(b.totals.switchAnnual)}/yr.`);
      } else if (b.cogs.count === 0 && !b.cogs.defaultRatioOfPrice) {
        toast.message("Add landed COGS below to get decisions.");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    const d = data?.decisions ?? [];
    const cut = revenueCut / 100;
    return d.filter((x) => {
      if (filter !== "all" && x.verdict !== filter) return false;
      if (q && !x.sku.toLowerCase().includes(q.toLowerCase())) return false;
      // Pareto: keep SKUs whose cumulative revenue share is within the cut.
      // SKUs with no revenue estimate are only shown at 100%.
      if (revenueCut < 100) {
        if (x.cumulativeRevenueShare == null) return false;
        if (x.cumulativeRevenueShare > cut) return false;
      }
      return true;
    });
  }, [data, q, filter, revenueCut]);

  // What the current cut actually covers.
  const paretoStats = useMemo(() => {
    const d = data?.decisions ?? [];
    const cut = revenueCut / 100;
    const inCut = d.filter(
      (x) => revenueCut >= 100 || (x.cumulativeRevenueShare != null && x.cumulativeRevenueShare <= cut),
    );
    const rev = inCut.reduce((s2, x) => s2 + (x.annualRevenue ?? 0), 0);
    const delta = inCut
      .filter((x) => x.verdict === "switch_to_return_required")
      .reduce((s2, x) => s2 + x.annualDelta, 0);
    const totalDelta = d
      .filter((x) => x.verdict === "switch_to_return_required")
      .reduce((s2, x) => s2 + x.annualDelta, 0);
    return { count: inCut.length, total: d.length, revenue: rev, delta, totalDelta };
  }, [data, revenueCut]);

  const t = data?.totals;

  if (present && data) {
    return (
      <ReturnsPresentation
        decisions={data.decisions}
        threshold={data.threshold}
        feeCategory={data.feeCategory}
        windowLabel={data.returnsCsv?.windowStart && data.returnsCsv?.windowEnd
          ? `${data.returnsCsv.windowStart} to ${data.returnsCsv.windowEnd}`
          : null}
        onExit={() => setPresent(false)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <ReturnsCsvPanel onChanged={load} />
      <CogsPanel onChanged={load} />
      <DashboardPastePanel onChanged={load} />

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={load} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Recalculate
        </Button>
        <Button onClick={() => setPresent(true)} disabled={!data}>
          <Presentation className="mr-2 h-4 w-4" />
          Presentation view
        </Button>
        {data && !data.hasDashboardPaste && (
          <span className="inline-flex items-center gap-1 text-sm text-warning">
            <AlertTriangle className="h-4 w-4" />
            No dashboard paste — returnless counts are missing, so deltas are floors.
          </span>
        )}
      </div>

      {t && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Returns cost"
              value={money(t.currentAnnualCost)}
              sub={
                t.costedRevenue > 0
                  ? `${((t.currentAnnualCost / t.costedRevenue) * 100).toFixed(2)}% of ${money(t.costedRevenue)} revenue`
                  : "fees + lost COGS at today's mix"
              }
              tone="text-destructive"
            />
            <Stat
              label="Prevention prize"
              value={money(t.avgCostPerRefund * t.totalRefunds * 0.1)}
              sub={`per 10% fewer returns · ${money2(t.avgCostPerRefund)} each`}
              tone="text-warning"
            />
            <Stat
              label="Worth switching"
              value={money(t.switchAnnual)}
              sub={`${t.switchCount} SKUs off returnless`}
              tone="text-success"
            />
            <Stat
              label="Fee-threshold risk"
              value={`${t.feeRiskSkus} SKU${t.feeRiskSkus === 1 ? "" : "s"}`}
              sub={`would exceed ${(data!.threshold * 100).toFixed(1)}% if switched`}
              tone={t.feeRiskSkus > 0 ? "text-warning" : "text-muted-foreground"}
            />
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            {t.totalReturnless.toLocaleString()} of {t.totalRefunds.toLocaleString()} refunds are returnless
            {" · "}
            <strong className="text-foreground">{money(t.annualUnrecoverableFees)}</strong> (
            {t.currentAnnualCost > 0
              ? Math.round((t.annualUnrecoverableFees / t.currentAnnualCost) * 100)
              : 0}
            %) is FBA fee + refund admin — lost whichever policy you pick, so only fewer returns touches it
          </p>
        </>
      )}

      {data && <ReturnRateSimulator decisions={data.decisions} />}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-4">
          <div className="min-w-[220px] flex-1">
            <div className="flex items-baseline justify-between">
              <label className="text-sm font-medium">Focus on top revenue SKUs</label>
              <span className="text-sm font-semibold tabular-nums">{revenueCut}%</span>
            </div>
            <input
              type="range" min={10} max={100} step={5}
              value={revenueCut}
              onChange={(e) => setRevenueCut(Number(e.target.value))}
              className="mt-2 w-full accent-[hsl(var(--primary))]"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            Showing <strong className="text-foreground">{paretoStats.count}</strong> of {paretoStats.total} SKUs
            {" "}&middot; {money(paretoStats.revenue)} revenue
            {paretoStats.totalDelta > 0 && (
              <> &middot; captures <strong className="text-success">{money(paretoStats.delta)}</strong> of{" "}
              {money(paretoStats.totalDelta)} opportunity</>
            )}
          </div>
          <div className="flex gap-1">
            {[50, 80, 90, 100].map((p) => (
              <button key={p} onClick={() => setRevenueCut(p)}
                className={cn("rounded border px-2 py-1 text-xs",
                  revenueCut === p ? "border-primary bg-primary text-primary-foreground"
                                   : "border-border hover:bg-muted")}>
                {p === 100 ? "All" : `${p}%`}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 text-xs">
        {([
          ["all", "All"],
          ["switch_to_return_required", "Switch"],
          ["keep_returnless", "Keep returnless"],
          ["marginal", "Marginal"],
          ["no_cogs", "Need COGS"],
          ["insufficient_data", "No data"],
        ] as [Verdict | "all", string][]).map(([k, label]) => {
          const n = k === "all" ? data?.decisions.length ?? 0 : (data?.decisions.filter((d) => d.verdict === k).length ?? 0);
          return (
            <button key={k} onClick={() => setFilter(k)}
              className={cn("rounded-full border px-3 py-1 transition-colors",
                filter === k ? "border-primary bg-primary text-primary-foreground"
                             : "border-border bg-background text-muted-foreground hover:bg-muted")}>
              {label}<span className="ml-1.5 tabular-nums opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Per-SKU decision</CardTitle>
            <p className="text-sm text-muted-foreground">
              Every fee is paid whether the customer ships it back or keeps it. The only difference is whether you
              get the unit back — so the delta is <code className="rounded bg-muted px-1">sellable% × COGS</code> minus
              any new returns-processing fee. Click a row for the full math.
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU" className="h-8 w-40 pl-7" />
          </div>
        </CardHeader>
        <CardContent>
          {!data ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          : rows.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No SKUs match.</p>
          : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-6"></TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Revenue / yr</TableHead>
                    <TableHead className="text-right">Refunds</TableHead>
                    <TableHead className="text-right">Returnless</TableHead>
                    <TableHead className="text-right">Sellable</TableHead>
                    <TableHead className="text-right">COGS</TableHead>
                    <TableHead className="text-right">Save / refund</TableHead>
                    <TableHead className="text-right">Δ / year</TableHead>
                    <TableHead>Decision</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((d) => {
                    const open = expanded === d.sku;
                    return (
                      <>
                        <TableRow key={d.sku} className="cursor-pointer" onClick={() => setExpanded(open ? null : d.sku)}>
                          <TableCell>{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                          <TableCell className="font-medium">
                            {d.sku}
                            {d.breachesThresholdIfSwitched && (
                              <Badge variant="outline" className="ml-1.5 border-warning/50 text-[9px] text-warning">
                                fee risk
                              </Badge>
                            )}
                            <div className="text-[10px] text-muted-foreground">{money2(d.price)}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {d.annualRevenue != null ? money(d.annualRevenue) : "—"}
                            {d.cumulativeRevenueShare != null && (
                              <div className="text-[10px] text-muted-foreground">
                                top {(d.cumulativeRevenueShare * 100).toFixed(0)}%
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{d.totalRefunds.toLocaleString()}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {d.returnlessRefunds.toLocaleString()}
                            <div className="text-[10px] text-muted-foreground">{d.returnlessSharePct.toFixed(0)}%</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{(d.sellableRate * 100).toFixed(0)}%</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {d.cogs == null ? "—" : money2(d.cogs)}
                            {d.cogsSource === "ratio" && <div className="text-[10px] text-muted-foreground">est.</div>}
                          </TableCell>
                          <TableCell className={cn("text-right tabular-nums", d.savingsPerRefund > 0 ? "text-success" : "text-muted-foreground")}>
                            {d.cogs == null ? "—" : money2(d.savingsPerRefund)}
                          </TableCell>
                          <TableCell className={cn("text-right font-semibold tabular-nums", d.annualDelta > 0 ? "text-success" : "text-muted-foreground")}>
                            {d.cogs == null ? "—" : money(d.annualDelta)}
                          </TableCell>
                          <TableCell><Badge className={cn("text-[10px]", VERDICT[d.verdict].cls)}>{VERDICT[d.verdict].label}</Badge></TableCell>
                        </TableRow>
                        {open && (
                          <TableRow key={d.sku + "-x"}>
                            <TableCell colSpan={10} className="bg-muted/30">
                              <RowMath d={d} />
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {data && data.skipped.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{data.skipped.length} SKUs skipped</summary>
          <ul className="mt-2 space-y-0.5 pl-4">
            {data.skipped.slice(0, 40).map((s) => <li key={s.sku}>{s.sku} — {s.why}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function RowMath({ d }: { d: Decision }) {
  if (d.cogs == null) return <p className="py-2 text-sm">{d.reason}</p>;
  const fba = d.lifecycle?.fbaFee ?? Math.max(0, d.unrecoverableFeePerRefund - refundAdminFee(d.lifecycle?.referralFee ?? 0));
  const admin = Math.max(0, d.unrecoverableFeePerRefund - fba);
  const recovered = d.sellableRate * d.cogs;
  const sellableUnits = Math.round(d.sellableRate * d.physicalRefunds);
  const line = (label: string, a: string, b: string) => (
    <tr><td className="py-0.5 pr-4">{label}</td><td className="py-0.5 pr-6 text-right tabular-nums">{a}</td><td className="py-0.5 text-right tabular-nums">{b}</td></tr>
  );
  return (
    <div className="grid gap-4 py-3 md:grid-cols-2">
      <div>
        <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Cost of one refund</div>
        <table className="text-xs">
          <thead><tr><th></th><th className="pr-6 text-right">Returnless</th><th className="text-right">Physical</th></tr></thead>
          <tbody>
            <tr className="text-muted-foreground">
              <td className="py-0.5 pr-4">Sale and refund cancel out</td>
              <td className="py-0.5 pr-6 text-right tabular-nums">$0</td>
              <td className="py-0.5 text-right tabular-nums">$0</td>
            </tr>
            <tr className="text-muted-foreground">
              <td className="py-0.5 pr-4 pl-3">
                &#8627; {money2(d.price)} refunded, {money2(d.price)} already banked
              </td>
              <td colSpan={2}></td>
            </tr>
            <tr className="text-muted-foreground">
              <td className="py-0.5 pr-4">Referral fee paid, then credited back</td>
              <td className="py-0.5 pr-6 text-right tabular-nums">$0</td>
              <td className="py-0.5 text-right tabular-nums">$0</td>
            </tr>
            {line("Refund admin fee", `−${money2(admin)}`, `−${money2(admin)}`)}
            {line("FBA fee (never refunded)", `−${money2(fba)}`, `−${money2(fba)}`)}
            {line("Return shipping", "$0", "$0")}
            {line(
              "Returns-processing fee",
              "$0 (exempt)",
              d.returnsFeePerRefundIfSwitched > 0
                ? `−${money2(d.returnsFeePerRefundIfSwitched)}`
                : "$0 (under threshold)",
            )}
            {line("Unit written off at COGS", `−${money2(d.cogs)}`, `−${money2(d.cogs)}`)}
            <tr className="text-success">
              <td className="py-0.5 pr-4">
                Unit comes back and is resellable
                <span className="ml-1 text-muted-foreground">
                  ({(d.sellableRate * 100).toFixed(1)}% &times; {money2(d.cogs)})
                </span>
              </td>
              <td className="py-0.5 pr-6 text-right tabular-nums">&mdash;</td>
              <td className="py-0.5 text-right tabular-nums">+{money2(recovered)}</td>
            </tr>
            <tr className="border-t border-border font-semibold">
              <td className="py-1 pr-4">Net cost</td>
              <td className="py-1 pr-6 text-right tabular-nums">&#8722;{money2(d.returnlessCostPerRefund)}</td>
              <td className="py-1 text-right tabular-nums">&#8722;{money2(d.physicalCostPerRefund)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs">
          Difference <strong className="text-success">{money2(d.savingsPerRefund)}</strong> per refund
          {" "}= {(d.sellableRate * 100).toFixed(1)}% sellable &times; {money2(d.cogs)} COGS
          {d.extraFeeIfSwitched > 0 && " − returns-processing fee"}
        </p>
        <p className="mt-1.5 rounded border border-border bg-muted/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Where the {money2(recovered)} comes from — the unit itself.</strong>{" "}
          When the customer keeps it, that unit is gone. The next customer who orders gets a brand-new one you
          paid {money2(d.cogs)} to manufacture and ship into FBA. When it comes back graded SELLABLE, that same
          unit goes back on the shelf and serves the next customer instead — so you never buy the
          replacement. Last year {sellableUnits.toLocaleString()} of {d.physicalRefunds.toLocaleString()}{" "}
          physical returns came back sellable: {sellableUnits.toLocaleString()} units you did not have to buy,
          or {money(sellableUnits * d.cogs)} of inventory. Spread across all{" "}
          {d.physicalRefunds.toLocaleString()} returns, {money2(recovered)} each.
          {d.cogsSource === "ratio" && " COGS here is estimated from price — add real landed cost to firm this up."}
        </p>
      </div>
      <div className="space-y-2 text-xs">
        <div>
          <div className="mb-1 font-medium uppercase text-muted-foreground">Annual</div>
          <div>Current mix: <strong>{money(d.currentAnnualCost)}</strong></div>
          <div>If 100% return-required: <strong>{money(d.ifAllPhysicalAnnualCost)}</strong></div>
          <div className="text-success">Delta: <strong>{money(d.annualDelta)}</strong> ({d.returnlessRefunds.toLocaleString()} returnless × {money2(d.savingsPerRefund)})</div>
        </div>
        <div>
          <div className="mb-1 font-medium uppercase text-muted-foreground">Fee threshold</div>
          <div>
            Rate if 100% physical:{" "}
            <strong className={d.breachesThresholdIfSwitched ? "text-warning" : "text-success"}>
              {d.rateIfAllPhysical == null ? "unknown" : `${(d.rateIfAllPhysical * 100).toFixed(2)}%`}
            </strong>{" "}
            vs {(d.threshold * 100).toFixed(1)}% threshold
            {d.breachesThresholdIfSwitched ? ` — would cost ${money(d.extraFeeIfSwitched)}/yr` : " — safe"}
            {d.feeExposure && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                Free allowance {Math.round(d.threshold * d.feeExposure.unitsShipped).toLocaleString()} returns
                ({d.threshold * 100}% of {d.feeExposure.unitsShipped.toLocaleString()} shipped) ·
                charged today {d.feeExposure.chargedUnitsNow.toLocaleString()} ·
                if switched {d.feeExposure.chargedUnitsIfAllPhysical.toLocaleString()}
              </div>
            )}
          </div>
        </div>
        <div>
          <div className="mb-1 font-medium uppercase text-muted-foreground">Context</div>
          <div>Profit per sale: <strong>{money2(d.profitPerSale)}</strong></div>
          <div>A returnless refund wipes out <strong>{d.salesLostPerReturnlessRefund.toFixed(2)} sales</strong></div>
        </div>
        <p className="rounded border border-border bg-background p-2">{d.reason}</p>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <DollarSign className={cn("h-4 w-4", tone)} />
        </div>
        <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function ReturnsCsvPanel({ onChanged }: { onChanged: () => void }) {
  const [s, setS] = useState<{
    present: boolean; filename?: string; windowStart?: string; windowEnd?: string;
    usRows?: number; canadaRows?: number; skuCount?: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/uploads/returns-csv");
    setS(await r.json());
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/uploads/returns-csv", { method: "POST", body: fd });
      const b = await r.json();
      if (b.error) throw new Error(b.error);
      toast.success(`Parsed ${b.usRows.toLocaleString()} US returns across ${b.skuCount} SKUs (${b.canadaRows} Canada rows excluded).`);
      await refresh(); onChanged();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const clear = async () => {
    await fetch("/api/uploads/returns-csv", { method: "DELETE" });
    toast.success("Returns CSV cleared."); await refresh(); onChanged();
  };

  return (
    <Card className={s?.present ? "border-success/40" : "border-warning/50"}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Step 0 — FBA Customer Returns CSV</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Gives exact physical-return counts and per-SKU sellable-back rates. Canada FCs (
              <code className="rounded bg-muted px-1">Y*</code>) are dropped automatically so it matches the
              US-filtered dashboard.
            </p>
          </div>
          <Badge className={s?.present ? "bg-success text-success-foreground" : "bg-warning text-warning-foreground"}>
            {s?.present ? `${s.skuCount} SKUs` : "Not uploaded"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {s?.present && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-success/30 bg-success-light/30 p-3 text-sm">
            <div>
              <div className="font-medium">{s.filename}</div>
              <div className="text-xs text-muted-foreground">
                {s.windowStart} → {s.windowEnd} · {s.usRows?.toLocaleString()} US rows ·{" "}
                {s.canadaRows?.toLocaleString()} Canada excluded
              </div>
            </div>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={clear}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        )}
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) void upload(f); }}
          className={cn("flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed p-6 text-center transition-colors",
            drag ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/40")}
        >
          <input type="file" accept=".csv,.txt,.tsv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          {busy ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : null}
          <span className="text-sm font-medium">{busy ? "Parsing…" : "Drop the CSV here, or click to choose"}</span>
          <span className="mt-1 text-xs text-muted-foreground">
            Seller Central → Reports → Fulfillment → Customer Returns → set 365 days → Download
          </span>
        </label>
      </CardContent>
    </Card>
  );
}

