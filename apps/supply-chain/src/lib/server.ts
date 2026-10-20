// Server-only helpers: the gateway binding and the SKU catalogue.

import fs from "node:fs";
import path from "node:path";
import {
  ACCOUNT_LEVEL_SKU,
  createGateway,
  type BilledCharge,
  type BilledFees,
  type Gateway,
  type UnitCost,
} from "@platform/supply-chain-data";

// Overridable so a fixture can be pointed at without touching the real cache.
export const DATA_DIR = process.env.SUPPLY_CHAIN_DATA_DIR || path.join(process.cwd(), ".data");

export function getGateway(): Gateway {
  const baseUrl = process.env.SELLER_CENTRAL_API_URL;
  const apiKey = process.env.SELLER_CENTRAL_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("Seller-central API not configured (SELLER_CENTRAL_API_URL / _API_KEY in .env.local).");
  }
  return createGateway({ baseUrl, apiKey });
}

export interface Catalogue {
  asinBySku: Record<string, string>;
  nameBySku: Record<string, string>;
  fetchedAt: string;
}

const CATALOGUE_FILE = path.join(DATA_DIR, "catalogue.json");
const CATALOGUE_MAX_AGE_MS = 24 * 3600 * 1000;

/**
 * SKU -> ASIN and product name, from FBA inventory. The storage report is per
 * ASIN and sales are per SKU; this is what joins them. Refreshed daily, and a
 * stale copy beats none when the gateway is down.
 */
export async function getCatalogue(gw: Gateway): Promise<Catalogue> {
  let cached: Catalogue | null = null;
  try {
    cached = JSON.parse(fs.readFileSync(CATALOGUE_FILE, "utf8")) as Catalogue;
    if (Date.now() - new Date(cached.fetchedAt).getTime() < CATALOGUE_MAX_AGE_MS) return cached;
  } catch {
    /* no cache yet */
  }
  try {
    const items = (await gw(`/inventory/?details=false`)) as Array<{
      seller_sku: string;
      asin?: string | null;
      product_name?: string | null;
    }>;
    const out: Catalogue = { asinBySku: {}, nameBySku: {}, fetchedAt: new Date().toISOString() };
    for (const it of items ?? []) {
      const sku = it.seller_sku?.trim().toUpperCase();
      if (!sku) continue;
      if (it.asin) out.asinBySku[sku] = it.asin.toUpperCase();
      if (it.product_name) out.nameBySku[sku] = it.product_name;
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CATALOGUE_FILE, JSON.stringify(out), "utf8");
    return out;
  } catch {
    return cached ?? { asinBySku: {}, nameBySku: {}, fetchedAt: new Date(0).toISOString() };
  }
}

// ── unit costs ─────────────────────────────────────────────────────────────

/**
 * The fee auditor's landed COGS store: manufacturing (P&L app) + freight per
 * unit (Inbound Pathfinder), or an explicit override. Read in place so the two
 * apps never disagree about what a unit costs.
 */
const LANDED_COGS_FILE =
  process.env.COGS_FILE || path.join(process.cwd(), "..", "fba-fee-auditor", ".data", "cogs.json");
/** Helium 10's configured COGS, saved here. Product cost only; used where landed COGS has no entry. */
const HELIUM_COGS_FILE = path.join(DATA_DIR, "helium-cogs.json");

interface LandedEntry {
  manufacturing?: number;
  freight?: number;
  other?: number;
  override?: number;
}

export function getUnitCosts(): Record<string, UnitCost> {
  const out: Record<string, UnitCost> = {};
  try {
    const helium = JSON.parse(fs.readFileSync(HELIUM_COGS_FILE, "utf8")) as { bySku: Record<string, number> };
    for (const [sku, cost] of Object.entries(helium.bySku ?? {})) {
      if (cost > 0) out[sku.toUpperCase()] = { cost, source: "helium" };
    }
  } catch {
    /* no Helium snapshot */
  }
  try {
    const landed = JSON.parse(fs.readFileSync(LANDED_COGS_FILE, "utf8")) as { bySku: Record<string, LandedEntry> };
    for (const [sku, c] of Object.entries(landed.bySku ?? {})) {
      // Same order as the fee auditor: an override wins, else the components.
      // Its price-ratio fallback is deliberately not used: a guessed cost
      // would make a turnover figure look measured.
      const cost = c.override && c.override > 0 ? c.override : (c.manufacturing ?? 0) + (c.freight ?? 0) + (c.other ?? 0);
      if (cost > 0) out[sku.toUpperCase()] = { cost, source: "landed" };
    }
  } catch {
    /* no landed COGS store */
  }
  return out;
}

// ── history older than Amazon's finance window ─────────────────────────────

interface HeliumMonth {
  sales: number;
  refund: number;
  units: number;
  returned: number;
  fulfil: number;
  commission: number;
  removals: number;
  inbound: number;
  awdTransport: number;
}

/**
 * Months Amazon's finance API no longer returns (it keeps 730 days), from a
 * saved Helium 10 export, shaped like a scanned month: totals under one
 * account-level line, no per-SKU detail, and storage marked as unknown because
 * Helium's storage figures for that period are incomplete.
 */
export function getHeliumMonths(): Record<string, { billed: BilledFees; storage: null; monthUnavailable: true }> {
  let file: { months: Record<string, HeliumMonth> };
  try {
    file = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "helium-history.json"), "utf8"));
  } catch {
    return {};
  }
  const out: Record<string, { billed: BilledFees; storage: null; monthUnavailable: true }> = {};
  for (const [month, h] of Object.entries(file.months ?? {})) {
    const charges: BilledCharge[] = [
      { fee_type: "FBADisposalFee", description: "FBA disposal (Helium 10)", group: "fba_removal", amount: h.removals, currency: "USD", reference: "", posted_date: null },
      { fee_type: "FBAInboundConvenienceFee", description: "FBA prep and inbound (Helium 10)", group: "fba_inbound", amount: h.inbound, currency: "USD", reference: "", posted_date: null },
      { fee_type: "AmazonUpstreamStorageTransportationFee", description: "AWD transportation (Helium 10)", group: "awd_transportation", amount: h.awdTransport, currency: "USD", reference: "", posted_date: null },
    ].filter((c) => c.amount > 0) as BilledCharge[];
    const by_group: BilledFees["by_group"] = {};
    for (const c of charges) by_group[c.group] = (by_group[c.group] ?? 0) + c.amount;
    out[month] = {
      billed: {
        ready: true,
        pages: 0,
        total: charges.reduce((a, c) => a + c.amount, 0),
        by_group,
        by_type: [],
        unrecognised_fee_types: [],
        charges,
        by_sku: {
          [ACCOUNT_LEVEL_SKU]: {
            units_sold: h.units,
            units_refunded: h.returned,
            sales: h.sales,
            refunds: h.refund,
            fees: { FBAPerUnitFulfillmentFee: h.fulfil, Commission: h.commission },
          },
        },
        storageKnown: false,
        source: "helium",
      },
      storage: null,
      monthUnavailable: true,
    };
  }
  return out;
}

/** The oldest whole month Amazon's finance API still returns (it keeps 730 days). */
export function earliestReadableMonth(now = new Date()): string {
  const edge = new Date(now.getTime() - 729 * 24 * 3600 * 1000);
  let y = edge.getUTCFullYear();
  let m = edge.getUTCMonth() + 1;
  if (edge.getUTCDate() > 1) {
    m += 1;
    if (m === 13) {
      y += 1;
      m = 1;
    }
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}
