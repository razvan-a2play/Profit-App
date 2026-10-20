// Thin server-side client for Amazon Stranded + Unfulfillable inventory reports.
// Same shape/pattern as amazonReport.ts: request → reuse-latest-DONE → parse.

import { getSellerCentralConfig } from "./env";

export interface StrandedRow {
  sku: string;
  asin: string | null;
  fnsku: string | null;
  productName: string | null;
  condition: string | null;
  reason: string | null;
  strandedSince: string | null;
  /** Date Amazon will auto-remove this inventory if not fixed (MM/DD/YYYY). */
  autoRemovalDate: string | null;
  /** Amazon's suggested fix action (e.g. "OneClickRelist"). */
  primaryAction: string | null;
  /** Total FBA units affected by the stranded listing. */
  quantity: number | null;
  fulfillableQty: number;
  unfulfillableQty: number;
  reservedQty: number;
  inboundQty: number;
  yourPrice: number | null;
}

export interface AgedRow {
  sku: string;
  asin: string | null;
  productName: string | null;
  yourPrice: number | null;
  age0_90: number;
  age91_180: number;
  age181_270: number;
  age271_330: number;
  age331_365: number;
  age365Plus: number;
  totalUnits: number;
  /** Units aged >= 181 days — Amazon is already charging LTSF on these. */
  ltsfActiveUnits: number;
  /** Units aged >= 91 days — LTSF-risk before 181-day fee kicks in. */
  ltsfRiskUnits: number;
  /**
   * Amazon's OWN estimate of next month's aged-inventory surcharge for this
   * SKU, summed across its eight tiers. Authoritative: the surcharge is priced
   * per cubic foot, so it cannot be recovered from unit counts alone.
   */
  aisMonthly: number;
  /**
   * Units Amazon will charge at the NEXT charge date — including ones still
   * under 181 days today that cross before then. This is Amazon's own answer
   * to "will these tip into the next threshold", so it can exceed the aged
   * buckets above.
   */
  aisUnits: number;
  /** Cubic feet per unit, for projecting what the 91-180 bucket will cost. */
  itemVolumeCuFt: number | null;
  unitsShippedT30: number;
  unitsShippedT90: number;
  daysOfSupply: number | null;
}

export interface PlanningRow {
  sku: string;
  asin: string | null;
  productName: string | null;
  yourPrice: number | null;
  daysOfSupply: number | null;
  excessUnits: number;
  totalUnits: number;
}

export interface UnfulfillableRow {
  sku: string;
  asin: string | null;
  fnsku: string | null;
  productName: string | null;
  condition: string | null;
  yourPrice: number | null;
  unsellableTotal: number;
  warehouseDamaged: number;
  customerDamaged: number;
  distributorDamaged: number;
  defective: number;
  expired: number;
  carrierDamaged: number;
  /** True when bucket detail came from adjustments data; false = totals-only. */
  bucketsFromAdjustments?: boolean;
  reimbursableTotal?: number;
  nonReimbursableTotal?: number;
  reimbursableUsd?: number;
  /** Oldest age-bucket where the SKU has any inventory (context for LTSF risk). */
  oldestAgeBucket?: string | null;
}

interface StrandedDto {
  sku: string;
  asin?: string;
  fnsku?: string;
  product_name?: string;
  condition?: string;
  stranded_reason?: string;
  stranded_since?: string;
  auto_removal_date?: string;
  primary_action?: string;
  quantity?: number | null;
  fulfillable_qty?: number;
  unfulfillable_qty?: number;
  reserved_qty?: number;
  inbound_qty?: number;
  your_price?: number | null;
}

export interface AgedResult {
  ready: boolean;
  status?: string;
  reportId: string | null;
  dataAsOf: string | null;
  stale: boolean;
  rows: AgedRow[];
}

export interface PlanningResult {
  ready: boolean;
  status?: string;
  reportId: string | null;
  dataAsOf: string | null;
  stale: boolean;
  rows: PlanningRow[];
}

interface AgedDto {
  sku: string;
  asin?: string;
  product_name?: string;
  your_price?: number | null;
  age_0_90: number;
  age_91_180: number;
  age_181_270: number;
  age_271_330: number;
  age_331_365: number;
  age_365_plus: number;
  total_units: number;
  ltsf_active_units: number;
  ltsf_risk_units: number;
  ais_monthly?: number;
  ais_units?: number;
  item_volume_cuft?: number | null;
  units_shipped_t30?: number;
  units_shipped_t90?: number;
  days_of_supply?: number | null;
  sell_through?: number | null;
}

