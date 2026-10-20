// Every figure the page shows for a period, defined once: how to format it,
// which way is better, and whether its change is a percentage or a point move.

import type { Granularity, PeriodSummary } from "@platform/supply-chain-data";
import { count, money, money2, monthLabel, pct } from "./format";

export type MetricKey = keyof PeriodSummary & string;

export interface Metric {
  key: MetricKey;
  label: string;
  format: (v: number | null) => string;
  /** +1 when higher is better, -1 when lower is better, 0 when neither. */
  better: 1 | -1 | 0;
  /** Shares move in points; everything else in percent. */
  change: "pct" | "pp";
  help?: string;
}

const times = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}×`);
const days = (v: number | null) => (v == null ? "—" : `${count(v)} d`);
const weeks = (v: number | null) => (v == null ? "—" : `${v} wk`);
const cents = (v: number | null) => (v == null ? "—" : `$${v.toFixed(3)}`);

export const METRICS: Record<string, Metric> = {
  netSales: { key: "netSales", label: "Net sales", format: money, better: 1, change: "pct" },
  unitsSold: { key: "unitsSold", label: "Units sold", format: count, better: 1, change: "pct" },
  fulfilmentFees: { key: "fulfilmentFees", label: "Fulfilment", format: money, better: -1, change: "pct" },
  fulfilmentPerUnit: { key: "fulfilmentPerUnit", label: "Fulfilment / unit", format: money2, better: -1, change: "pct" },
  fbaStorage: { key: "fbaStorage", label: "FBA storage", format: money, better: -1, change: "pct" },
  agedSurcharge: { key: "agedSurcharge", label: "Aged surcharge", format: money, better: -1, change: "pct" },
  awdStorage: { key: "awdStorage", label: "AWD storage", format: money, better: -1, change: "pct" },
  awdHandling: { key: "awdHandling", label: "AWD handling", format: money, better: -1, change: "pct", help: "AWD receiving and transport to FBA" },
  fbaInbound: { key: "fbaInbound", label: "Inbound", format: money, better: -1, change: "pct", help: "FBA inbound placement, transport and defect fees" },
  removals: { key: "removals", label: "Removals", format: money, better: -1, change: "pct" },
  supplyChainCost: { key: "supplyChainCost", label: "Supply-chain cost", format: money, better: -1, change: "pct", help: "Fulfilment + FBA and AWD storage + aged surcharge + AWD handling + inbound + removals" },
  supplyChainShareOfSales: { key: "supplyChainShareOfSales", label: "Supply chain % of sales", format: (v) => pct(v), better: -1, change: "pp" },
  storageShareOfSales: { key: "storageShareOfSales", label: "Storage % of sales", format: (v) => pct(v, 2), better: -1, change: "pp", help: "FBA + AWD storage + aged surcharge" },

  fbaUnitsEnd: { key: "fbaUnitsEnd", label: "FBA units", format: count, better: 0, change: "pct" },
  awdUnitsEnd: { key: "awdUnitsEnd", label: "AWD units", format: count, better: 0, change: "pct", help: "Reconstructed from today's AWD stock" },
  inventoryValue: { key: "inventoryValue", label: "Stock at cost", format: money, better: 0, change: "pct" },
  cogsSold: { key: "cogsSold", label: "COGS shipped", format: money, better: 1, change: "pct" },
  turnover: { key: "turnover", label: "Turnover", format: times, better: 1, change: "pct", help: "Cost of units shipped over average stock held at cost, annualised" },
  daysOfInventory: { key: "daysOfInventory", label: "Days of inventory", format: days, better: -1, change: "pct", help: "Average stock held, in days of the period's shipping pace" },
  sellThrough: { key: "sellThrough", label: "Sell-through", format: (v) => pct(v), better: 1, change: "pp", help: "Units shipped ÷ (units shipped + closing stock, FBA + AWD)" },
  excessShare: { key: "excessShare", label: "Over 180 days cover", format: (v) => pct(v), better: -1, change: "pp", help: "Share of closing stock at cost on SKUs holding more than 180 days at their trailing 90-day shipping pace" },
  excessValue: { key: "excessValue", label: "Excess at cost", format: money, better: -1, change: "pct" },
  deadValue: { key: "deadValue", label: "Dead stock at cost", format: money, better: -1, change: "pct", help: "Closing stock at cost on SKUs that shipped nothing in the last month" },
  awdShare: { key: "awdShare", label: "Held at AWD", format: (v) => pct(v, 0), better: 0, change: "pp" },
  utilizationWeeks: { key: "utilizationWeeks", label: "Utilisation ratio", format: weeks, better: -1, change: "pct", help: "Amazon's storage utilisation ratio, from its monthly storage-fee report: stored volume against shipped volume, in weeks. A period shows its latest month. Above Amazon's threshold it adds a storage surcharge." },

  inStockRate: { key: "inStockRate", label: "In-stock rate", format: (v) => pct(v), better: 1, change: "pp", help: "Days SKUs had sellable FBA stock, weighted by each SKU's six-month shipping pace" },
  skusStockedOut: { key: "skusStockedOut", label: "SKUs that ran out", format: count, better: -1, change: "pct", help: "Selling SKUs without sellable stock for more than 5% of a month" },
  controllablePerUnit: { key: "controllablePerUnit", label: "Storage & logistics / unit", format: cents, better: -1, change: "pct", help: "Storage, AWD, aged surcharge, inbound and removals per unit sold — everything except Amazon's fulfilment fee" },
  supplyChainPerUnit: { key: "supplyChainPerUnit", label: "Supply chain / unit", format: money2, better: -1, change: "pct" },
  landedCostPerUnit: { key: "landedCostPerUnit", label: "Landed cost / unit", format: money2, better: -1, change: "pct", help: "COGS per unit + supply-chain cost per unit sold" },
  contributionMargin: { key: "contributionMargin", label: "Contribution", format: money, better: 1, change: "pct", help: "Net sales − COGS − referral and other Amazon fees − supply-chain cost. Before advertising." },
  contributionShare: { key: "contributionShare", label: "Contribution %", format: (v) => pct(v), better: 1, change: "pp" },
  gmroi: { key: "gmroi", label: "GMROI", format: (v) => (v == null ? "—" : `$${v.toFixed(2)}`), better: 1, change: "pct", help: "Contribution per dollar of stock held at cost, annualised" },
  refundRate: { key: "refundRate", label: "Refund rate", format: (v) => pct(v), better: -1, change: "pp" },
  fbaStoragePerUnitMonth: { key: "fbaStoragePerUnitMonth", label: "FBA storage / unit-month", format: cents, better: -1, change: "pct", help: "FBA storage ÷ units held each month" },
  awdStoragePerUnitMonth: { key: "awdStoragePerUnitMonth", label: "AWD storage / unit-month", format: cents, better: -1, change: "pct", help: "AWD storage ÷ units held each month — compare with FBA to see what AWD saves" },
  inboundPerUnitReceived: { key: "inboundPerUnitReceived", label: "Inbound / unit received", format: money2, better: -1, change: "pct" },
};

export const VIEWS: Record<"costs" | "inventory" | "kpis", MetricKey[]> = {
  costs: ["unitsSold", "netSales", "fulfilmentFees", "fulfilmentPerUnit", "fbaStorage", "agedSurcharge", "awdStorage", "awdHandling", "fbaInbound", "removals", "supplyChainCost", "supplyChainShareOfSales", "storageShareOfSales"],
  inventory: ["inStockRate", "skusStockedOut", "fbaUnitsEnd", "awdUnitsEnd", "inventoryValue", "cogsSold", "turnover", "daysOfInventory", "sellThrough", "excessShare", "deadValue", "utilizationWeeks"],
  kpis: ["controllablePerUnit", "supplyChainPerUnit", "landedCostPerUnit", "contributionShare", "gmroi", "turnover", "sellThrough", "refundRate", "fbaStoragePerUnitMonth", "awdStoragePerUnitMonth", "inboundPerUnitReceived", "excessShare", "awdShare"],
};

export function periodLabel(key: string, g: Granularity, long = false): string {
  if (g === "month") return monthLabel(key, long ? "long" : "short");
  if (g === "quarter") {
    const [y, q] = key.split("-Q");
    return long ? `Q${q} ${y}` : `Q${q} ’${y.slice(2)}`;
  }
  return key;
}

export function formatChange(v: number | null, kind: Metric["change"]): string {
  if (v == null) return "";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "±";
  const a = Math.abs(v);
  // Past tenfold the base was too small for a percentage to mean anything.
  if (kind === "pct" && a >= 10) return `${sign}999%+`;
  return kind === "pp" ? `${sign}${(a * 100).toFixed(1)} pp` : `${sign}${(a * 100).toFixed(a >= 10 ? 0 : 1)}%`;
}
