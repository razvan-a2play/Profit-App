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

export type VersionStatus = "live" | "rd" | "h10-only" | "none";

export interface Helium10Cogs {
  productCost: number | null;
  shippingCost: number | null;
  tariffs: number | null;
  totalCogs: number | null;
  currency: string | null;
  startsAt: string | null;
  endsAt: string | null;
  fetchedAt: string | null;
}

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
  /** Helium10 Profits snapshot — null when no row in helium10_cogs. */
  helium10: Helium10Cogs | null;
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
}

interface RawHelium10Row {
  sku: string;
  asin: string | null;
  product_cost: string | number | null;
  shipping_cost: string | number | null;
  tariffs: string | number | null;
  total_cogs: string | number | null;
  currency: string | null;
  starts_at: string | null;
  ends_at: string | null;
  fetched_at: string | null;
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export async function loadDashboardRows(): Promise<DashboardRow[]> {
  // Fetch Product Information + all non-deleted versions + helium10 COGS in parallel.
  const [infoRes, verRes, h10Res] = await Promise.all([
    supabase
      .from("Product Information")
      .select(
        'ASIN, SKU, "Product Name", Supplier, Category,' +
          '"Product box Length", "Product box Width", "Product box Height", "Product box weight (kg)",' +
          '"Carton Length", "Carton Width", "Carton Height", "Carton weight", "Units/carton"',
      ),
    supabase
      .from("product_versions")
      .select("id, version_name, bucket, created_at, version_data")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("helium10_cogs")
      .select(
        "sku, asin, product_cost, shipping_cost, tariffs, total_cogs, currency, starts_at, ends_at, fetched_at",
      ),
  ]);

  if (infoRes.error) throw new Error(`Load Product Information failed: ${infoRes.error.message}`);
  if (verRes.error) throw new Error(`Load product_versions failed: ${verRes.error.message}`);
  // helium10 table may not exist yet (migration not run) — don't block the dashboard on it.
  const h10Rows = h10Res.error ? [] : ((h10Res.data ?? []) as RawHelium10Row[]);
  const h10BySku = new Map<string, RawHelium10Row>();
  for (const r of h10Rows) h10BySku.set(String(r.sku).trim(), r);

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

  // Pick a template of global fees from the newest live snapshot so synthetic
  // (H10-only) rows inherit sensible defaults for cbmCost / storage / etc.
  const feeTemplate = pickFeeTemplate(latestLive);

  const rows: DashboardRow[] = [];

  for (const info of infoRows) {
    const sku = String(info.SKU).trim();
    if (!sku) continue;
    rows.push(buildRow(sku, info, latestLive.get(sku), latestRd.get(sku), h10BySku.get(sku), feeTemplate));
  }
  for (const sku of extraSkus) {
    rows.push(buildRow(sku, null, latestLive.get(sku), latestRd.get(sku), h10BySku.get(sku), feeTemplate));
  }

  rows.sort((a, b) => {
    // Live > rd > h10-only > none; within a group alphabetical by name.
    const rank = (s: VersionStatus) =>
      s === "live" ? 0 : s === "rd" ? 1 : s === "h10-only" ? 2 : 3;
    const d = rank(a.versionStatus) - rank(b.versionStatus);
    if (d !== 0) return d;
    return a.productName.localeCompare(b.productName);
  });

  return rows;
}

type FeeTemplate = Partial<Product>;

const AMAZON_CATEGORY_KEYWORDS: Array<[string, string]> = [
  ["toy", "toys and games"],
  ["game", "toys and games"],
  ["bath", "toys and games"],
  ["splash", "toys and games"],
  ["pool", "toys and games"],
  ["puzzle", "toys and games"],
  ["baby", "baby products"],
  ["infant", "baby products"],
  ["lounger", "baby products"],
  ["chair", "baby products"],
  ["home", "home and garden"],
  ["garden", "home and garden"],
];

function guessAmazonCategory(info: RawProductInfoRow | null, productName: string): string {
  const hay = `${info?.Category ?? ""} ${productName}`.toLowerCase();
  for (const [kw, cat] of AMAZON_CATEGORY_KEYWORDS) {
    if (hay.includes(kw)) return cat;
  }
  return "toys and games"; // sensible default for this catalog
}

function pickFeeTemplate(latestLive: Map<string, RawVersion>): FeeTemplate {
  // Prefer the most recently saved live version; its global fees are
  // representative. Fall back to hardcoded defaults when nothing is live.
  let best: RawVersion | null = null;
  for (const v of latestLive.values()) {
    if (!best || v.created_at > best.created_at) best = v;
  }
  const vd = (best?.version_data ?? {}) as Partial<Product>;
  return {
    cbmCost: vd.cbmCost ?? 240,
    shippingToAWD: vd.shippingToAWD ?? 240,
    awdCaseReceiveCost: vd.awdCaseReceiveCost ?? 2.7,
    awdTransportationCost: vd.awdTransportationCost ?? 1.15,
    amazonFBAStorageFeeNonPeak: vd.amazonFBAStorageFeeNonPeak ?? 0.78,
    amazonFBAStorageFeePeak: vd.amazonFBAStorageFeePeak ?? 2.4,
    amazonAWDStorageFee: vd.amazonAWDStorageFee ?? 0.48,
    amazonFBAAVGFee: vd.amazonFBAAVGFee ?? 1.185,
    storageMonths: vd.storageMonths ?? 1,
    estimatedReturnsPercentage: vd.estimatedReturnsPercentage ?? 5,
    marketingTacosPercentage: vd.marketingTacosPercentage ?? 15,
    fulfillmentMethod: vd.fulfillmentMethod ?? "100% FBA",
  };
}

function synthesizeFromH10(
  sku: string,
  info: RawProductInfoRow | null,
  h10: RawHelium10Row,
  feeTemplate: FeeTemplate,
): Product {
  const productName = info?.["Product Name"] ?? h10.sku ?? sku;
  const category = guessAmazonCategory(info, productName);
  return {
    id: 0,
    name: productName,
    status: "Active",
    sku,
    cost: num(h10.product_cost) ?? num(h10.total_cogs) ?? 0,
    costQuantity: 1,
    retailBoxCost: undefined,
    retailBoxCostQuantity: undefined,
    cardCost: undefined,
    cardCostQuantity: undefined,
    userManualCost: undefined,
    userManualCostQuantity: undefined,
    additionalCosts: [],
    sellingPrice: 0,
    category,
    length: num(info?.["Product box Length"]) ?? 0,
    width: info?.["Product box Width"] ?? 0,
    height: info?.["Product box Height"] ?? 0,
    weight: info?.["Product box weight (kg)"] ?? 0,
    masterCartonLength: num(info?.["Carton Length"]) ?? 0,
    masterCartonWidth: info?.["Carton Width"] ?? 0,
    masterCartonHeight: info?.["Carton Height"] ?? 0,
    masterCartonUnits: info?.["Units/carton"] ?? 0,
    masterCartonWeight: info?.["Carton weight"] ?? 0,
    marketingTacos: 0,
    marketingTacosPercentage: feeTemplate.marketingTacosPercentage ?? 15,
    marketingAffiliatePercentage: 5,
    marketingAffiliateDollar: 0,
    marketingAdsPercentage: 7,
    marketingAdsDollar: 0,
    fulfillmentMethod: feeTemplate.fulfillmentMethod ?? "100% FBA",
    storageMonths: feeTemplate.storageMonths ?? 1,
    estimatedReturnsPercentage: feeTemplate.estimatedReturnsPercentage ?? 5,
    cbmCost: feeTemplate.cbmCost ?? 240,
    shippingToAWD: feeTemplate.shippingToAWD ?? 240,
    awdCaseReceiveCost: feeTemplate.awdCaseReceiveCost ?? 2.7,
    awdTransportationCost: feeTemplate.awdTransportationCost ?? 1.15,
    amazonFBAStorageFeeNonPeak: feeTemplate.amazonFBAStorageFeeNonPeak ?? 0.78,
    amazonFBAStorageFeePeak: feeTemplate.amazonFBAStorageFeePeak ?? 2.4,
    amazonAWDStorageFee: feeTemplate.amazonAWDStorageFee ?? 0.48,
    amazonFBAAVGFee: feeTemplate.amazonFBAAVGFee ?? 1.185,
    hazmatStorageFeeNonPeak: 0.99,
    hazmatStorageFeePeak: 3.63,
    hazmatOversizeStorageFeeNonPeak: 0.78,
    hazmatOversizeStorageFeePeak: 2.43,
    shopifyRoas: 0,
    shopifyCpa: 0,
    shopifyAgencyPercentage: 8,
    shopifyCreativePercentage: 7,
    shopifyTransactionFeePercentage: 3,
    shopifyReturnsPercentage: 5,
    productInfoDescription: "",
    factoryPriceDescription: "",
    dimensionsDescription: "",
    productCostLabel: "",
    retailBoxCostLabel: "",
    cardCostLabel: "",
    userManualCostLabel: "",
    productCostVisible: true,
    retailBoxCostVisible: true,
    cardCostVisible: true,
    userManualCostVisible: true,
    notes: "",
    sippEligibleOverride: true,
    hazmat: false,
    containsBatteries: false,
    savedVersions: [],
  };
}

function buildRow(
  sku: string,
  info: RawProductInfoRow | null,
  live: RawVersion | undefined,
  rd: RawVersion | undefined,
  h10: RawHelium10Row | undefined,
  feeTemplate: FeeTemplate,
): DashboardRow {
  const picked = live ?? rd ?? null;
  let status: VersionStatus = live ? "live" : rd ? "rd" : "none";
  const productName =
    (picked?.version_data?.name as string | undefined) ||
    info?.["Product Name"] ||
    sku;

  let versionData: Product | null = (picked?.version_data as Product) ?? null;

  // If no live/rd version but we have H10 COGS, synthesize a Product so the
  // dashboard can still compute referral/FBA/margin with sensible defaults.
  if (!versionData && h10) {
    versionData = synthesizeFromH10(sku, info, h10, feeTemplate);
    status = "h10-only";
  }

  return {
    sku,
    asin: info?.ASIN ?? h10?.asin ?? null,
    productName,
    supplier: info?.Supplier ?? null,
    category: versionData?.category ?? "",
    versionStatus: status,
    versionId: picked?.id ?? null,
    versionName: picked?.version_name ?? null,
    versionSavedAt: picked?.created_at ?? null,
    versionData,
    helium10: h10
      ? {
          productCost: num(h10.product_cost),
          shippingCost: num(h10.shipping_cost),
          tariffs: num(h10.tariffs),
          totalCogs: num(h10.total_cogs),
          currency: h10.currency,
          startsAt: h10.starts_at,
          endsAt: h10.ends_at,
          fetchedAt: h10.fetched_at,
        }
      : null,
  };
}
