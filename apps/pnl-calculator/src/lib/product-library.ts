/**
 * Product Library (the supply-chain app's catalog, its own Supabase project)
 * as a product source for the P&L. The server route /api/library-products
 * reads it; this file holds the shared shapes and the pure helpers both sides
 * use. No browser or server imports here.
 *
 * The P&L's own `Product Information` table is an old CSV import, so it lacks
 * every product added to the Library since. The merge keeps that table's rows
 * as they are (their dims feed saved P&Ls) and adds each Library product it
 * doesn't have.
 */

export interface LibraryBox {
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  weightKg: number | null;
}

export interface LibraryProduct {
  /** Model No. (products.sku). */
  sku: string;
  name: string;
  /** Library status: draft | ready (archived products are left out). */
  status: string;
  asin: string | null;
  unit: LibraryBox | null;
  carton: (LibraryBox & { units: number | null }) | null;
  hazmat: boolean;
  containsBattery: boolean;
}

export type LibraryLoad =
  | { state: "ok"; products: LibraryProduct[] }
  | { state: "not-configured" }
  | { state: "error"; message: string };

/** Row shape of the P&L's `Product Information` table, plus Library extras. */
export interface ProductInfoLike {
  ASIN: string | null;
  SKU: string;
  "Product Name": string | null;
  Supplier: string | null;
  Category: string | null;
  "Product box Length": string | number | null;
  "Product box Width": number | null;
  "Product box Height": number | null;
  "Product box weight (kg)": number | null;
  "Carton Length": string | number | null;
  "Carton Width": number | null;
  "Carton Height": number | null;
  "Carton weight": number | null;
  "Units/carton": number | null;
  /** Set when the product is in the Product Library. */
  libraryStatus?: string;
  hazmat?: boolean;
  containsBatteries?: boolean;
}

export interface SpecRow {
  sku_id: string;
  spec_type: string;
  status: string | null;
  version_number: number | null;
  length_cm: number | string | null;
  width_cm: number | string | null;
  height_cm: number | string | null;
  weight_kg: number | string | null;
  units_per_carton: number | string | null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** The spec to trust: approved first, then the highest version (as the Fee Auditor does). */
export function pickBestSpec(specs: SpecRow[]): SpecRow | null {
  let best: SpecRow | null = null;
  for (const s of specs) {
    if (!best) {
      best = s;
      continue;
    }
    const a = s.status === "approved";
    const b = best.status === "approved";
    if (a !== b) {
      if (a) best = s;
      continue;
    }
    if ((s.version_number ?? 0) > (best.version_number ?? 0)) best = s;
  }
  return best;
}

export function specToBox(s: SpecRow | null): LibraryBox | null {
  if (!s) return null;
  return {
    lengthCm: num(s.length_cm),
    widthCm: num(s.width_cm),
    heightCm: num(s.height_cm),
    weightKg: num(s.weight_kg),
  };
}

export function specToCarton(s: SpecRow | null): LibraryProduct["carton"] {
  const box = specToBox(s);
  return box && { ...box, units: num(s!.units_per_carton) };
}

const key = (sku: string) => sku.trim().toLowerCase();

export function libraryProductToInfo(p: LibraryProduct): ProductInfoLike {
  return {
    ASIN: p.asin,
    SKU: p.sku,
    "Product Name": p.name,
    Supplier: null,
    Category: null,
    "Product box Length": p.unit?.lengthCm ?? null,
    "Product box Width": p.unit?.widthCm ?? null,
    "Product box Height": p.unit?.heightCm ?? null,
    "Product box weight (kg)": p.unit?.weightKg ?? null,
    "Carton Length": p.carton?.lengthCm ?? null,
    "Carton Width": p.carton?.widthCm ?? null,
    "Carton Height": p.carton?.heightCm ?? null,
    "Carton weight": p.carton?.weightKg ?? null,
    "Units/carton": p.carton?.units ?? null,
    libraryStatus: p.status,
    hazmat: p.hazmat,
    containsBatteries: p.containsBattery,
  };
}

/**
 * Every P&L product row as it is (filling only a missing ASIN or name from the
 * Library), plus one row per Library product the P&L table doesn't have.
 */
export function mergeLibraryProducts<T extends ProductInfoLike>(
  rows: T[],
  library: LibraryProduct[],
): { rows: Array<T | ProductInfoLike>; added: string[] } {
  const bySku = new Map(library.map((p) => [key(p.sku), p]));
  const seen = new Set<string>();
  const merged: Array<T | ProductInfoLike> = rows.map((r) => {
    const k = key(String(r.SKU ?? ""));
    seen.add(k);
    const lib = bySku.get(k);
    if (!lib) return r;
    return {
      ...r,
      ASIN: r.ASIN || lib.asin,
      "Product Name": r["Product Name"] || lib.name,
      libraryStatus: lib.status,
      hazmat: r.hazmat ?? lib.hazmat,
      containsBatteries: r.containsBatteries ?? lib.containsBattery,
    };
  });
  const added: string[] = [];
  for (const p of library) {
    if (seen.has(key(p.sku))) continue;
    seen.add(key(p.sku));
    merged.push(libraryProductToInfo(p));
    added.push(p.sku);
  }
  return { rows: merged, added };
}
