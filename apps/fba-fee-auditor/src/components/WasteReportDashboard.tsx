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
import { Loader2, RefreshCw, ExternalLink, TrendingDown, AlertTriangle, Search, DollarSign } from "lucide-react";
import { toast } from "sonner";
import type { WasteReport, WasteAction, WasteCategory } from "@/lib/wasteReport";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const moneyPrecise = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const CATEGORY_TONE: Record<WasteCategory, string> = {
  fee_overcharge: "border-success/40 text-success",
  reimbursable_damage: "border-success/40 text-success",
  stranded: "border-warning/50 text-warning",
  unfulfillable_loss: "border-warning/50 text-warning",
  ltsf_active: "border-destructive/50 text-destructive",
  ltsf_risk: "border-warning/50 text-warning",
  excess_inventory: "border-info/50 text-info",
  returnless_overspend: "border-destructive/50 text-destructive",
};

export function WasteReportDashboard() {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<WasteReport | null>(null);
  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<WasteCategory | "all">("all");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/waste-report", { cache: "no-store" });
      const body = (await res.json()) as WasteReport;
      setReport(body);
      const total = body.totalRecoverableUsd + body.totalMonthlyBleedUsd * 12;
      toast.success(`Total leak: ${money(total)}/yr across ${body.actions.length} actions.`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!report) return [];
    return report.actions.filter((a) => {
      if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
      if (q && !`${a.sku} ${a.categoryLabel} ${a.detail ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [report, q, categoryFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={load} disabled={busy} variant="outline">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Reload
        </Button>
        {report && (
          <span className="text-xs text-muted-foreground">
            Generated {new Date(report.generatedAt).toLocaleString()}
          </span>
        )}
      </div>

      {report && <TopSummary report={report} />}
      {report && <SourceHealthBanner report={report} />}
      {report && <CategoryGrid report={report} onPick={(c) => setCategoryFilter(c)} active={categoryFilter} />}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Top actions</CardTitle>
            <p className="text-sm text-muted-foreground">
              Every waste item across all categories, ranked by 12-month $ impact. Filter by category or search.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {categoryFilter !== "all" && (
              <Button size="sm" variant="ghost" onClick={() => setCategoryFilter("all")}>
                Clear filter
              </Button>
            )}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search SKU or reason"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-7 h-8 w-56"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!report ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {categoryFilter === "all" && !q ? "No waste detected. 🎉" : "No actions match this filter."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="text-right">Recoverable now</TableHead>
                    <TableHead className="text-right">Monthly bleed</TableHead>
                    <TableHead className="text-right">12-mo impact</TableHead>
                    <TableHead>Deadline</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((a, i) => (
                    <TableRow key={`${a.sku}-${a.category}-${i}`}>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                      <TableCell className="font-medium">{a.sku}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[10px]", CATEGORY_TONE[a.category])}>
                          {a.categoryLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[280px]">
                        <div className="text-sm">{a.action}</div>
                        {a.detail && (
                          <div className="text-[11px] text-muted-foreground line-clamp-2">{a.detail}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.recoverableUsd > 0 ? (
                          <span className="text-success font-semibold">{moneyPrecise(a.recoverableUsd)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.monthlyBleedUsd > 0 ? (
                          <span className="text-destructive">{moneyPrecise(a.monthlyBleedUsd)}/mo</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {money(a.annualImpactUsd)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{a.deadline ?? "—"}</TableCell>
                      <TableCell>
                        {a.href && (
                          <a
                            href={a.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline whitespace-nowrap"
                          >
                            Act
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TopSummary({ report }: { report: WasteReport }) {
  const totalAnnual = report.totalRecoverableUsd + report.totalMonthlyBleedUsd * 12;
  return (
    <Card className="border-destructive/40">
      <CardContent className="pt-6">
        <div className="flex flex-wrap items-baseline gap-6">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Total 12-mo impact</div>
            <div className="text-4xl font-bold text-destructive tabular-nums">{money(totalAnnual)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Recoverable now</div>
            <div className="text-2xl font-semibold text-success tabular-nums">
              {money(report.totalRecoverableUsd)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Ongoing bleed</div>
            <div className="text-2xl font-semibold text-warning tabular-nums">
              {moneyPrecise(report.totalMonthlyBleedUsd)}/mo
            </div>
          </div>
          <div className="ml-auto text-right text-xs text-muted-foreground">
            {report.actions.length} actions across {report.categories.length} categories
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CategoryGrid({
  report,
  onPick,
  active,
}: {
  report: WasteReport;
  onPick: (c: WasteCategory) => void;
  active: WasteCategory | "all";
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {report.categories.map((c) => {
        const isActive = active === c.category;
        return (
          <button
            key={c.category}
            onClick={() => onPick(c.category)}
            className={cn(
              "rounded-lg border p-4 text-left transition-colors",
              isActive ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <Badge variant="outline" className={cn("text-[10px]", CATEGORY_TONE[c.category])}>
                {c.label}
              </Badge>
              <span className="text-[10px] text-muted-foreground">{c.itemCount} SKU{c.itemCount === 1 ? "" : "s"}</span>
            </div>
            <div className="mt-3 space-y-1">
              {c.recoverableUsd > 0 && (
                <div className="flex items-center gap-1 text-sm">
                  <DollarSign className="h-3.5 w-3.5 text-success" />
                  <span className="font-semibold text-success">{money(c.recoverableUsd)}</span>
                  <span className="text-[10px] text-muted-foreground">recoverable</span>
                </div>
              )}
              {c.monthlyBleedUsd > 0 && (
                <div className="flex items-center gap-1 text-sm">
                  <TrendingDown className="h-3.5 w-3.5 text-destructive" />
                  <span className="font-semibold text-destructive">{moneyPrecise(c.monthlyBleedUsd)}</span>
                  <span className="text-[10px] text-muted-foreground">/mo bleed</span>
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function SourceHealthBanner({ report }: { report: WasteReport }) {
  const missing: string[] = [];
  if (!report.sources.audit.ready) missing.push("fee audit");
  if (!report.sources.inventory.ready) missing.push("inventory");
  if (!report.sources.returns.ready) missing.push("returns / refunds");
  if (missing.length === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-light/40 px-3 py-2 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <span>
        Some data sources still generating: <strong>{missing.join(", ")}</strong>. Numbers below are partial — reload
        in a few minutes for the full picture.
      </span>
    </div>
  );
}