interface PlanningDto {
  sku: string;
  asin?: string;
  product_name?: string;
  your_price?: number | null;
  days_of_supply?: number | null;
  excess_units: number;
  total_units: number;
}

export async function fetchAged(): Promise<AgedResult> {
  try {
    const inner = await _fetchAgedInner();
    if (inner.ready) writeCache("aged", inner);
    else {
      const cached = readCache<AgedResult>("aged");
      if (cached) return cached;
    }
    return inner;
  } catch (err) {
    const cached = readCache<AgedResult>("aged");
    if (cached) return cached;
    throw err;
  }
}

async function _fetchAgedInner(): Promise<AgedResult> {
  const latest = await findLatestDone("fba_aged");
  let reportId: string;
  let dataAsOf: string | null;
  let stale = false;
  if (!latest) {
    reportId = await requestReport("fba_aged");
    dataAsOf = null;
    lastKnown.set("fba_aged", { reportId, createdTime: null });
  } else {
    reportId = latest.reportId;
    dataAsOf = latest.createdTime;
    stale = latest.stale;
    if (stale) requestFreshInBackground("fba_aged");
  }
  const out = await scaFetch(`/reports/${encodeURIComponent(reportId)}/aged`);
  if (!out.ready) return { ready: false, status: out.status, reportId, dataAsOf, stale, rows: [] };
  const rows: AgedRow[] = (out.rows as AgedDto[]).map((r) => ({
    sku: (r.sku ?? "").trim(),
    asin: r.asin || null,
    productName: r.product_name || null,
    yourPrice: r.your_price ?? null,
    age0_90: r.age_0_90,
    age91_180: r.age_91_180,
    age181_270: r.age_181_270,
    age271_330: r.age_271_330,
    age331_365: r.age_331_365,
    age365Plus: r.age_365_plus,
    totalUnits: r.total_units,
    ltsfActiveUnits: r.ltsf_active_units,
    ltsfRiskUnits: r.ltsf_risk_units,
    aisMonthly: r.ais_monthly ?? 0,
    aisUnits: r.ais_units ?? 0,
    itemVolumeCuFt: r.item_volume_cuft ?? null,
    unitsShippedT30: r.units_shipped_t30 ?? 0,
    unitsShippedT90: r.units_shipped_t90 ?? 0,
    daysOfSupply: r.days_of_supply ?? null,
  }));
  lastKnown.set("fba_aged", { reportId, createdTime: dataAsOf });
  return { ready: true, status: out.status, reportId, dataAsOf, stale, rows };
}

export interface AdjustmentBuckets {
  warehouseDamaged: number;
  carrierDamaged: number;
  distributorDamaged: number;
  customerDamaged: number;
  defective: number;
  expired: number;
  reimbursableTotal: number;
  nonReimbursableTotal: number;
}

/**
 * SKU → damage buckets from GET_FBA_INVENTORY_ADJUSTMENTS_DATA (~18mo of
 * adjustment events, aligned with reimbursement claim window). Empty object
 * if the report can't be fetched (returned defensively so unfulfillable view
 * still renders — just without bucket detail).
 */
export async function fetchAdjustmentBuckets(): Promise<Record<string, AdjustmentBuckets>> {
  const cached = readCache<Record<string, AdjustmentBuckets>>("adjustments");
  if (cached && Object.keys(cached).length > 0) return cached;
  const result = await _fetchAdjustmentBucketsInner();
  if (Object.keys(result).length > 0) writeCache("adjustments", result);
  return result;
}

