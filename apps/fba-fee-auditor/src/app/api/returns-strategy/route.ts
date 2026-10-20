import { NextResponse } from "next/server";
import {
  fetchReturnsSummary,
  fetchRefundsBySku,
  computeStrategy,
  type StrategyResult,
  type RefundsMap,
} from "@/lib/returnsStrategy";
import { fetchUnfulfillable } from "@/lib/amazonInventory";
import { findLatestDoneReportId, fetchFeesRows } from "@/lib/amazonReport";
import { getUpload } from "@/lib/uploadedReports";
import { getPastedDashboard } from "@/lib/pastedDashboard";
import {
  returnsProcessingFee,
  thresholdForCategory,
  type SizeTier,
} from "@/lib/returnsProcessingFee";
import type { FeeContext } from "@/lib/returnsStrategy";

// Catalog is bath/pool/splash toys — Amazon fee category "Toys and Games"
// (4.7% return-rate threshold). Change here if the catalog diversifies.
const FEE_CATEGORY = "Toys and Games";

/** Map Amazon's productSizeTier string onto our rate-card tiers. */
function toSizeTier(amazonTier?: string | null): SizeTier {
  const t = (amazonTier ?? "").toLowerCase();
  if (t.includes("smallstandard")) return "small_standard";
  if (t.includes("largestandard")) return "large_standard";
  if (t.includes("bulky")) return "bulky";
  if (t.includes("extralarge") || t.includes("xl")) return "xl_0_50";
  return "large_standard";
}

export const dynamic = "force-dynamic";
// Finances API pagination can take 5–15 min for a year of high-volume data
// (Amazon 0.5 req/s cap). Cache absorbs it after the first call.
export const maxDuration = 900;

/**
 * GET /api/returns-strategy
 * For every SKU with returns in the last 12 months, computes returnless-vs-
 * return-required cost using the SKU's actual sellable-back rate and price.
 * SKUs whose price we can't resolve (no current FBA inventory, not in the fees
 * report) are omitted — the math needs a real price to be meaningful.
 */
