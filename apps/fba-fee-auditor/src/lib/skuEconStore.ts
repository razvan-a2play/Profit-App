// File-backed cache of per-SKU economics from the FBA fees report:
// price, FBA fulfilment fee, referral fee, size tier, package weight, ASIN.
//
// Amazon throttles the fees-report *document download* aggressively — a call
// that worked a minute ago can come back "unavailable". Without a cache the
// whole decision table empties out whenever that happens. We refresh whenever
// Amazon cooperates and otherwise serve the last good copy.

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "sku-econ.json");

export interface SkuEcon {
  sku: string;
  asin: string | null;
  price: number;
  fbaFee: number;
  referralFee: number | null;
  sizeTier: string | null;
  weightLb: number | null;
}

export interface SkuEconStore {
  updatedAt: string;
  reportId: string | null;
  /** lowercased sku -> econ */
  bySku: Record<string, SkuEcon>;
}

export function getSkuEcon(): SkuEconStore | null {
  try {
    if (!fs.existsSync(FILE)) return null;
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as SkuEconStore;
  } catch {
    return null;
  }
}

export function saveSkuEcon(reportId: string | null, rows: SkuEcon[]): SkuEconStore {
  const bySku: Record<string, SkuEcon> = {};
  for (const r of rows) {
    if (!r.sku) continue;
    bySku[r.sku.trim().toLowerCase()] = r;
  }
  const store: SkuEconStore = {
    updatedAt: new Date().toISOString(),
    reportId,
    bySku,
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(store), "utf8");
  return store;
}
