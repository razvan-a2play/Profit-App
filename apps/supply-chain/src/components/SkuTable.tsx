"use client";

import { useMemo, useState } from "react";
import type { SkuPeriodRow } from "@platform/supply-chain-data";
import { cn } from "@platform/ui";
import { count, money, money2, pct } from "@/lib/format";
import { formatChange } from "@/lib/metrics";
import { DeltaArrow, Segmented, TONE } from "./ui";

type NumKey = {
  [K in keyof SkuPeriodRow]: SkuPeriodRow[K] extends number | null ? K : never;
}[keyof SkuPeriodRow];

interface Column {
  key: NumKey;
  label: string;
  render: (r: SkuPeriodRow) => React.ReactNode;
  title?: string;
}

/** A change cell: sign, arrow and favourable/unfavourable ink. */
function Delta({ v, kind, better }: { v: number | null; kind: "pct" | "pp" | "days"; better: 1 | -1 }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  const tone = v === 0 ? TONE.muted : (v > 0 ? 1 : -1) === better ? TONE.good : TONE.bad;
  const text = kind === "days" ? `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v)} d` : formatChange(v, kind);
  return (
    <span style={{ color: tone }}>
      <DeltaArrow dir={v > 0 ? "up" : v < 0 ? "down" : "flat"} />
      {text}
      <span className="sr-only">{v === 0 ? "" : (v > 0 ? 1 : -1) === better ? ", better" : ", worse"}</span>
    </span>
  );
}

function columns(vsLabel: string): Record<"costs" | "inventory", Column[]> {
  return {
    costs: [
      { key: "unitsSold", label: "Units", render: (r) => count(r.unitsSold) },
      { key: "unitsChange", label: `Units ${vsLabel}`, render: (r) => <Delta v={r.unitsChange} kind="pct" better={1} /> },
      { key: "netSales", label: "Net sales", render: (r) => money(r.netSales) },
      { key: "netSalesChange", label: `Sales ${vsLabel}`, render: (r) => <Delta v={r.netSalesChange} kind="pct" better={1} /> },
      { key: "fulfilmentPerUnit", label: "Fulfilment / unit", render: (r) => money2(r.fulfilmentPerUnit) },
      { key: "fbaStorage", label: "FBA storage", render: (r) => money(r.fbaStorage), title: "From Amazon's monthly storage-fee report" },
      { key: "awdCost", label: "AWD", render: (r) => (r.awdCost ? money(r.awdCost) : "—"), title: "Processing and transport traced to this SKU's AWD shipments and orders, plus its share of AWD storage by units held" },
      { key: "agedSurcharge", label: "Aged surcharge", render: (r) => (r.agedSurcharge ? money(r.agedSurcharge) : "—") },
      { key: "storageShareOfSales", label: "Storage %", render: (r) => pct(r.storageShareOfSales) },
      { key: "costShareOfSales", label: "Fulfil + storage %", render: (r) => pct(r.costShareOfSales) },
      { key: "costShareChange", label: vsLabel, render: (r) => <Delta v={r.costShareChange} kind="pp" better={-1} />, title: "Change in fulfilment + storage as a share of sales" },
    ],
    inventory: [
      { key: "unitsShipped", label: "Units shipped", render: (r) => count(r.unitsShipped), title: "Customer shipments from Amazon's ledger" },
      { key: "fbaUnitsEnd", label: "FBA units", render: (r) => count(r.fbaUnitsEnd) },
      { key: "awdUnitsEnd", label: "AWD units", render: (r) => count(r.awdUnitsEnd), title: "Reconstructed period-end AWD stock" },
      { key: "unitCost", label: "Unit cost", render: (r) => (r.unitCost != null ? `${money2(r.unitCost)}${r.costSource === "helium" ? " H" : ""}` : "—"), title: "Landed COGS; H = Helium 10 product cost, used where landed COGS is missing" },
      { key: "inventoryValue", label: "Stock at cost", render: (r) => money(r.inventoryValue) },
      { key: "turnover", label: "Turnover", render: (r) => (r.turnover != null ? `${r.turnover.toFixed(1)}×` : "—"), title: "Annualised" },
      { key: "daysOfInventory", label: "Days of inventory", render: (r) => count(r.daysOfInventory) },
      { key: "daysOfInventoryChange", label: vsLabel, render: (r) => <Delta v={r.daysOfInventoryChange} kind="days" better={-1} /> },
    ],
  };
}

export function SkuTable({ rows, vsLabel }: { rows: SkuPeriodRow[]; vsLabel: string }) {
  const [view, setView] = useState<"costs" | "inventory">("costs");
  const [sort, setSort] = useState<{ key: NumKey; desc: boolean }>({ key: "netSales", desc: true });
  const [query, setQuery] = useState("");
  const cols = columns(vsLabel)[view];

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? rows.filter((r) => `${r.sku} ${r.asin} ${r.productName}`.toLowerCase().includes(q)) : rows;
    // Missing values sort last whichever way the column runs.
    return [...filtered].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sort.desc ? bv - av : av - bv;
    });
  }, [rows, sort, query]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p role="status" className="sr-only">
          {shown.length} of {rows.length} SKUs, sorted by {cols.find((c) => c.key === sort.key)?.label ?? sort.key}, {sort.desc ? "highest first" : "lowest first"}
        </p>
        <Segmented
          label="SKU columns"
          value={view}
          onChange={(v) => {
            setView(v);
            setSort({ key: v === "costs" ? "netSales" : "inventoryValue", desc: true });
          }}
          options={[
            ["costs", "Costs"],
            ["inventory", "Inventory"],
          ]}
          className="w-full sm:w-fit"
        />
        <input
          type="search"
          aria-label="Filter SKUs by SKU, ASIN or product name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by SKU, ASIN or name"
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm sm:h-9 sm:w-72"
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">SKU</th>
              {cols.map((c) => (
                <th
                  key={c.key + c.label}
                  scope="col"
                  aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}
                  className="px-3 py-2 text-right font-medium whitespace-nowrap"
                  title={c.title}
                >
                  <button
                    type="button"
                    onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}
                    className={cn("hover:text-foreground", sort.key === c.key && "text-foreground")}
                  >
                    {c.label}
                    {sort.key === c.key ? (sort.desc ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.sku} className="border-t border-border">
                <td className="max-w-[22rem] px-3 py-2">
                  <div className="font-medium">{r.sku}</div>
                  <div className="truncate text-xs text-muted-foreground" title={r.productName}>
                    {r.asin}
                    {r.productName ? ` · ${r.productName}` : ""}
                  </div>
                </td>
                {cols.map((c) => (
                  <td key={c.key + c.label} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={cols.length + 1} className="px-3 py-6 text-center text-muted-foreground">
                  No SKUs match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">What these columns mean</summary>
        <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {cols
            .filter((c) => c.title)
            .map((c) => (
              <div key={c.key + c.label}>
                <dt className="font-medium">{c.label}</dt>
                <dd className="text-muted-foreground">{c.title}</dd>
              </div>
            ))}
        </dl>
      </details>
    </div>
  );
}
