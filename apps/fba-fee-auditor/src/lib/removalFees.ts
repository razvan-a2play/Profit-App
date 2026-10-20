// Per-SKU disposal / removal fee, measured from what Amazon actually charged.
//
// When a returned unit is graded unsellable (CUSTOMER_DAMAGED, DEFECTIVE) it
// does not simply vanish — it becomes unfulfillable inventory that has to be
// disposed of or shipped back, and Amazon charges a per-unit fee for either.
// That fee appears in NO returns or fee report, and the Finances API files it
// under RemovalShipmentEventList rather than ServiceFeeEventList, so the FBA
// Removal Order Detail report is the only practical source.
//
// It matters because switching a SKU off returnless *creates* unsellable units
// that previously stayed with the customer. Rates measured from real orders
// range $0.61–$5.01 across this catalogue, so a flat assumption is no good:
// on a high-scrap SKU the disposal fee can swallow the entire saving.

import fs from "node:fs";
import path from "node:path";
import { getSellerCentralConfig } from "./env";

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "removal-fees.json");

export interface RemovalRow {
  sku: string;
  /** FNSKU — equals the ASIN for FBA, so it links merchant-SKU aliases. */
  fnsku: string;
  disposed: number;
  shipped: number;
  units: number;
  fee: number;
  /** Units actually disposed of (excludes liquidations, which are free). */
  disposalUnits: number;
  /** Rate charged to throw away one unsellable unit — the one that matters. */
  disposalFeePerUnit: number | null;
  /** Units sent to Liquidations. No removal fee, but no recovery data either. */
  liquidated: number;
  /** Blended over everything removed. Kept for reference only. */
  feePerUnit: number | null;
}

export interface RemovalStore {
  updatedAt: string;
  reportId: string | null;
  totalUnits: number;
  totalFee: number;
  /** Catalogue-wide disposal rate — the fallback when a SKU has no history. */
  avgDisposalFeePerUnit: number | null;
  orderTypes: Record<string, { units: number; fee: number; feePerUnit: number; cancelled: number }>;
  /** lowercased sku -> row */
  bySku: Record<string, RemovalRow>;
}

export function getRemovalFees(): RemovalStore | null {
  try {
    if (!fs.existsSync(FILE)) return null;
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as RemovalStore;
  } catch {
    return null;
  }
}

function save(s: RemovalStore) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s), "utf8");
}

function sca() {
  const cfg = getSellerCentralConfig();
  if (!cfg) throw new Error("Seller-central API not configured.");
  return cfg;
}

