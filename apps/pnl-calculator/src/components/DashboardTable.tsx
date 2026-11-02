"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Input, useToast } from "@platform/ui";
import { loadDashboardRows, type DashboardRow, type VersionStatus } from "@/lib/dashboard-data";
import { computeMetrics } from "@/lib/dashboard-calc";

interface Overrides {
  [sku: string]: { desiredPrice?: number; tacosPercent?: number };
}

type StatusFilter = "all" | "live" | "withVersion" | "none";

export default function DashboardTable() {
  const { toast } = useToast();
  const [rows, setRows] = useState<DashboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("withVersion");

  useEffect(() => {
    let cancelled = false;
    loadDashboardRows()
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message ?? String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    if (!rows) return { all: 0, live: 0, rd: 0, none: 0 };
    return rows.reduce(
      (acc, r) => {
        acc.all++;
        acc[r.versionStatus]++;
        return acc;
      },
      { all: 0, live: 0, rd: 0, "h10-only": 0, none: 0 },
    );
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    let r = rows;
    if (statusFilter === "live") r = r.filter((x) => x.versionStatus === "live");
    else if (statusFilter === "withVersion") r = r.filter((x) => x.versionStatus !== "none");
    else if (statusFilter === "none") r = r.filter((x) => x.versionStatus === "none");

    const q = search.trim().toLowerCase();
    if (q) {
      r = r.filter((x) => `${x.sku} ${x.asin ?? ""} ${x.productName}`.toLowerCase().includes(q));
    }
    return r;
  }, [rows, search, statusFilter]);

  const getDesiredPrice = (r: DashboardRow): number =>
    overrides[r.sku]?.desiredPrice ?? Number(r.versionData?.sellingPrice ?? 0);
  const getTacosPercent = (r: DashboardRow): number =>
    overrides[r.sku]?.tacosPercent ?? Number(r.versionData?.marketingTacosPercentage ?? 0);

  const setOverride = (
    sku: string,
    patch: Partial<{ desiredPrice: number; tacosPercent: number }>,
  ) => {
    setOverrides((prev) => ({ ...prev, [sku]: { ...prev[sku], ...patch } }));
  };

  const resetOverrides = () => {
    setOverrides({});
    toast({ title: "Reset", description: "All price / TACOS edits reverted." });
  };

  if (error) {
    return (
      <div className="p-8">
        <p className="text-destructive">Failed to load dashboard: {error}</p>
      </div>
    );
  }
  if (!rows) {
    return <div className="p-8 text-muted-foreground">Loading SKUs…</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">
          No SKUs found. Add rows to <code>Product Information</code> or save a version in the
          calculator.
        </p>
      </div>
    );
  }

  const editedCount = Object.keys(overrides).length;

  return (
    <div className="w-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Input
          placeholder="Search SKU, ASIN, or product name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        <div className="flex gap-1 border rounded-md p-0.5 bg-muted/40 text-xs">
          <FilterButton
            active={statusFilter === "withVersion"}
            onClick={() => setStatusFilter("withVersion")}
          >
            Has data ({counts.live + counts.rd + counts["h10-only"]})
          </FilterButton>
          <FilterButton active={statusFilter === "live"} onClick={() => setStatusFilter("live")}>
            Live only ({counts.live})
          </FilterButton>
          <FilterButton active={statusFilter === "none"} onClick={() => setStatusFilter("none")}>
            Not costed ({counts.none})
          </FilterButton>
          <FilterButton active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
            All ({counts.all})
          </FilterButton>
        </div>
        <div className="text-sm text-muted-foreground">
          {filteredRows?.length ?? 0} shown
          {editedCount > 0 && (
            <>
              {" · "}
              <span className="text-warning font-medium">{editedCount} edited (local only)</span>
            </>
          )}
        </div>
        <div className="ml-auto flex gap-2">
          {editedCount > 0 && (
            <Button variant="outline" size="sm" onClick={resetOverrides}>
              Reset edits
            </Button>
          )}
          <Link href="/">
            <Button variant="outline" size="sm">Back to calculator</Button>
          </Link>
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto bg-card shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-primary text-primary-foreground sticky top-0 z-10">
            <tr>
              <Th className="text-left w-10">#</Th>
              <Th className="text-left min-w-[220px]">Product Name</Th>
              <Th className="text-left">ASIN</Th>
              <Th className="text-left">SKU</Th>
              <Th>Status</Th>
              <Th className="text-left">Country</Th>
              <Th>Desired price</Th>
              <Th>COGS<br/><span className="font-normal normal-case opacity-70">app</span></Th>
              <Th>COGS<br/><span className="font-normal normal-case opacity-70">Helium10</span></Th>
              <Th>Δ COGS</Th>
              <Th>Referral</Th>
              <Th>FBA fee</Th>
              <Th>Ship&nbsp;+&nbsp;Storage</Th>
              <Th>MAX TACOS %</Th>
              <Th>TACOS $</Th>
              <Th>Total Costs</Th>
              <Th>Net Profit</Th>
              <Th>Margin %</Th>
            </tr>
          </thead>
          <tbody>
            {filteredRows!.map((row, idx) => {
              const edited = overrides[row.sku];
              const hasData = row.versionData !== null;
              const desiredPrice = getDesiredPrice(row);
              const tacosPercent = getTacosPercent(row);
              const m = hasData
                ? computeMetrics(row.versionData!, desiredPrice, tacosPercent)
                : null;
              const marginBand =
                !m ? "none" : m.netProfitPercent >= 25 ? "good" : m.netProfitPercent >= 15 ? "ok" : "bad";

              return (
                <tr
                  key={row.sku}
                  className={`border-t hover:bg-muted/40 ${edited ? "bg-warning-light/30" : ""} ${
                    !hasData ? "opacity-70" : ""
                  }`}
                >
                  <Td className="text-muted-foreground">{idx + 1}</Td>
                  <Td className="max-w-[280px]">
                    <div className="font-medium truncate" title={row.productName}>
                      {row.productName}
                    </div>
                    {row.supplier && (
                      <div
                        className="text-xs text-muted-foreground truncate"
                        title={row.supplier}
                      >
                        {row.supplier}
                      </div>
                    )}
                  </Td>
                  <Td className="font-mono text-xs">{row.asin ?? "—"}</Td>
                  <Td className="font-mono text-xs">{row.sku}</Td>
                  <Td>
                    <StatusBadge status={row.versionStatus} />
                  </Td>
                  <Td>US</Td>
                  <Td>
                    {hasData ? (
                      <Input
                        type="number"
                        step="0.01"
                        value={desiredPrice}
                        onChange={(e) =>
                          setOverride(row.sku, { desiredPrice: parseFloat(e.target.value) || 0 })
                        }
                        className="h-8 w-24 text-right font-mono"
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Td>
                  <Td className="text-right font-mono">{m ? fmt$(m.cogs) : "—"}</Td>
                  <Td
                    className="text-right font-mono"
                    title={
                      row.helium10?.fetchedAt
                        ? `Helium10 — fetched ${new Date(row.helium10.fetchedAt).toLocaleDateString()}`
                        : undefined
                    }
                  >
                    {row.helium10?.totalCogs != null ? fmt$(row.helium10.totalCogs) : "—"}
                  </Td>
                  <Td
                    className={`text-right font-mono text-xs ${deltaColor(m?.cogs, row.helium10?.totalCogs ?? null)}`}
                  >
                    {deltaLabel(m?.cogs, row.helium10?.totalCogs ?? null)}
                  </Td>
                  <Td className="text-right font-mono">{m ? fmt$(m.referralFee) : "—"}</Td>
                  <Td className="text-right font-mono">{m ? fmt$(m.fbaFee) : "—"}</Td>
                  <Td className="text-right font-mono">{m ? fmt$(m.shippingStorage) : "—"}</Td>
                  <Td>
                    {hasData ? (
                      <Input
                        type="number"
                        step="0.1"
                        value={tacosPercent}
                        onChange={(e) =>
                          setOverride(row.sku, { tacosPercent: parseFloat(e.target.value) || 0 })
                        }
                        className="h-8 w-20 text-right font-mono"
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Td>
                  <Td className="text-right font-mono">{m ? fmt$(m.tacosDollar) : "—"}</Td>
                  <Td className="text-right font-mono">{m ? fmt$(m.totalCosts) : "—"}</Td>
                  <Td
                    className={`text-right font-mono font-semibold ${
                      marginBand === "good"
                        ? "text-success"
                        : marginBand === "ok"
                        ? "text-warning"
                        : marginBand === "bad"
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }`}
                  >
                    {m ? fmt$(m.netProfit) : "—"}
                  </Td>
                  <Td
                    className={`text-right font-mono font-semibold ${
                      marginBand === "good"
                        ? "text-success"
                        : marginBand === "ok"
                        ? "text-warning"
                        : marginBand === "bad"
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }`}
                  >
                    {m ? `${m.netProfitPercent.toFixed(1)}%` : "—"}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Dashboard edits are a <strong>local what-if</strong> — they never touch saved snapshots.
        Status: <StatusBadge status="live" inline /> uses the latest live snapshot ·{" "}
        <StatusBadge status="rd" inline /> no live yet, R&amp;D plan shown ·{" "}
        <StatusBadge status="h10-only" inline /> no app version; row synthesised from Helium10 COGS + Product Information dimensions + default fees — type a desired price to see margin ·{" "}
        <StatusBadge status="none" inline /> no cost data anywhere yet.
        Margin colour: <span className="text-success">≥25%</span> ·{" "}
        <span className="text-warning">15–25%</span> ·{" "}
        <span className="text-destructive">&lt;15%</span>
      </p>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide whitespace-nowrap ${className}`}
    >
      {children}
    </th>
  );
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-middle whitespace-nowrap ${className}`}>{children}</td>;
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-sm transition-colors ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status, inline = false }: { status: VersionStatus; inline?: boolean }) {
  const cfg: Record<
    VersionStatus,
    { label: string; cls: string }
  > = {
    live: { label: "LIVE", cls: "bg-success/15 text-success border-success/30" },
    rd: { label: "R&D", cls: "bg-info/15 text-info border-info/30" },
    "h10-only": {
      label: "H10 ONLY",
      cls: "bg-warning/15 text-warning border-warning/30",
    },
    none: {
      label: "NOT COSTED",
      cls: "bg-muted text-muted-foreground border-border",
    },
  };
  const c = cfg[status];
  const size = inline ? "text-[10px] px-1.5 py-0" : "text-[11px] px-1.5 py-0.5";
  return (
    <span
      className={`inline-flex items-center font-semibold uppercase tracking-wide rounded border ${c.cls} ${size}`}
    >
      {c.label}
    </span>
  );
}

function deltaLabel(app: number | undefined, h10: number | null): string {
  if (app === undefined || h10 === null) return "—";
  const d = h10 - app;
  if (Math.abs(d) < 0.005) return "match";
  const sign = d > 0 ? "+" : "";
  const pct = app > 0 ? ` (${sign}${((d / app) * 100).toFixed(0)}%)` : "";
  return `${sign}${d.toFixed(2)}${pct}`;
}
function deltaColor(app: number | undefined, h10: number | null): string {
  if (app === undefined || h10 === null) return "text-muted-foreground";
  const d = h10 - app;
  if (Math.abs(d) < 0.005) return "text-muted-foreground";
  if (app > 0 && Math.abs(d / app) < 0.05) return "text-success";
  return "text-warning";
}

function fmt$(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "";
  const n = Math.abs(v);
  return `${sign}$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
