import { NextResponse } from "next/server";
import {
  assembleReport,
  buildFeeOverchargeActions,
  buildStrandedActions,
  buildDamageActions,
  buildLtsfActions,
  buildExcessActions,
  buildReturnlessActions,
} from "@/lib/wasteReport";
import {
  fetchStranded,
  fetchUnfulfillable,
  fetchAdjustmentBuckets,
  fetchAged,
  fetchPlanning,
  type AdjustmentBuckets,
} from "@/lib/amazonInventory";
import {
  fetchReturnsSummary,
  fetchRefundsBySku,
  computeStrategy,
  type ReturnsMap,
  type RefundsMap,
} from "@/lib/returnsStrategy";
import { findLatestDoneReportId, fetchFeesRows } from "@/lib/amazonReport";
import { fetchRealMeasurements } from "@/lib/productLibrary";
import { auditCatalog, type AuditFinding } from "@platform/calc";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/waste-report — consolidates every $-related data source into a
 * single ranked action list. Each source fetch is independent; if one fails
 * (throttled, still generating), the rest still contribute — the response
 * marks which sources are stale in the `sources` block.
 */
export async function GET() {
  // Fetch everything in parallel. Each fetch is wrapped so one failure doesn't
  // fail the whole report; caller sees the source as "not ready".
  const feesReportPromise = findLatestDoneReportId()
    .then((id) => (id ? fetchFeesRows(id) : { ready: false, rows: [] as { sku: string; yourPrice: number | null }[] }))
    .catch(() => ({ ready: false, rows: [] as { sku: string; yourPrice: number | null }[] }));

  const [stranded, unfulfillable, buckets, aged, planning, returns, refunds, feesRows, realMeasurements] =
    await Promise.all([
      fetchStranded().catch(() => ({ ready: false as const, rows: [], dataAsOf: null })),
      fetchUnfulfillable().catch(() => ({ ready: false as const, rows: [], dataAsOf: null })),
      fetchAdjustmentBuckets().catch(() => ({} as Record<string, AdjustmentBuckets>)),
      fetchAged().catch(() => ({ ready: false as const, rows: [], dataAsOf: null })),
      fetchPlanning().catch(() => ({ ready: false as const, rows: [], dataAsOf: null })),
      fetchReturnsSummary().catch(() => ({ ready: false as const, skus: {} as ReturnsMap, reportId: null, status: "err" })),
      fetchRefundsBySku().catch(() => ({ ready: false as const, skus: {} as RefundsMap, reportId: null, status: "err" })),
      feesReportPromise,
      fetchRealMeasurements().catch(() => ({ measurements: [], skippedSkus: [] })),
    ]);

  // Enrich unfulfillable rows with damage buckets so damage split is available.
  type UnfulRow = (typeof unfulfillable.rows)[number] & {
    reimbursableTotal?: number;
    reimbursableUsd?: number;
    nonReimbursableTotal?: number;
    bucketsFromAdjustments?: boolean;
  };
  const enrichedUnfulfillable: UnfulRow[] = (unfulfillable.rows ?? []).map((r) => {
    const b = buckets[r.sku.trim().toLowerCase()];
    if (!b) return r;
    const bTotal = b.reimbursableTotal + b.nonReimbursableTotal;
    const scale = bTotal > 0 ? r.unsellableTotal / bTotal : 0;
    const wh = Math.round(b.warehouseDamaged * scale);
    const cd = Math.round(b.carrierDamaged * scale);
    const dd = Math.round(b.distributorDamaged * scale);
    const reimbursableTotal = wh + cd + dd;
    const nonReimbursableTotal = r.unsellableTotal - reimbursableTotal;
    const reimbursableUsd = (r.yourPrice ?? 0) * reimbursableTotal;
    return { ...r, reimbursableTotal, nonReimbursableTotal, reimbursableUsd, bucketsFromAdjustments: true };
  });

  // Build a price index from fees + unfulfillable (both carry yourPrice).
  const priceBySku = new Map<string, number>();
  for (const r of feesRows.rows ?? []) {
    if (r.yourPrice && r.yourPrice > 0) priceBySku.set(r.sku.trim().toLowerCase(), r.yourPrice);
  }
  for (const r of unfulfillable.rows ?? []) {
    if (r.yourPrice && r.yourPrice > 0) priceBySku.set(r.sku.trim().toLowerCase(), r.yourPrice);
  }

  // Fee-audit findings — run the audit engine on live data if we have both
  // fees + real measurements. Otherwise leave empty.
  let feeFindings: AuditFinding[] = [];
  if (feesRows.ready && feesRows.rows.length > 0 && realMeasurements.measurements.length > 0) {
    try {
      const result = auditCatalog(feesRows.rows, realMeasurements.measurements);
      feeFindings = result.findings;
    } catch {
      // audit engine failure is non-fatal for the waste report
    }
  }

  // Returns Strategy verdicts — need to recompute here since we pull raw
  // returns + refunds and need to pair each SKU with its price.
  const strategyRows: {
    sku: string; verdict: string; annualDelta: number; savingsPerReturn: number; returnlessCount: number;
  }[] = [];
  const allSkusInReturns = new Set<string>([
    ...Object.keys(returns.skus ?? {}),
    ...Object.keys(refunds.skus ?? {}),
  ]);
  for (const sku of allSkusInReturns) {
    const price = priceBySku.get(sku.trim().toLowerCase());
    if (!price) continue;
    const rs = returns.skus?.[sku] ?? {
      returnsTotal: 0, returnlessTotal: 0, physicalReturnTotal: 0, sellableBack: 0,
      customerDamaged: 0, defective: 0, expired: 0, warehouseDamaged: 0, carrierDamaged: 0,
      distributorDamaged: 0, unsellableTotal: 0, topReason: null, lastReturnDate: null,
      sellableBackRate: null, physicalReturnOrderIds: [],
    };
    const rf = refunds.skus?.[sku];
    const s = computeStrategy(sku, rs, price, rf);
    strategyRows.push({
      sku: s.sku, verdict: s.verdict, annualDelta: s.annualDelta,
      savingsPerReturn: s.savingsPerReturn, returnlessCount: s.returnlessCount,
    });
  }

  const actions = [
    ...buildFeeOverchargeActions(feeFindings),
    ...buildStrandedActions(stranded.rows ?? []),
    ...buildDamageActions(enrichedUnfulfillable),
    ...buildLtsfActions(aged.rows ?? []),
    ...buildExcessActions(planning.rows ?? []),
    ...buildReturnlessActions(strategyRows),
  ];

  const report = assembleReport(actions, {
    audit: { ready: feesRows.ready === true, asOf: null },
    inventory: {
      ready: unfulfillable.ready === true && stranded.ready === true,
      asOf: unfulfillable.dataAsOf ?? null,
    },
    returns: { ready: returns.ready === true && refunds.ready === true, asOf: null },
  });

  return NextResponse.json(report);
}
