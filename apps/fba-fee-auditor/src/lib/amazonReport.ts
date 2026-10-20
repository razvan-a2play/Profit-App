// Thin server-side client for the seller-central-api SP-API gateway. It owns
// the GET_FBA_ESTIMATED_FBA_FEES report lifecycle: request → poll → fetch the
// parsed per-SKU rows (Amazon's measured dims, weight, size tier, charged fee).

import type { AmazonMeasuredRow } from "@platform/calc";
import { getSellerCentralConfig } from "./env";

/** Shape of one parsed row returned by GET /reports/{id}/fba-fees. */
interface FeesRowDto {
  sku: string;
  fnsku?: string;
  asin?: string;
  product_name?: string;
  your_price?: number | null;
  longest_side?: number | null;
  median_side?: number | null;
  shortest_side?: number | null;
  length_and_girth?: number | null;
  unit_of_dimension?: string;
  item_package_weight?: number | null;
  unit_of_weight?: string;
  product_size_tier?: string;
  currency?: string;
  estimated_fee_total?: number | null;
  expected_fulfillment_fee?: number | null;
  estimated_referral_fee?: number | null;
}

function sca() {
  const cfg = getSellerCentralConfig();
  if (!cfg) throw new Error("Seller-central API not configured (SELLER_CENTRAL_API_URL / _API_KEY).");
  return cfg;
}

async function scaFetch(path: string, init?: RequestInit) {
  const cfg = sca();
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    ...init,
    headers: { "X-API-Key": cfg.apiKey, ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`seller-central-api ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** Ask Amazon to generate a fresh fba_fees report. Returns the reportId. */
export async function requestFeesReport(): Promise<string> {
  const out = await scaFetch(`/reports/?report_type=fba_fees`, { method: "POST" });
  return out.reportId as string;
}

interface ReportListItem {
  reportId: string;
  processingStatus?: string;
  createdTime?: string;
  dataEndTime?: string;
}

/**
 * Find the newest already-finished fba_fees report, so we can audit against it
 * instead of requesting a new one. Amazon rate-limits this report type to
 * roughly one successful generation per several hours — reusing the latest DONE
 * report makes "Run live audit" work instantly and avoids FATAL throttling.
 */
export async function findLatestDoneReportId(): Promise<string | null> {
  const list = (await scaFetch(`/reports/?report_type=fba_fees`)) as ReportListItem[];
  const done = (Array.isArray(list) ? list : []).filter((r) => r.processingStatus === "DONE");
  if (done.length === 0) return null;
  // Newest first by created/data time; fall back to list order (Amazon returns
  // newest first) when timestamps are absent.
  done.sort((a, b) => (b.createdTime ?? b.dataEndTime ?? "").localeCompare(a.createdTime ?? a.dataEndTime ?? ""));
  return done[0].reportId;
}

export interface ReportStatus {
  reportId: string;
  processingStatus?: string;
  reportDocumentId?: string;
}

export async function getReportStatus(reportId: string): Promise<ReportStatus> {
  return scaFetch(`/reports/${encodeURIComponent(reportId)}`);
}

export interface FeesRowsResult {
  ready: boolean;
  status?: string;
  rows: AmazonMeasuredRow[];
}

/**
 * Fetch the finished report and map it onto the audit engine's input type.
 *
 * Amazon's fee report returns a row PER MARKETPLACE the offer exists in — so one
 * SKU can appear several times (e.g. an EU "Standard" row in cm/grams alongside
 * a US "UsLargeStandardSize" row in inches/pounds). The audit engine compares
 * dimensions in inches against your real box, so we keep only the US (inch) rows
 * and collapse to one row per SKU (the one with the highest fulfilment fee, which
 * is the standard fulfilment offer rather than a remote/secondary program).
 */
export async function fetchFeesRows(reportId: string): Promise<FeesRowsResult> {
  const out = await scaFetch(`/reports/${encodeURIComponent(reportId)}/fba-fees`);
  if (!out.ready) return { ready: false, status: out.status, rows: [] };

  const isInches = (u?: string) => (u ?? "").toLowerCase().startsWith("inch");

  const bySku = new Map<string, AmazonMeasuredRow>();
  for (const r of out.rows as FeesRowDto[]) {
    if (!isInches(r.unit_of_dimension)) continue; // non-US marketplace row — skip
    const sku = (r.sku ?? "").trim();
    if (!sku) continue;

    const row: AmazonMeasuredRow = {
      sku,
      asin: r.asin || undefined,
      productName: r.product_name || undefined,
      yourPrice: r.your_price ?? null,
      longestSide: r.longest_side ?? null,
      medianSide: r.median_side ?? null,
      shortestSide: r.shortest_side ?? null,
      unitOfDimension: r.unit_of_dimension || "inches",
      itemPackageWeight: r.item_package_weight ?? null,
      unitOfWeight: r.unit_of_weight || "pounds",
      productSizeTier: r.product_size_tier || undefined,
      expectedFulfillmentFee: r.expected_fulfillment_fee ?? null,
      currency: r.currency || "USD",
    };

    const existing = bySku.get(sku.toLowerCase());
    if (!existing || (row.expectedFulfillmentFee ?? 0) > (existing.expectedFulfillmentFee ?? 0)) {
      bySku.set(sku.toLowerCase(), row);
    }
  }

  return { ready: true, status: out.status, rows: [...bySku.values()] };
}
