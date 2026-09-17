"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Input, useToast } from "@platform/ui";
import { loadDashboardRows, type DashboardRow } from "@/lib/dashboard-data";
import { computeMetrics } from "@/lib/dashboard-calc";

interface Overrides {
  [sku: string]: { desiredPrice?: number; tacosPercent?: number };
}

export default function DashboardTable() {
  const { toast } = useToast();
  const [rows, setRows] = useState<DashboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [search, setSearch] = useState("");

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

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = `${r.sku} ${r.asin ?? ""} ${r.productName}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  const getDesiredPrice = (r: DashboardRow) =>
    overrides[r.sku]?.desiredPrice ?? Number(r.versionData.sellingPrice ?? 0);
  const getTacosPercent = (r: DashboardRow) =>
    overrides[r.sku]?.tacosPercent ?? Number(r.versionData.marketingTacosPercentage ?? 0);

  const setOverride = (sku: string, patch: Partial<{ desiredPrice: number; tacosPercent: number }>) => {
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
    return <div className="p-8 text-muted-foreground">Loading live SKUs…</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">
          No live snapshots found. Save a version with bucket = <code>live</code> in the calculator first.
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
        <div className="text-sm text-muted-foreground">
          {filteredRows?.length ?? 0} of {rows.length} live SKUs
          {editedCount > 0 && (
            <> · <span className="text-warning font-medium">{editedCount} edited (local only)</span></>
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
              <Th className="text-left">Country</Th>
              <Th>Desired price</Th>
              <Th>COGS</Th>
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
              const desiredPrice = getDesiredPrice(row);
              const tacosPercent = getTacosPercent(row);
              const m = computeMetrics(row.versionData, desiredPrice, tacosPercent);
              const marginBand =
                m.netProfitPercent >= 25 ? "good" : m.netProfitPercent >= 15 ? "ok" : "bad";
              const edited = overrides[row.sku];

              return (
                <tr
                  key={row.sku}
                  className={`border-t hover:bg-muted/40 ${edited ? "bg-warning-light/30" : ""}`}
                >
                  <Td className="text-muted-foreground">{idx + 1}</Td>
                  <Td className="max-w-[280px]">
                    <div className="font-medium truncate" title={row.productName}>
                      {row.productName}
                    </div>
                    {row.supplier && (
                      <div className="text-xs text-muted-foreground truncate" title={row.supplier}>
                        {row.supplier}
                      </div>
                    )}
                  </Td>
                  <Td className="font-mono text-xs">{row.asin ?? "—"}</Td>
                  <Td className="font-mono text-xs">{row.sku}</Td>
                  <Td>US</Td>
                  <Td>
                    <Input
                      type="number"
                      step="0.01"
                      value={desiredPrice}
                      onChange={(e) =>
                        setOverride(row.sku, { desiredPrice: parseFloat(e.target.value) || 0 })
                      }
                      className="h-8 w-24 text-right font-mono"
                    />
                  </Td>
                  <Td className="text-right font-mono">{fmt$(m.cogs)}</Td>
                  <Td className="text-right font-mono">{fmt$(m.referralFee)}</Td>
                  <Td className="text-right font-mono">{fmt$(m.fbaFee)}</Td>
                  <Td className="text-right font-mono">{fmt$(m.shippingStorage)}</Td>
                  <Td>
                    <Input
                      type="number"
                      step="0.1"
                      value={tacosPercent}
                      onChange={(e) =>
                        setOverride(row.sku, { tacosPercent: parseFloat(e.target.value) || 0 })
                      }
                      className="h-8 w-20 text-right font-mono"
                    />
                  </Td>
                  <Td className="text-right font-mono">{fmt$(m.tacosDollar)}</Td>
                  <Td className="text-right font-mono">{fmt$(m.totalCosts)}</Td>
                  <Td
                    className={`text-right font-mono font-semibold ${
                      marginBand === "good"
                        ? "text-success"
                        : marginBand === "ok"
                        ? "text-warning"
                        : "text-destructive"
                    }`}
                  >
                    {fmt$(m.netProfit)}
                  </Td>
                  <Td
                    className={`text-right font-mono font-semibold ${
                      marginBand === "good"
                        ? "text-success"
                        : marginBand === "ok"
                        ? "text-warning"
                        : "text-destructive"
                    }`}
                  >
                    {m.netProfitPercent.toFixed(1)}%
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Dashboard edits are a <strong>local what-if</strong> — they never touch the saved live snapshots.
        Use the calculator to persist a change.
        · Margin colour: <span className="text-success">≥25%</span> ·{" "}
        <span className="text-warning">15–25%</span> · <span className="text-destructive">&lt;15%</span>
      </p>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide whitespace-nowrap ${className}`}>
      {children}
    </th>
  );
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-middle whitespace-nowrap ${className}`}>{children}</td>;
}

function fmt$(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "";
  const n = Math.abs(v);
  return `${sign}$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
