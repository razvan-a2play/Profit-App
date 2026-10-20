// Pulls per-SKU manufacturing cost from the PNL calculator's Supabase.
//
// The PNL app persists each saved version to `product_versions.version_data`
// (a JSON blob matching its `Product` type). Manufacturing cost is the sum of
// the same four lines the app totals in "Total Manufacturing Cost":
//
//   cost x costQuantity                       (product cost)
// + retailBoxCost x retailBoxCostQuantity     (box)
// + cardCost x cardCostQuantity               (warranty card)
// + userManualCost x userManualCostQuantity   (manual)
// + sum(additionalCosts[].value x quantity)
//
// `product_versions` is RLS-protected, so this needs the PNL project's
// SERVICE_ROLE key — set PNL_SUPABASE_URL and PNL_SUPABASE_SERVICE_ROLE_KEY.
// Without them we return a clear "not configured" result rather than failing.

import { createClient } from "@supabase/supabase-js";

export interface PnlManufacturingRow {
  sku: string;
  manufacturing: number;
  sellingPrice: number | null;
  versionName: string | null;
  updatedAt: string | null;
}

export interface PnlResult {
  ok: boolean;
  configured: boolean;
  error?: string;
  rows: PnlManufacturingRow[];
}

interface AdditionalCost {
  value?: number | null;
  quantity?: number | null;
}

interface ProductBlob {
  sku?: string | null;
  sellingPrice?: number | null;
  cost?: number | null;
  costQuantity?: number | null;
  retailBoxCost?: number | null;
  retailBoxCostQuantity?: number | null;
  cardCost?: number | null;
  cardCostQuantity?: number | null;
  userManualCost?: number | null;
  userManualCostQuantity?: number | null;
  additionalCosts?: AdditionalCost[] | null;
}

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
};
const qty = (v: unknown): number => {
  const x = n(v);
  return x > 0 ? x : 1;
};

/** Mirror of the PNL app's "Total Manufacturing Cost" line. */
export function manufacturingTotal(p: ProductBlob): number {
  let total =
    n(p.cost) * qty(p.costQuantity) +
    n(p.retailBoxCost) * qty(p.retailBoxCostQuantity) +
    n(p.cardCost) * qty(p.cardCostQuantity) +
    n(p.userManualCost) * qty(p.userManualCostQuantity);
  for (const a of p.additionalCosts ?? []) total += n(a?.value) * qty(a?.quantity);
  return Math.round(total * 10000) / 10000;
}

export function isPnlConfigured(): boolean {
  return !!(process.env.PNL_SUPABASE_URL && process.env.PNL_SUPABASE_SERVICE_ROLE_KEY);
}

export async function fetchPnlManufacturing(): Promise<PnlResult> {
  const url = process.env.PNL_SUPABASE_URL;
  const key = process.env.PNL_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return {
      ok: false,
      configured: false,
      error:
        "PNL Supabase not configured. Add PNL_SUPABASE_URL and PNL_SUPABASE_SERVICE_ROLE_KEY to .env.local.",
      rows: [],
    };
  }

  try {
    const sb = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb
      .from("product_versions")
      .select("product_id, version_name, version_data, created_at, updated_at, deleted_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw error;

    // Newest version per SKU wins.
    const bySku = new Map<string, PnlManufacturingRow>();
    for (const row of (data ?? []) as {
      version_name: string | null;
      version_data: ProductBlob | null;
      created_at: string | null;
      updated_at: string | null;
    }[]) {
      const blob = row.version_data;
      const sku = (blob?.sku ?? "").trim();
      if (!sku) continue;
      const key2 = sku.toLowerCase();
      if (bySku.has(key2)) continue; // already have a newer version
      const manufacturing = manufacturingTotal(blob ?? {});
      if (manufacturing <= 0) continue;
      bySku.set(key2, {
        sku,
        manufacturing,
        sellingPrice: blob?.sellingPrice ?? null,
        versionName: row.version_name,
        updatedAt: row.updated_at ?? row.created_at,
      });
    }

    return { ok: true, configured: true, rows: [...bySku.values()].sort((a, b) => a.sku.localeCompare(b.sku)) };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: err instanceof Error ? err.message : String(err),
      rows: [],
    };
  }
}
