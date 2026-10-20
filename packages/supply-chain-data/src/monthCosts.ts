// One month of storage and logistics costs, assembled from the gateway and
// cached on disk. Server-only: it reads and writes files under `dataDir`.

import fs from "node:fs";
import path from "node:path";
import type { Gateway } from "./gateway";
import { createReportIndex } from "./reportIndex";
import {
  fetchBilledFees,
  fetchPlanning,
  fetchStorageFees,
  findDonePlanningReport,
  findStorageReport,
  monthWindow,
  requestPlanningReport,
  requestStorageReport,
  type BilledFees,
  type PlanningRow,
  type StorageFeeResult,
} from "./storageCosts";

/** How long an unsettled month is served as-is before the missing half is re-checked. */
const STALE_AFTER_MS = 45_000;

/**
 * A month's costs are cached on disk. Both halves are slow and rate-limited:
 * the storage report takes minutes to generate, and the billed fees mean
 * paging the whole financial-event stream (~56 pages for ten days, at the
 * half-request-per-second Amazon allows). A closed month never changes, so
 * re-reading it from Amazon on every page view would be pure waste.
 */
export interface CachedMonth {
  month: string;
  fetchedAt: string;
  storage: StorageFeeResult | null;
  billed: BilledFees | null;
  planning: PlanningRow[];
  storageReportId?: string | null;
  /** Amazon has not published storage fees for this month yet. */
  monthUnavailable?: boolean;
}

export type MonthCostsResponse = CachedMonth & { cached: boolean; settled?: boolean; warning?: string };

export interface LoadOptions {
  dataDir: string;
  refresh?: boolean;
  /**
   * Fetch the live planning snapshot. It describes stock now, not the month,
   * so a history view that only wants the month's bills can skip it.
   */
  planning?: boolean;
  /**
   * Treat fees cached before the gateway collected per-SKU sales as unread, so
   * the month is scanned again rather than settled without its sales.
   */
  requireSkuSales?: boolean;
}

/** A month is settled once Amazon has given everything it is going to give. */
export function isSettled(
  c: Pick<CachedMonth, "billed" | "storage" | "monthUnavailable"> | null,
  requireSkuSales = false,
): boolean {
  return Boolean(feesRead(c, requireSkuSales) && (c?.storage?.ready || c?.monthUnavailable));
}

/** The month's fee scan is finished (and, if asked, carries per-SKU sales). */
export function feesRead(c: Pick<CachedMonth, "billed"> | null, requireSkuSales = false): boolean {
  return Boolean(c?.billed?.ready && (!requireSkuSales || c.billed.by_sku));
}

/** The month as last cached, without touching Amazon. */
export function readMonthCache(dataDir: string, month: string): CachedMonth | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, `storage-costs-${month}.json`), "utf8")) as CachedMonth;
  } catch {
    return null;
  }
}

