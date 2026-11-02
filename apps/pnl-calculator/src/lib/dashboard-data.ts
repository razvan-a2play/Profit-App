/**
 * Loads every SKU in `Product Information` and left-joins the latest saved
 * snapshot from `product_versions`. Prefers a `bucket='live'` snapshot; falls
 * back to the newest `bucket='rd'` snapshot; if neither exists, the row still
 * appears so the user can see "known SKU, nothing costed yet".
 *
 * Read-only — dashboard edits stay local and never write back.
 */
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/product";

export type VersionStatus = "live" | "rd" | "none";

export interface DashboardRow {
  sku: string;
  asin: string | null;
  productName: string;
  supplier: string | null;
  category: string;
  versionStatus: VersionStatus;
  versionId: string | null;
  versionName: string | null;
  versionSavedAt: string | null;
  /** Null when versionStatus === "none". */
  versionData: Product | null;
}

interface RawVersion {
  id: string;
  version_name: string;
  bucket: "live" | "rd" | string;
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
  // Fetch Product Information + all non-deleted versions in parallel.
  const [infoRes, verRes] = await Promise.all([
    supabase
      .from("Product Information")
      .select('ASIN, SKU, "Product Name", Supplier'),
    supabase
      .from("product_versions")
      .select("id, version_name, bucket, created_at, version_data")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  if (infoRes.error) throw new Error(`Load Product Information failed: ${infoRes.error.message}`);
  if (verRes.error) throw new Error(`Load product_versions failed: ${verRes.error.message}`);

  // Latest live and latest rd per SKU.
  const latestLive = new Map<string, RawVersion>();
  const latestRd = new Map<string, RawVersion>();
  for (const row of (verRes.data ?? []) as RawVersion[]) {
    const sku = String(row.version_data?.sku ?? "").trim();
    if (!sku) continue;
    if (row.bucket === "live" && !latestLive.has(sku)) latestLive.set(sku, row);
    else if (row.bucket === "rd" && !latestRd.has(sku)) latestRd.set(sku, row);
  }

  const infoRows = (infoRes.data ?? []) as RawProductInfoRow[];

  // Also include any SKUs that have a saved version but aren't in Product
  // Information (so nothing silently disappears from the earlier V1 view).
  const infoSkus = new Set(infoRows.map((r) => String(r.SKU).trim()).filter(Boolean));
  const extraSkus = new Set<string>();
  for (const sku of [...latestLive.keys(), ...latestRd.keys()]) {
    if (!infoSkus.has(sku)) extraSkus.add(sku);
  }

  const rows: DashboardRow[] = [];

  for (const info of infoRows) {
    const sku = String(info.SKU).trim();
    if (!sku) continue;
    rows.push(buildRow(sku, info, latestLive.get(sku), latestRd.get(sku)));
  }
  for (const sku of extraSkus) {
    rows.push(buildRow(sku, null, latestLive.get(sku), latestRd.get(sku)));
  }

  rows.sort((a, b) => {
    // Live first, then rd, then none; within a group alphabetical by name.
    const rank = (s: VersionStatus) => (s === "live" ? 0 : s === "rd" ? 1 : 2);
    const d = rank(a.versionStatus) - rank(b.versionStatus);
    if (d !== 0) return d;
    return a.productName.localeCompare(b.productName);
  });

  return rows;
}

function buildRow(
  sku: string,
  info: RawProductInfoRow | null,
  live: RawVersion | undefined,
  rd: RawVersion | undefined,
): DashboardRow {
  const picked = live ?? rd ?? null;
  const status: VersionStatus = live ? "live" : rd ? "rd" : "none";
  const productName =
    (picked?.version_data?.name as string | undefined) ||
    info?.["Product Name"] ||
    sku;
  return {
    sku,
    asin: info?.ASIN ?? null,
    productName,
    supplier: info?.Supplier ?? null,
    category: String(picked?.version_data?.category ?? ""),
    versionStatus: status,
    versionId: picked?.id ?? null,
    versionName: picked?.version_name ?? null,
    versionSavedAt: picked?.created_at ?? null,
    versionData: (picked?.version_data as Product) ?? null,
  };
}