async function scaFetch(p: string, init?: RequestInit) {
  const cfg = sca();
  const res = await fetch(`${cfg.baseUrl}${p}`, {
    ...init,
    headers: { "X-API-Key": cfg.apiKey, ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${p} -> ${res.status}`);
  return res.json();
}

const REPORT_TYPE = "GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA";

interface ListItem {
  reportId: string;
  processingStatus?: string;
  createdTime?: string;
}

/**
 * Refresh from the newest finished Removal Order Detail report, requesting one
 * if none exists. Amazon takes a few minutes, so a caller that gets
 * `ready: false` should retry rather than block.
 */
export async function refreshRemovalFees(lookbackDays = 365): Promise<{
  ok: boolean;
  status: string;
  skuCount: number;
  totalUnits: number;
  avgFeePerUnit: number | null;
}> {
  const list = (await scaFetch(
    `/reports/?report_type=${REPORT_TYPE}`,
  ).catch(() => [])) as ListItem[];

  const done = (Array.isArray(list) ? list : [])
    .filter((r) => r.processingStatus === "DONE")
    .sort((a, b) => (b.createdTime ?? "").localeCompare(a.createdTime ?? ""))[0];

  if (!done) {
    const pending = (Array.isArray(list) ? list : []).some((r) =>
      ["IN_QUEUE", "IN_PROGRESS"].includes(r.processingStatus ?? ""),
    );
    if (!pending) {
      const start = new Date(Date.now() - lookbackDays * 86_400_000)
        .toISOString()
        .slice(0, 19) + "Z";
      await scaFetch(
        `/reports/?report_type=${REPORT_TYPE}&data_start_time=${start}`,
        { method: "POST" },
      ).catch(() => null);
    }
    const cached = getRemovalFees();
    return {
      ok: false,
      status: pending ? "generating" : "requested",
      skuCount: cached ? Object.keys(cached.bySku).length : 0,
      totalUnits: cached?.totalUnits ?? 0,
      avgFeePerUnit: cached?.avgDisposalFeePerUnit ?? null,
    };
  }

  const out = (await scaFetch(`/reports/${done.reportId}/removal-fees`)) as {
    ready?: boolean;
    total_units?: number;
    total_fee?: number;
    avg_disposal_fee_per_unit?: number | null;
    by_type?: Record<string, { units: number; fee: number; fee_per_unit: number; cancelled: number }>;
    skus?: Record<string, {
      sku: string; fnsku?: string; disposed: number; shipped: number; units: number; fee: number;
      disposal_units: number; disposal_fee_per_unit: number | null;
      liquidated: number; fee_per_unit: number | null;
    }>;
  };

  if (!out.ready || !out.skus) {
    const cached = getRemovalFees();
    return {
      ok: false,
      status: "not-ready",
      skuCount: cached ? Object.keys(cached.bySku).length : 0,
      totalUnits: cached?.totalUnits ?? 0,
      avgFeePerUnit: cached?.avgDisposalFeePerUnit ?? null,
    };
  }

  const bySku: Record<string, RemovalRow> = {};
  for (const [sku, v] of Object.entries(out.skus)) {
    bySku[sku.trim().toLowerCase()] = {
      sku: v.sku,
      fnsku: (v.fnsku ?? "").toUpperCase(),
      disposed: v.disposed,
      shipped: v.shipped,
      units: v.units,
      fee: v.fee,
      disposalUnits: v.disposal_units,
      disposalFeePerUnit: v.disposal_fee_per_unit,
      liquidated: v.liquidated,
      feePerUnit: v.fee_per_unit,
    };
  }

  const store: RemovalStore = {
    updatedAt: new Date().toISOString(),
    reportId: done.reportId,
    totalUnits: out.total_units ?? 0,
    totalFee: out.total_fee ?? 0,
    avgDisposalFeePerUnit: out.avg_disposal_fee_per_unit ?? null,
    orderTypes: Object.fromEntries(
      Object.entries(out.by_type ?? {}).map(([k, v]) => [
        k,
        { units: v.units, fee: v.fee, feePerUnit: v.fee_per_unit, cancelled: v.cancelled },
      ]),
    ),
    bySku,
  };
  save(store);

  return {
    ok: true,
    status: "DONE",
    skuCount: Object.keys(bySku).length,
    totalUnits: store.totalUnits,
    avgFeePerUnit: store.avgDisposalFeePerUnit,
  };
}

/**
 * Disposal fee to charge one unsellable unit of `sku`.
 *
 * Falls back to the nearest SKU by FBA fee when this one has no removal
 * history — removal fees track size and weight, and the FBA fulfilment fee is
 * the best size proxy already on hand. Returns `estimated: true` so the UI can
 * mark it, because the fallback drives real money on high-scrap SKUs.
 */
export function disposalFeeFor(
  store: RemovalStore | null,
  sku: string,
  fbaFee: number,
  tierIndex: { fbaFee: number; feePerUnit: number }[],
  asin?: string | null,
): { fee: number; estimated: boolean } {
  const own = store?.bySku[sku.trim().toLowerCase()];
  if (own && own.disposalUnits > 0 && own.disposalFeePerUnit != null && own.disposalFeePerUnit > 0) {
    return { fee: own.disposalFeePerUnit, estimated: false };
  }
  // A merchant SKU with no disposals of its own may share an ASIN with one that
  // has them — same physical product, so the same rate card. SEZ0101002 has no
  // disposal history but its alias GN-C3VX-RA10 does, on the same ASIN.
  if (asin && store) {
    const a = asin.trim().toUpperCase();
    let units = 0;
    let fee = 0;
    for (const row of Object.values(store.bySku)) {
      if (row.fnsku === a && row.disposalUnits > 0 && row.disposalFeePerUnit != null) {
        units += row.disposalUnits;
        fee += row.disposalFeePerUnit * row.disposalUnits;
      }
    }
    if (units > 0) return { fee: fee / units, estimated: false };
  }
  if (tierIndex.length === 0) {
    return { fee: store?.avgDisposalFeePerUnit ?? 0, estimated: true };
  }
  const nearest = tierIndex.reduce((best, t) =>
    Math.abs(t.fbaFee - fbaFee) < Math.abs(best.fbaFee - fbaFee) ? t : best,
  );
  return { fee: nearest.feePerUnit, estimated: true };
}