async function _fetchAdjustmentBucketsInner(): Promise<Record<string, AdjustmentBuckets>> {
  try {
    // The adjustments buckets come from the LEDGER_DETAIL_VIEW report — the
    // same underlying Amazon report as `fba_received`. Reuse either cache
    // (or the previous fba_adjustments request) so we don't kick off a
    // redundant ledger report on every reload.
    let latest = await findLatestDone("fba_adjustments");
    if (!latest) {
      const alt = lastKnown.get("fba_received") ?? lastKnown.get("fba_adjustments");
      if (alt) latest = { reportId: alt.reportId, createdTime: alt.createdTime, stale: false };
    }
    let reportId: string;
    if (latest) {
      reportId = latest.reportId;
    } else {
      reportId = await requestReport("fba_adjustments");
      // Cache the pending reportId so the next reload polls IT instead of
      // requesting yet another ledger report.
      lastKnown.set("fba_adjustments", { reportId, createdTime: null });
    }
    const out = (await scaFetch(
      `/reports/${encodeURIComponent(reportId)}/adjustments-buckets`,
    )) as {
      ready: boolean;
      skus?: Record<
        string,
        {
          warehouse_damaged: number;
          carrier_damaged: number;
          distributor_damaged: number;
          customer_damaged: number;
          defective: number;
          expired: number;
          reimbursable_total: number;
          non_reimbursable_total: number;
        }
      >;
    };
    if (!out.ready || !out.skus) return {};
    lastKnown.set("fba_adjustments", { reportId, createdTime: latest?.createdTime ?? null });
    const norm: Record<string, AdjustmentBuckets> = {};
    for (const [sku, b] of Object.entries(out.skus)) {
      norm[sku.trim().toLowerCase()] = {
        warehouseDamaged: b.warehouse_damaged,
        carrierDamaged: b.carrier_damaged,
        distributorDamaged: b.distributor_damaged,
        customerDamaged: b.customer_damaged,
        defective: b.defective,
        expired: b.expired,
        reimbursableTotal: b.reimbursable_total,
        nonReimbursableTotal: b.non_reimbursable_total,
      };
    }
    return norm;
  } catch (err) {
    console.warn("fetchAdjustmentBuckets failed:", err);
    return {};
  }
}

export async function fetchPlanning(): Promise<PlanningResult> {
  const latest = await findLatestDone("fba_planning");
  let reportId: string;
  let dataAsOf: string | null;
  let stale = false;
  if (!latest) {
    reportId = await requestReport("fba_planning");
    dataAsOf = null;
    lastKnown.set("fba_planning", { reportId, createdTime: null });
  } else {
    reportId = latest.reportId;
    dataAsOf = latest.createdTime;
    stale = latest.stale;
    if (stale) requestFreshInBackground("fba_planning");
  }
  const out = await scaFetch(`/reports/${encodeURIComponent(reportId)}/planning`);
  if (!out.ready) return { ready: false, status: out.status, reportId, dataAsOf, stale, rows: [] };
  const rows: PlanningRow[] = (out.rows as PlanningDto[]).map((r) => ({
    sku: (r.sku ?? "").trim(),
    asin: r.asin || null,
    productName: r.product_name || null,
    yourPrice: r.your_price ?? null,
    daysOfSupply: r.days_of_supply ?? null,
    excessUnits: r.excess_units,
    totalUnits: r.total_units,
  }));
  lastKnown.set("fba_planning", { reportId, createdTime: dataAsOf });
  return { ready: true, status: out.status, reportId, dataAsOf, stale, rows };
}

/**
 * SKU → total FBA units. Reuses the same unfulfillable/MYI report the
 * dashboard already pulls (no extra Amazon call). Keys are lowercased SKUs.
 */
export async function fetchInventoryTotals(): Promise<Record<string, number>> {
  const latest = await findLatestDone("unfulfillable");
  const reportId = latest?.reportId ?? (await requestReport("unfulfillable"));
  const out = (await scaFetch(
    `/reports/${encodeURIComponent(reportId)}/inventory-totals`,
  )) as { ready: boolean; totals?: Record<string, number> };
  if (!out.ready || !out.totals) return {};
  const norm: Record<string, number> = {};
  for (const [sku, qty] of Object.entries(out.totals)) {
    norm[sku.trim().toLowerCase()] = qty;
  }
  return norm;
}

interface UnfulfillableDto {
  sku: string;
  asin?: string;
  fnsku?: string;
  product_name?: string;
  condition?: string;
  your_price?: number | null;
  unsellable_total: number;
  warehouse_damaged: number;
  customer_damaged: number;
  distributor_damaged: number;
  defective: number;
  expired: number;
  carrier_damaged: number;
}

interface ReportListItem {
  reportId: string;
  processingStatus?: string;
  createdTime?: string;
  dataEndTime?: string;
}

/** How old a DONE report may be before we auto-request a fresh one. */
const MAX_AGE_HOURS = 24;

/**
 * In-memory cache of the last known-good reportId per type, plus when Amazon
 * created it. Survives across API calls (same Node process) so we don't hammer
 * Amazon's list-reports every reload — which is especially important for
 * stranded, where list-reports 500s and we'd otherwise request a fresh report
 * on every load. Lost on server restart, which is fine: we re-derive from
 * list-reports or request a new one.
 */
const lastKnown = new Map<string, { reportId: string; createdTime: string | null }>();

