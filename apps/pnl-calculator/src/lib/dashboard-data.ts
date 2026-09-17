/**
 * Loads the latest live snapshot per SKU for the /dashboard portfolio view.
 * Joins with the "Product Information" table to enrich with ASIN + name where
 * available. Read-only — dashboard edits stay local and never write back.
 */
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/product";

export interface DashboardRow {
  sku: string;
  asin: string | null;
  productName: string;
  supplier: string | null;
  category: string;
  versionId: string;
  versionName: string;
  versionSavedAt: string;
  versionData: Product;
}

interface RawVersion {
  id: string;
  version_name: string;
  bucket: string;
  created_at: string;
  version_data: Product & Record<string, unknown>;
}

interface RawProductInfoRow {
  ASIN: string | null;
  SKU: string;
  "Product Name": string | null;
  Supplier: string | null;
}

export async function loadDashboardRows(): Promise<DashboardRow[]> {
  // Latest live snapshot per SKU. We pull everything and dedupe in JS because
  // Supabase's PostgREST doesn't expose `distinct on`.
  const { data: rawVersions, error: verErr } = await supabase
    .from("product_versions")
    .select("id, version_name, bucket, created_at, version_data")
    .eq("bucket", "live")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (verErr) throw new Error(`Load live versions failed: ${verErr.message}`);

  const bySku = new Map<string, RawVersion>();
  for (const row of (rawVersions ?? []) as RawVersion[]) {
    const sku = String(row.version_data?.sku ?? "").trim();
    if (!sku) continue;
    if (!bySku.has(sku)) bySku.set(sku, row);
  }

  const skus = Array.from(bySku.keys());
  if (skus.length === 0) return [];

  // Best-effort join to Product Information for ASIN + display name.
  const { data: infoRows } = await supabase
    .from("Product Information")
    .select('ASIN, SKU, "Product Name", Supplier')
    .in("SKU", skus);

  const info = new Map<string, RawProductInfoRow>();
  for (const r of (infoRows ?? []) as RawProductInfoRow[]) {
    info.set(String(r.SKU).trim(), r);
  }

  const rows: DashboardRow[] = skus.map((sku) => {
    const v = bySku.get(sku)!;
    const i = info.get(sku);
    const productName =
      (v.version_data?.name as string | undefined) ||
      (i?.["Product Name"] ?? "") ||
      sku;
    return {
      sku,
      asin: i?.ASIN ?? null,
      productName,
      supplier: i?.Supplier ?? null,
      category: String(v.version_data?.category ?? ""),
      versionId: v.id,
      versionName: v.version_name,
      versionSavedAt: v.created_at,
      versionData: v.version_data as Product,
    };
  });

  rows.sort((a, b) => a.productName.localeCompare(b.productName));
  return rows;
}
