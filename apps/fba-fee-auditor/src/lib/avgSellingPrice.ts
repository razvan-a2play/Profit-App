// Average realised selling price per SKU over the analysis window.
//
// Refunds are issued at the price the customer actually paid, which drifts a
// long way from today's list price (SEZ0101002 has ranged $19.98–$35.95 in the
// data we've seen). For a trailing-365-day decision the right figure is:
//
//     ASP = sum(item-price) / sum(quantity)   across all shipped order lines
//
// Sourced from the All-Orders flat file via the gateway. File-backed cache so
// a throttled Amazon call never blanks the table, and so we don't re-pull a
// year of orders on every page load.

import fs from "node:fs";
import path from "node:path";
import { getSellerCentralConfig } from "./env";

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "avg-price.json");
const MIN_WINDOW_DAYS = 300;

export interface AspRow {
  avgPrice: number;
  units: number;
  revenue: number;
}

export interface AspStore {
  updatedAt: string;
  reportId: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  /** lowercased sku -> ASP */
  bySku: Record<string, AspRow>;
}

export function getAsp(): AspStore | null {
  try {
    if (!fs.existsSync(FILE)) return null;
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as AspStore;
  } catch {
    return null;
  }
}

function save(s: AspStore) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s), "utf8");
}

export function clearAsp() {
  try {
    if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
  } catch {
    /* ignore */
  }
}

function sca() {
  const cfg = getSellerCentralConfig();
  if (!cfg) throw new Error("Seller-central API not configured.");
  return cfg;
}

async function scaFetch(path2: string, init?: RequestInit) {
  const cfg = sca();
  const res = await fetch(`${cfg.baseUrl}${path2}`, {
    ...init,
    headers: { "X-API-Key": cfg.apiKey, ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${path2} -> ${res.status}`);
  return res.json();
}

export interface AspRefreshResult {
  ok: boolean;
  status: string;
  reportId: string | null;
  skuCount: number;
  windowStart: string | null;
  windowEnd: string | null;
  chunksReady?: number;
  chunksPending?: number;
  chunksTotal?: number;
}

/**
 * Pull ASP from the newest wide All-Orders report. Requests one if none is
 * wide enough yet — Amazon takes a few minutes on a year of orders, so the
 * caller should retry rather than block.
 */
export async function refreshAsp(): Promise<AspRefreshResult> {
  // Amazon caps All-Orders reports at 30 days, so the gateway stitches ~13
  // chunks together. It returns partial data plus a pending count while the
  // rest generate — we persist whatever is ready and improve on later calls.
  const out = (await scaFetch(`/reports/asp?lookback_days=365`)) as {
    ready: boolean;
    chunks_ready?: number;
    chunks_pending?: number;
    chunks_total?: number;
    sku_count?: number;
    skus?: Record<string, { avg_price: number; units: number; revenue: number }>;
  };

  const chunksReady = out.chunks_ready ?? 0;
  const chunksPending = out.chunks_pending ?? 0;
  const chunksTotal = out.chunks_total ?? 0;

  if (!out.ready || !out.skus || Object.keys(out.skus).length === 0) {
    return {
      ok: false,
      status: `generating (${chunksReady}/${chunksTotal} chunks ready)`,
      reportId: null,
      skuCount: 0,
      windowStart: null,
      windowEnd: null,
      chunksReady,
      chunksPending,
      chunksTotal,
    };
  }

  const bySku: Record<string, AspRow> = {};
  for (const [sku, v] of Object.entries(out.skus)) {
    if (v.avg_price > 0 && v.units > 0) {
      bySku[sku.trim().toLowerCase()] = {
        avgPrice: v.avg_price,
        units: v.units,
        revenue: v.revenue,
      };
    }
  }

  const end = new Date();
  const start2 = new Date(end.getTime() - 365 * 86_400_000);
  const store: AspStore = {
    updatedAt: new Date().toISOString(),
    reportId: null,
    windowStart: start2.toISOString().slice(0, 10),
    windowEnd: end.toISOString().slice(0, 10),
    bySku,
  };
  save(store);

  return {
    ok: true,
    status: chunksPending > 0 ? `partial (${chunksReady}/${chunksTotal} chunks)` : "DONE",
    reportId: null,
    skuCount: Object.keys(bySku).length,
    windowStart: store.windowStart,
    windowEnd: store.windowEnd,
    chunksReady,
    chunksPending,
    chunksTotal,
  };
}