/**
 * Short-lived cache of the last successfully-parsed *result* per fetcher. When
 * Amazon intermittently throttles (very common — quota resets every few
 * seconds), we return the last good result instead of surfacing an error to
 * the UI. Reloads within RESULT_TTL_MS of a good fetch skip Amazon entirely.
 */
const RESULT_TTL_MS = 60_000;
const resultCache = new Map<string, { at: number; value: unknown }>();

function readCache<T>(key: string): T | null {
  const hit = resultCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > RESULT_TTL_MS) {
    resultCache.delete(key);
    return null;
  }
  return hit.value as T;
}

function writeCache(key: string, value: unknown) {
  resultCache.set(key, { at: Date.now(), value });
}

interface LatestDone {
  reportId: string;
  createdTime: string | null;
  /** True when the latest DONE report is older than MAX_AGE_HOURS. */
  stale: boolean;
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

async function findLatestDone(reportTypeKey: string): Promise<LatestDone | null> {
  // Amazon's list-reports call intermittently 500s for certain legacy report
  // types (e.g. STRANDED_INVENTORY_UI). Treat any list failure as "no DONE
  // report found" so the caller falls back to requesting a fresh one instead
  // of surfacing a scary gateway error.
  let list: ReportListItem[] = [];
  try {
    list = (await scaFetch(`/reports/?report_type=${reportTypeKey}`)) as ReportListItem[];
  } catch (err) {
    console.warn(`list-reports(${reportTypeKey}) failed — treating as no cache:`, err);
    // If we've previously seen a good reportId for this type, keep using it
    // instead of firing a fresh request on every reload.
    const cached = lastKnown.get(reportTypeKey);
    if (cached) {
      const createdTime = cached.createdTime;
      const stale = createdTime
        ? (Date.now() - new Date(createdTime).getTime()) / 3_600_000 > MAX_AGE_HOURS
        : true;
      return { reportId: cached.reportId, createdTime, stale };
    }
    return null;
  }
  const done = (Array.isArray(list) ? list : []).filter((r) => r.processingStatus === "DONE");
  if (done.length === 0) return null;
  done.sort((a, b) => (b.createdTime ?? b.dataEndTime ?? "").localeCompare(a.createdTime ?? a.dataEndTime ?? ""));
  const top = done[0];
  const createdTime = top.createdTime ?? top.dataEndTime ?? null;
  let stale = false;
  if (createdTime) {
    const ageHours = (Date.now() - new Date(createdTime).getTime()) / 3_600_000;
    stale = ageHours > MAX_AGE_HOURS;
  }
  return { reportId: top.reportId, createdTime, stale };
}

/**
 * Fire-and-forget: request a fresh report so tomorrow's UI has current data.
 * We never await this — the current call keeps returning today's cached data so
 * the UI stays fast.
 */
function requestFreshInBackground(reportTypeKey: string) {
  requestReport(reportTypeKey).catch((err) => {
    // Best-effort refresh; log to server console but never fail the user's read.
    console.warn(`Background refresh of '${reportTypeKey}' failed:`, err);
  });
}

async function requestReport(reportTypeKey: string): Promise<string> {
  const out = await scaFetch(`/reports/?report_type=${reportTypeKey}`, { method: "POST" });
  if (!out.reportId) {
    // Gateway couldn't create the report (Amazon throttled etc). Fall back to
    // the last-known reportId if we have one so the caller polls THAT instead
    // of crashing.
    const cached = lastKnown.get(reportTypeKey);
    if (cached) return cached.reportId;
    throw new Error(`report create failed: ${out.error ?? out.detail ?? "unknown"}`);
  }
  return out.reportId as string;
}

export interface StrandedResult {
  ready: boolean;
  status?: string;
  reportId: string | null;
  /** ISO timestamp when Amazon generated the report backing this data. */
  dataAsOf: string | null;
  /** True when the report backing this data is older than MAX_AGE_HOURS. A
   *  fresh one has already been requested in the background; the next reload
   *  will pick it up when Amazon finishes. */
  stale: boolean;
  rows: StrandedRow[];
}

export interface UnfulfillableResult {
  ready: boolean;
  status?: string;
  reportId: string | null;
  dataAsOf: string | null;
  stale: boolean;
  rows: UnfulfillableRow[];
}

/**
 * Fetch Stranded rows.
 *
 * Freshness strategy — same for Unfulfillable:
 *  1. Look up the latest DONE report.
 *  2. If it's older than MAX_AGE_HOURS, kick off a fresh request in the
 *     BACKGROUND (fire-and-forget) so tomorrow's read has current data. We
 *     still return today's cached data now so the UI stays fast.
 *  3. If no DONE report exists at all, request one and return ready:false so
 *     the UI shows "generating".
 */
export async function fetchStranded(): Promise<StrandedResult> {
  try {
    const inner = await _fetchStrandedInner();
    if (inner.ready) writeCache("stranded", inner);
    else {
      const cached = readCache<StrandedResult>("stranded");
      if (cached) return cached;
    }
    return inner;
  } catch (err) {
    const cached = readCache<StrandedResult>("stranded");
    if (cached) return cached;
    throw err;
  }
}

async function _fetchStrandedInner(): Promise<StrandedResult> {
  const latest = await findLatestDone("stranded");
  let reportId: string;
  let dataAsOf: string | null;
  let stale = false;

  if (!latest) {
    reportId = await requestReport("stranded");
    dataAsOf = null;
    // Remember this reportId so subsequent reloads poll it instead of firing
    // yet another request every time the user hits Reload.
    lastKnown.set("stranded", { reportId, createdTime: null });
  } else {
    reportId = latest.reportId;
    dataAsOf = latest.createdTime;
    stale = latest.stale;
    if (stale) requestFreshInBackground("stranded");
  }

  const out = await scaFetch(`/reports/${encodeURIComponent(reportId)}/stranded`);
  if (!out.ready) {
    return { ready: false, status: out.status, reportId, dataAsOf, stale, rows: [] };
  }

  const rows: StrandedRow[] = (out.rows as StrandedDto[]).map((r) => ({
    sku: (r.sku ?? "").trim(),
    asin: r.asin || null,
    fnsku: r.fnsku || null,
    productName: r.product_name || null,
    condition: r.condition || null,
    reason: r.stranded_reason || null,
    strandedSince: r.stranded_since || null,
    autoRemovalDate: r.auto_removal_date || null,
    primaryAction: r.primary_action || null,
    quantity: r.quantity ?? null,
    fulfillableQty: r.fulfillable_qty ?? 0,
    unfulfillableQty: r.unfulfillable_qty ?? 0,
    reservedQty: r.reserved_qty ?? 0,
    inboundQty: r.inbound_qty ?? 0,
    yourPrice: r.your_price ?? null,
  }));

  lastKnown.set("stranded", { reportId, createdTime: dataAsOf });
  return { ready: true, status: out.status, reportId, dataAsOf, stale, rows };
}

/**
 * Fetch Unfulfillable rows. Same freshness strategy as fetchStranded.
 */
export async function fetchUnfulfillable(): Promise<UnfulfillableResult> {
  try {
    const inner = await _fetchUnfulfillableInner();
    if (inner.ready) writeCache("unfulfillable", inner);
    else {
      const cached = readCache<UnfulfillableResult>("unfulfillable");
      if (cached) return cached;
    }
    return inner;
  } catch (err) {
    const cached = readCache<UnfulfillableResult>("unfulfillable");
    if (cached) return cached;
    throw err;
  }
}

async function _fetchUnfulfillableInner(): Promise<UnfulfillableResult> {
  const latest = await findLatestDone("unfulfillable");
  let reportId: string;
  let dataAsOf: string | null;
  let stale = false;

  if (!latest) {
    reportId = await requestReport("unfulfillable");
    dataAsOf = null;
    lastKnown.set("unfulfillable", { reportId, createdTime: null });
  } else {
    reportId = latest.reportId;
    dataAsOf = latest.createdTime;
    stale = latest.stale;
    if (stale) requestFreshInBackground("unfulfillable");
  }

  const out = await scaFetch(`/reports/${encodeURIComponent(reportId)}/unfulfillable`);
  if (!out.ready) {
    return { ready: false, status: out.status, reportId, dataAsOf, stale, rows: [] };
  }

  const rows: UnfulfillableRow[] = (out.rows as UnfulfillableDto[]).map((r) => ({
    sku: (r.sku ?? "").trim(),
    asin: r.asin || null,
    fnsku: r.fnsku || null,
    productName: r.product_name || null,
    condition: r.condition || null,
    yourPrice: r.your_price ?? null,
    unsellableTotal: r.unsellable_total,
    warehouseDamaged: r.warehouse_damaged,
    customerDamaged: r.customer_damaged,
    distributorDamaged: r.distributor_damaged,
    defective: r.defective,
    expired: r.expired,
    carrierDamaged: r.carrier_damaged,
  }));

  lastKnown.set("unfulfillable", { reportId, createdTime: dataAsOf });
  return { ready: true, status: out.status, reportId, dataAsOf, stale, rows };
}