export async function GET() {
  try {
    // Build a price index from every source we have: MYI (yourPrice on current
    // FBA inventory) + the fees report (has yourPrice on every SKU Amazon
    // priced, even SKUs no longer stocked). Union covers most SKUs seen in
    // returns.
    // When the dashboard paste is present it supersedes the Finance API's
    // order-id set-difference entirely — so skip that call. It paginates at
    // Amazon's 0.5 req/s and takes 5–15 min, which would otherwise time the
    // request out for no benefit.
    const pastedEarly = getPastedDashboard();
    const skipFinanceRefunds = pastedEarly != null && pastedEarly.rows.length > 0;

    const feesReportId = await findLatestDoneReportId().catch(() => null);
    const [returns, refunds, unfulfillable, feesRows] = await Promise.all([
      fetchReturnsSummary(),
      skipFinanceRefunds
        ? Promise.resolve({
            ready: true as const,
            status: "skipped (dashboard paste present)",
            reportId: null,
            skus: {} as RefundsMap,
          })
        : fetchRefundsBySku(),
      fetchUnfulfillable().catch(() => ({ rows: [] as { sku: string; yourPrice: number | null }[] })),
      feesReportId
        ? fetchFeesRows(feesReportId).catch(() => ({ rows: [] as { sku: string; yourPrice: number | null }[] }))
        : Promise.resolve({ rows: [] as { sku: string; yourPrice: number | null }[] }),
    ]);

    const priceBySku = new Map<string, number>();
    const asinBySku = new Map<string, string>();
    // Size tier + shipping weight per SKU — feeds Amazon's returns-processing
    // rate card. Amazon's own measured values from the fees report.
    const dimsBySku = new Map<string, { tier: SizeTier; weightOz: number }>();
    for (const r of feesRows.rows ?? []) {
      const key = r.sku.trim().toLowerCase();
      if (r.yourPrice && r.yourPrice > 0) priceBySku.set(key, r.yourPrice);
      const row = r as {
        asin?: string;
        productSizeTier?: string;
        itemPackageWeight?: number | null;
      };
      if (row.asin) asinBySku.set(key, row.asin.trim().toLowerCase());
      if (row.itemPackageWeight && row.itemPackageWeight > 0) {
        dimsBySku.set(key, {
          tier: toSizeTier(row.productSizeTier),
          weightOz: row.itemPackageWeight * 16, // report is in pounds
        });
      }
    }
    for (const r of unfulfillable.rows ?? []) {
      const key = r.sku.trim().toLowerCase();
      if (r.yourPrice && r.yourPrice > 0) priceBySku.set(key, r.yourPrice);
      const asin = (r as { asin?: string | null }).asin;
      if (asin && !asinBySku.has(key)) asinBySku.set(key, asin.trim().toLowerCase());
    }

    // Union of SKUs present in EITHER returns or refunds — with returnless
    // enabled, many SKUs will only appear in the refunds report.
    const allSkus = new Set<string>([
      ...Object.keys(returns.skus),
      ...Object.keys(refunds.skus),
    ]);

    // Uploaded CSV overrides — Return Insights CSV matches dashboard exactly.
    // Customer Returns CSV gives higher physical counts than the SP-API version.
    // When present, we scale the SP-API counts to match the uploaded totals so
    // the returnless/physical RATIO stays intact but the absolute numbers match.
    const insights = getUpload("return_insights");
    const custReturns = getUpload("customer_returns");
    const pasted = getPastedDashboard();

    // Also union SKUs from uploads so they show even without SP-API data.
    if (insights) Object.keys(insights.bySku).forEach((s) => allSkus.add(s));
    if (custReturns) Object.keys(custReturns.bySku).forEach((s) => allSkus.add(s));

    const results: StrategyResult[] = [];
    const noPriceSkus: string[] = [];
    for (const sku of allSkus) {
      const price = priceBySku.get(sku.trim().toLowerCase());
      if (!price) {
        noPriceSkus.push(sku);
        continue;
      }
      const returnsSummary = returns.skus[sku] ?? {
        returnsTotal: 0,
        returnlessTotal: 0,
        physicalReturnTotal: 0,
        sellableBack: 0,
        customerDamaged: 0,
        defective: 0,
        expired: 0,
        warehouseDamaged: 0,
        carrierDamaged: 0,
        distributorDamaged: 0,
        unsellableTotal: 0,
        topReason: null,
        lastReturnDate: null,
        sellableBackRate: null,
        physicalReturnOrderIds: [],
      };
      const refundSummary = refunds.skus[sku];

      const key = sku.trim().toLowerCase();

      // ── Authoritative returnless derivation ──────────────────────────────
      // Amazon's FBA Customer Returns report ONLY contains units that physically
      // arrived at a fulfillment center. Returnless refunds never reach an FC,
      // so they appear in no SP-API report. The dashboard total is the only
      // source that includes them:
      //     returnless = dashboard_total − physical_returns
      // We prefer the pasted dashboard; fall back to CSV uploads; else leave the
      // (undercounted) SP-API-derived numbers alone.
      let adjusted = returnsSummary;
      let countSource: "dashboard_paste" | "csv_upload" | "sp_api" = "sp_api";

      const asin = asinBySku.get(key);
      const dashboardTotal =
        (asin ? pasted?.byAsin[asin] : undefined) ?? pasted?.byAsin[key];

      const uploadedTotal =
        insights?.bySku[key]?.returnUnits ??
        (asin ? insights?.byAsin[asin]?.returnUnits : undefined) ??
        custReturns?.bySku[key]?.returnUnits ??
        (asin ? custReturns?.byAsin[asin]?.returnUnits : undefined);

      const authoritativeTotal = dashboardTotal ?? uploadedTotal;

      if (authoritativeTotal && authoritativeTotal > 0) {
        // Physical count from the FBA returns report is trustworthy as-is.
        const physical = returnsSummary.physicalReturnTotal;
        const returnless = Math.max(0, authoritativeTotal - physical);
        adjusted = {
          ...returnsSummary,
          returnsTotal: authoritativeTotal,
          physicalReturnTotal: physical,
          returnlessTotal: returnless,
        };
        countSource = dashboardTotal != null ? "dashboard_paste" : "csv_upload";
      }

      // Returns-processing-fee context. The displayed return rate comes from
      // the dashboard paste; the per-unit fee from Amazon's 2026 rate card
      // using the SKU's real size tier + shipping weight.
      const pastedRow = pasted?.rows.find(
        (r) => r.asin.toLowerCase() === asin || r.asin.toLowerCase() === key,
      );
      const dims = dimsBySku.get(key);
      let feeContext: FeeContext | undefined;
      if (pastedRow?.returnRatePct != null && dims) {
        feeContext = {
          displayedReturnRate: pastedRow.returnRatePct / 100,
          threshold: thresholdForCategory(FEE_CATEGORY),
          feePerUnit: returnsProcessingFee(dims.tier, dims.weightOz),
        };
      }

      // When we have an authoritative total, pass no refunds object — its
      // order-id set-difference would overwrite the correct returnless count
      // with the Finance-API-derived undercount.
      const result = computeStrategy(
        sku,
        adjusted,
        price,
        countSource === "sp_api" ? refundSummary : undefined,
        { feeContext },
      );
      results.push({ ...result, countSource } as StrategyResult & { countSource: string });
    }
    // Sort by absolute yearly savings potential so biggest opportunities float.
    results.sort((a, b) => Math.abs(b.annualDelta) - Math.abs(a.annualDelta));

    return NextResponse.json({
      ready: returns.ready && refunds.ready,
      status: returns.ready && refunds.ready
        ? "DONE"
        : `returns=${returns.status} refunds=${refunds.status}`,
      reportId: returns.reportId,
      refundsReportId: refunds.reportId,
      results,
      noPriceSkus,
      windowDays: 365,
      uploads: {
        dashboardPaste: pasted
          ? { pastedAt: pasted.pastedAt, asinCount: pasted.rows.length, totalUnits: pasted.totalUnits }
          : null,
        returnInsights: insights
          ? { filename: insights.filename, rowCount: insights.rowCount, uploadedAt: insights.uploadedAt }
          : null,
        customerReturns: custReturns
          ? { filename: custReturns.filename, rowCount: custReturns.rowCount, uploadedAt: custReturns.uploadedAt }
          : null,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ready: false, status: (err as Error).message, results: [], noPriceSkus: [], windowDays: 365 },
      { status: 500 },
    );
  }
}