export async function loadMonthCosts(
  gw: Gateway,
  month: string,
  opts: LoadOptions,
): Promise<{ status: number; body: MonthCostsResponse | { error: string } }> {
  const { dataDir, refresh = false, planning: wantPlanning = true, requireSkuSales = false } = opts;
  const cacheFile = path.join(dataDir, `storage-costs-${month}.json`);
  const index = createReportIndex(dataDir);

  const cached = readMonthCache(dataDir, month);
  // Settled months never change, so they are served from disk for good. An
  // unsettled month is still served instantly, then refreshed in the
  // background - re-fetching the finished half on every page view is what made
  // this slow.
  const settled = isSettled(cached, requireSkuSales);
  const ageMs = cached ? Date.now() - new Date(cached.fetchedAt).getTime() : Infinity;
  if (cached && !refresh && (settled || ageMs < STALE_AFTER_MS)) {
    return { status: 200, body: { ...cached, cached: true, settled } };
  }

  try {
    const { start, end } = monthWindow(month);

    // Storage report: reuse a finished one for this month before asking Amazon
    // to build another — it is rate-limited and slow.
    let storage: StorageFeeResult | null = null;
    let monthUnavailable = false;

    // Anything already finished is reused rather than fetched again.
    const haveStorage = cached?.storage?.ready ? cached.storage : null;
    const haveBilled = feesRead(cached, requireSkuSales) ? cached!.billed : null;

    // The report id for a month is remembered, because getReports is limited to
    // roughly one call every 45 seconds — far too scarce to spend on every
    // page view.
    const known = index.get(month);
    let storageReportId = known?.reportId ?? cached?.storageReportId ?? null;

    // Set when this call listed and found nothing, which is the moment to ask
    // for a new report: listing is spaced out, requesting is not listing.
    let listedNow = false;
    if (!haveStorage && !storageReportId && index.mayList(month)) {
      const found = await findStorageReport(gw, month);
      listedNow = true;
      index.set(month, { listedAt: new Date().toISOString() });
      storageReportId = found.reportId ?? found.pending;
      if (storageReportId) {
        index.set(month, { reportId: storageReportId, status: found.reportId ? "DONE" : "IN_PROGRESS" });
      } else if (found.cancelled) {
        // Amazon cancels the request for a month whose storage billing it
        // hasn't closed. Asking again only collects more cancellations.
        monthUnavailable = true;
        index.set(month, { status: "CANCELLED" });
      }
    }

    if (!haveStorage && !storageReportId && known?.status !== "CANCELLED" && !monthUnavailable && listedNow) {
      storageReportId = await requestStorageReport(gw, month);
      if (storageReportId) index.set(month, { reportId: storageReportId, status: "REQUESTED" });
    }
    if (known?.status === "CANCELLED") monthUnavailable = true;

    if (haveStorage) {
      storage = haveStorage;
    } else if (storageReportId) {
      storage = await fetchStorageFees(gw, storageReportId);
      if (storage?.ready) index.set(month, { status: "DONE" });
      // A report Amazon cancelled is a dead end — forget it so the month can be
      // asked for again later, when Amazon has published it.
      if (storage?.status === "CANCELLED") {
        index.set(month, { reportId: null, status: "CANCELLED" });
        monthUnavailable = true;
        storage = null;
      }
    }

    // Planning is a live snapshot, not month-specific. Its report id is
    // remembered under a fixed key for the same reason the storage one is:
    // listing reports is limited to about one call every 45 seconds, and
    // failing that lookup silently produced a report with no sales data — which
    // then read as "this SKU sold nothing", condemning live products as dead
    // stock. A planning report older than a day is replaced.
    let planning: PlanningRow[] = cached?.planning ?? [];
    if (wantPlanning && !(planning.length > 0 && ageMs < 6 * 3600 * 1000)) {
      try {
        const known = index.get("planning");
        const fresh = known?.updatedAt && Date.now() - new Date(known.updatedAt).getTime() < 24 * 3600 * 1000;
        let planId = fresh ? known?.reportId ?? null : null;
        if (!planId && index.mayList("planning")) {
          planId = (await findDonePlanningReport(gw)) ?? (await requestPlanningReport(gw));
          index.set("planning", { reportId: planId, listedAt: new Date().toISOString() });
        }
        if (planId) {
          const p = await fetchPlanning(gw, planId);
          planning = p.rows;
          // Forget the id only when the report genuinely has no rows. A
          // throttled answer is "ask later", not "this report is bad" — treating
          // the two the same threw away a good report id and sent the next call
          // back to the rate-limited listing, which returned nothing.
          if (p.ready && p.rows.length === 0) index.set("planning", { reportId: null });
        }
      } catch {
        /* planning is a nice-to-have; costs still stand without it */
      }
    }

    const billed = haveBilled ?? (await fetchBilledFees(gw, start, end));

    const out: CachedMonth = {
      month,
      fetchedAt: new Date().toISOString(),
      storage,
      billed,
      planning,
      storageReportId,
      monthUnavailable,
    };
    // Cache every result, not just the complete ones: a half-done month cached
    // for 45 seconds still saves the whole round trip on the next view, and the
    // `settled` flag keeps a pending scan from being mistaken for a final $0.
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(out), "utf8");
    return { status: 200, body: { ...out, cached: false, settled: isSettled(out, requireSkuSales) } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load storage costs.";
    // Fall back to whatever was last good rather than showing nothing.
    if (cached) return { status: 200, body: { ...cached, cached: true, warning: message } };
    return { status: 502, body: { error: message } };
  }
}

/** Last completed month — the current one is still accruing. */
export function defaultMonth(now = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
