// Read-only adapter onto the Product Library (the supply-chain-app's own
// Supabase project). The auditor never writes here — it only reads each SKU's
// real *unit* package measurements.
//
// Schema (supply-chain-app):
//   products(id, sku, asin, fnsku, ...)
//   packaging_specs(sku_id → products.id, spec_type 'unit'|'master_carton',
//                   version_number, status, length_cm, width_cm, height_cm,
//                   weight_kg, units_per_carton)
//
// We pull the customer-facing *unit* packaging spec (not the master carton),
// pick the best version per SKU (approved first, then highest version_number),
// and hand the audit engine metric dims straight through (already cm / kg).
//
// NOTE: packaging_specs/products RLS requires an authenticated role, so this
// must run with the project's service_role key (server-side only — never the
// browser). The anon key returns zero rows under RLS.

import { createClient } from "@supabase/supabase-js";
import type { RealMeasurement } from "@platform/calc";
import { getProductLibraryConfig } from "./env";

interface SpecRow {
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  version_number: number | null;
  status: string | null;
  products: { sku: string | null; asin: string | null; fnsku: string | null } | null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export interface LibraryLoadResult {
  measurements: RealMeasurement[];
  /** SKUs that have a unit spec row but are missing one or more dimensions. */
  skippedSkus: string[];
}

/** True when `a` is a better unit spec to trust than `b`. */
function isBetterSpec(a: SpecRow, b: SpecRow, preferApproved: boolean): boolean {
  if (preferApproved) {
    const aApproved = a.status === "approved";
    const bApproved = b.status === "approved";
    if (aApproved !== bApproved) return aApproved;
  }
  return (a.version_number ?? 0) > (b.version_number ?? 0);
}

/**
 * Load each SKU's real unit-package measurements from the Library. SKUs whose
 * chosen spec is missing any dimension are reported in `skippedSkus`.
 */
export async function fetchRealMeasurements(): Promise<LibraryLoadResult> {
  const cfg = getProductLibraryConfig();
  if (!cfg) {
    throw new Error(
      "Product Library not configured (PRODUCT_LIBRARY_SUPABASE_URL / _KEY).",
    );
  }

  const client = createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client
    .from("packaging_specs")
    .select(
      "length_cm,width_cm,height_cm,weight_kg,version_number,status,products!inner(sku,asin,fnsku)",
    )
    .eq("spec_type", cfg.unitSpecType);

  if (error) {
    throw new Error(`Product Library read failed: ${error.message}`);
  }

  // Pick the single best unit spec per SKU.
  const bestBySku = new Map<string, SpecRow>();
  for (const row of (data ?? []) as unknown as SpecRow[]) {
    const sku = row.products?.sku?.trim();
    if (!sku) continue;
    const existing = bestBySku.get(sku);
    if (!existing || isBetterSpec(row, existing, cfg.preferApproved)) {
      bestBySku.set(sku, row);
    }
  }

  const measurements: RealMeasurement[] = [];
  const skippedSkus: string[] = [];

  for (const [sku, row] of bestBySku) {
    const length = num(row.length_cm);
    const width = num(row.width_cm);
    const height = num(row.height_cm);
    const weight = num(row.weight_kg);

    if (length == null || width == null || height == null || weight == null) {
      skippedSkus.push(sku);
      continue;
    }

    measurements.push({
      sku,
      lengthCm: length,
      widthCm: width,
      heightCm: height,
      weightKg: weight,
      hazmat: false, // no hazmat flag in this schema yet
      // unitsSold not tracked in the Library — recoverable shown per-unit only.
    });
  }

  return { measurements, skippedSkus };
}

/**
 * Map every SKU in the Library to its product id, so the dashboard can deep-link
 * to /products/{id}?tab=specs — including SKUs that have no packaging spec yet
 * (exactly the ones that need measuring). SKUs absent here don't exist in the
 * Library at all, and the UI falls back to the products list.
 */
export async function fetchProductIndex(): Promise<Record<string, string>> {
  const cfg = getProductLibraryConfig();
  if (!cfg) return {};

  const client = createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.from("products").select("id,sku");
  if (error) throw new Error(`Product Library index read failed: ${error.message}`);

  const index: Record<string, string> = {};
  for (const row of (data ?? []) as { id: string; sku: string | null }[]) {
    const sku = row.sku?.trim();
    if (sku) index[sku.toLowerCase()] = row.id;
  }
  return index;
}

/**
 * SKUs the Library still considers live — everything except `status:'archived'`.
 *
 * The Library keeps archived products so their history survives, and the
 * Products page hides them behind "Show archived". Anything reading the Library
 * as a scope should match what that page shows, or it reports on SKUs the user
 * has explicitly retired.
 */
export async function fetchActiveSkus(): Promise<Set<string>> {
  const cfg = getProductLibraryConfig();
  if (!cfg) return new Set();

  const client = createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.from("products").select("sku,status");
  if (error) throw new Error(`Product Library status read failed: ${error.message}`);

  const active = new Set<string>();
  for (const row of (data ?? []) as { sku: string | null; status: string | null }[]) {
    const sku = row.sku?.trim().toLowerCase();
    if (sku && row.status !== "archived") active.add(sku);
  }
  return active;
}

export interface HazmatFlags {
  /** sku (lowercased) → true when the product is hazmat or contains a battery. */
  flags: Record<string, boolean>;
  /** False when the Library doesn't track hazmat yet (columns absent). */
  available: boolean;
}

/**
 * Read each product's Dangerous Goods classification. Defensive: if the
 * is_hazmat/contains_battery columns don't exist yet (migration not applied),
 * returns available:false so the auditor leaves hazmat detection OFF rather
 * than false-flagging every genuinely-hazmat SKU.
 */
export async function fetchHazmatFlags(): Promise<HazmatFlags> {
  const cfg = getProductLibraryConfig();
  if (!cfg) return { flags: {}, available: false };

  const client = createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.from("products").select("sku,is_hazmat,contains_battery");
  if (error) {
    // Most likely the columns don't exist yet — treat hazmat as untracked.
    return { flags: {}, available: false };
  }

  const flags: Record<string, boolean> = {};
  for (const row of (data ?? []) as unknown as {
    sku: string | null;
    is_hazmat: boolean | null;
    contains_battery: boolean | null;
  }[]) {
    const sku = row.sku?.trim();
    if (sku) flags[sku.toLowerCase()] = Boolean(row.is_hazmat) || Boolean(row.contains_battery);
  }
  return { flags, available: true };
}

/**
 * Map ASIN and FNSKU (both lowercased) to our merchant SKU.
 *
 * Amazon's own exports — sourcing cost, removal orders — are keyed by ASIN or
 * FNSKU, never by the SKU the rest of our tooling uses. The Library carries all
 * three on `products`, so it is the only place that join can be made.
 */
export async function fetchAsinIndex(): Promise<Record<string, string>> {
  const cfg = getProductLibraryConfig();
  if (!cfg) return {};

  const client = createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.from("products").select("sku,asin,fnsku");
  if (error) throw new Error(`Product Library ASIN index read failed: ${error.message}`);

  const index: Record<string, string> = {};
  for (const row of (data ?? []) as {
    sku: string | null;
    asin: string | null;
    fnsku: string | null;
  }[]) {
    const sku = row.sku?.trim();
    if (!sku) continue;
    for (const code of [row.asin, row.fnsku]) {
      const c = code?.trim().toLowerCase();
      if (c) index[c] = sku;
    }
  }
  return index;
}
