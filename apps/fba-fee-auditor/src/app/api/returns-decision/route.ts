import { NextResponse } from "next/server";
import { decide, noCogsDecision, type Decision } from "@/lib/returnsDecision";
import { getCogs, resolveCogs } from "@/lib/cogsStore";
import { getPastedDashboard } from "@/lib/pastedDashboard";
import { fetchReturnsSummary, type ReturnsMap } from "@/lib/returnsStrategy";
import { getReturnsCsv } from "@/lib/returnsCsvStore";
import { getSkuEcon, saveSkuEcon, type SkuEcon } from "@/lib/skuEconStore";
import { fetchVelocity, annualUnits, type VelocityMap } from "@/lib/salesVelocity";
import { getAsp } from "@/lib/avgSellingPrice";
import { getRemovalFees, disposalFeeFor } from "@/lib/removalFees";
import { runReturnsModel, tiesOut, type ModelResult } from "@/lib/returnsModel";
import { findLatestDoneReportId, fetchFeesRows } from "@/lib/amazonReport";
import {
  returnsProcessingFee,
  thresholdForCategory,
  type SizeTier,
} from "@/lib/returnsProcessingFee";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Bath / pool / splash toys -> Amazon fee category "Toys and Games" (4.7%).
const FEE_CATEGORY = "Toys and Games";

/**
 * Multipack / virtual bundle SKUs.
 *
 * These list on Amazon but are not a single manufactured unit, so there is no
 * meaningful landed COGS to compare a return against — their cost is the sum of
 * component SKUs, which the PNL calculator does not hold. All four carry zero
 * customer returns in the window, so excluding them changes no figure; the point
 * is to keep them out of the "needs COGS" gap list so nobody tries to cost them.
 *
 * A SKU is treated as a bundle if it is named here, or if its SKU is two ASINs
 * joined by a hyphen (Amazon's convention for a virtual bundle).
 */
const BUNDLE_SKUS = new Set(["sezbundle04", "sezb0002"]);
const VIRTUAL_BUNDLE = /^b0[a-z0-9]{8}-b0[a-z0-9]{8}$/i;

function isBundle(sku: string): boolean {
  const k = sku.trim().toLowerCase();
  return BUNDLE_SKUS.has(k) || VIRTUAL_BUNDLE.test(k);
}

/**
 * Discontinued SKUs — excluded from the decision, not just from the gap list.
 *
 * The whole case for requiring returns is that a recovered unit replaces one you
 * would otherwise buy. On a SKU you have stopped selling there is no next
 * purchase order, so a returned unit is worth nothing: it lands in a warehouse
 * you are trying to empty. Their history is still real, but a forward-looking
 * policy decision on them is meaningless.
 */
const DISCONTINUED = new Set([
  // confirmed discontinued by the seller
  "a2jp1k0006",
  "a2jp1k0012",
  "noah001",
  "seztum0021",
  "seztum0022",
  "seztum0023",
  "seztum0024",
  "sez0101007",
  "sezb00009",
  "spbath0002",
  "spbath0009",
  "spbath0019",
  "spbath0019a",
  "spbath0030",
  "spbath0043",
  "spgroo001",
  "texlou001",
  "texlou002",
  "wtrt001",
]);

/** Whole product lines that are discontinued. */
const DISCONTINUED_PREFIXES = ["seted", "seic"];

function isDiscontinued(sku: string): boolean {
  const k = sku.trim().toLowerCase();
  return DISCONTINUED.has(k) || DISCONTINUED_PREFIXES.some((p) => k.startsWith(p));
}

function toSizeTier(amazonTier?: string | null): SizeTier {
  const t = (amazonTier ?? "").toLowerCase();
  if (t.includes("smallstandard")) return "small_standard";
  if (t.includes("largestandard")) return "large_standard";
  if (t.includes("bulky")) return "bulky";
  if (t.includes("extralarge") || t.includes("xl")) return "xl_0_50";
  return "large_standard";
}

/**
 * GET /api/returns-decision
 *
 * Per-SKU returnless-vs-return-required decision using the COGS-based model:
 *   difference = sellableRate x COGS - extra returns-processing fee
 *
 * Inputs:
 *  - FBA fees report  -> price, referral fee, FBA fee, size tier, weight, ASIN
 *  - FBA returns report -> physical returns + SELLABLE / damaged disposition mix
 *  - Dashboard paste  -> TOTAL returns per ASIN (only source that includes
 *                        returnless refunds) and the displayed return rate
 *  - COGS store       -> landed cost per SKU (or a price-ratio fallback)
 */
export async function GET() {
  const cogsStore = getCogs();
  const pasted = getPastedDashboard();
  // Uploaded FBA Customer Returns CSV is preferred over the SP-API report:
  // instant, complete, US-filtered, and carries exact per-unit dispositions.
  const csv = getReturnsCsv();
  // Average realised selling price over the window beats today's list price:
  // refunds are issued at what the customer actually paid.
  const asp = getAsp();
  // Per-unit disposal fee Amazon actually charged. Switching a SKU off
  // returnless creates unsellable units that previously stayed with the
  // customer, and removing them is not free.
  const removals = getRemovalFees();

  const feesReportId = await findLatestDoneReportId().catch(() => null);
  const [feesRes, returnsRes, velocity] = await Promise.all([
    feesReportId
      ? fetchFeesRows(feesReportId).catch(() => ({ ready: false, rows: [] as never[] }))
      : Promise.resolve({ ready: false, rows: [] as never[] }),
    fetchReturnsSummary().catch(() => ({
      ready: false,
      skus: {} as ReturnsMap,
      reportId: null,
      status: "err",
    })),
    fetchVelocity().catch(() => ({}) as VelocityMap),
  ]);

  type FeeRow = {
    sku: string;
    asin?: string;
    yourPrice?: number | null;
    expectedFulfillmentFee?: number | null;
    estimatedReferralFee?: number | null;
    productSizeTier?: string;
    itemPackageWeight?: number | null;
    unitOfDimension?: string;
  };

  // Build the economics map from the live report when Amazon cooperates,
  // otherwise fall back to the last good cached copy. The fees-document
  // download throttles hard and would otherwise blank the whole table.
  const econ = new Map<string, SkuEcon>();
  const liveRows = (feesRes.rows ?? []) as FeeRow[];
  const usableLive = liveRows.filter((r) =>
    (r.unitOfDimension ?? "inches").toLowerCase().startsWith("inch") &&
    (r.yourPrice ?? 0) > 0,
  );

  let econSource: "live" | "cache" | "none" = "none";
  let econUpdatedAt: string | null = null;

  if (usableLive.length > 0) {
    const saved = saveSkuEcon(
      feesReportId,
      usableLive.map((r) => ({
        sku: r.sku,
        asin: r.asin ?? null,
        price: r.yourPrice ?? 0,
        fbaFee: r.expectedFulfillmentFee ?? 0,
        referralFee: r.estimatedReferralFee ?? null,
        sizeTier: r.productSizeTier ?? null,
        weightLb: r.itemPackageWeight ?? null,
      })),
    );
    for (const [k, v] of Object.entries(saved.bySku)) econ.set(k, v);
    econSource = "live";
    econUpdatedAt = saved.updatedAt;
  } else {
    const cached = getSkuEcon();
    if (cached) {
      for (const [k, v] of Object.entries(cached.bySku)) econ.set(k, v);
      econSource = "cache";
      econUpdatedAt = cached.updatedAt;
    }
  }

  // Index of (fbaFee -> observed disposal fee) from SKUs that actually had
  // units disposed. Removal fees track size/weight, and the fulfilment fee is
  // the best size proxy already on hand, so this fills gaps for SKUs with no
  // disposal history of their own.
  const tierIndex: { fbaFee: number; feePerUnit: number }[] = [];
  if (removals) {
    for (const [key, row] of Object.entries(removals.bySku)) {
      if (row.disposalUnits > 0 && row.disposalFeePerUnit && row.disposalFeePerUnit > 0) {
        const e = econ.get(key);
        if (e?.fbaFee) tierIndex.push({ fbaFee: e.fbaFee, feePerUnit: row.disposalFeePerUnit });
      }
    }
  }

  const decisions: Decision[] = [];
  const skipped: { sku: string; why: string }[] = [];
  // The five-outcome model, run alongside the original one-line decision. It
  // needs the returns report's `status` column, which only the uploaded CSV
  // carries, so a SKU without that upload simply has no entry here.
  const models: Record<string, ModelResult> = {};
  const modelSkipped: { sku: string; why: string }[] = [];

  const allSkus = new Map<string, string>(); // lowercase key -> display sku
  for (const k of Object.keys(returnsRes.skus ?? {})) allSkus.set(k.trim().toLowerCase(), k);
  for (const [k, v] of econ) allSkus.set(k, v.sku);
  if (csv) for (const [k, v] of Object.entries(csv.bySku)) allSkus.set(k, v.sku);

  for (const [key, skuRaw] of allSkus) {
    if (isBundle(skuRaw)) {
      skipped.push({ sku: skuRaw, why: "multipack / virtual bundle — no single-unit COGS" });
      continue;
    }
    if (isDiscontinued(skuRaw)) {
      skipped.push({ sku: skuRaw, why: "discontinued — no reorder, so a recovered unit is worth nothing" });
      continue;
    }
    const e = econ.get(key);
    const rs = returnsRes.skus?.[skuRaw];
    const cs = csv?.bySku[key];

    const aspRow = asp?.bySku[key];
    const price = aspRow?.avgPrice ?? e?.price ?? null;
    const priceSource: "asp" | "list" | "none" = aspRow ? "asp" : e?.price ? "list" : "none";
    const asin = e?.asin ?? cs?.asin ?? null;

    // Physical returns + disposition mix. CSV wins when present.
    const physical = cs ? cs.physical : rs?.physicalReturnTotal ?? 0;
    const sellableRate = cs ? cs.sellableRate : rs?.sellableBackRate ?? null;
    const damagedRate = cs
      ? cs.damagedRate
      : physical > 0
        ? (rs?.customerDamaged ?? 0) / physical
        : 0;

    // TOTAL returns (incl. returnless) only exist in the dashboard paste.
    const dashTotal =
      (asin ? pasted?.byAsin[asin.toLowerCase()] : undefined) ?? pasted?.byAsin[key];
    const pastedRow = pasted?.rows.find(
      (r) => r.asin.toLowerCase() === (asin ?? "").toLowerCase(),
    );

    if (!price || !e) {
      skipped.push({ sku: skuRaw, why: "no price/fee data in the FBA fees report" });
      continue;
    }
    if (physical < 1 && !dashTotal) {
      skipped.push({ sku: skuRaw, why: "no returns in the window" });
      continue;
    }

    const { cogs, source } = resolveCogs(cogsStore, skuRaw, price);
    if (cogs == null) {
      decisions.push(noCogsDecision(skuRaw, asin, price));
      continue;
    }

    const total = dashTotal ?? physical; // without the paste we only see physical
    const returnless = Math.max(0, total - physical);

    const weightOz = (e.weightLb ?? 0) * 16;
    const disposal = disposalFeeFor(removals, skuRaw, e.fbaFee ?? 0, tierIndex, asin);
    decisions.push(
      decide({
        sku: skuRaw,
        asin,
        price,
        referralFee: e.referralFee ?? price * 0.15,
        fbaFee: e.fbaFee ?? 0,
        cogs,
        cogsSource: source === "none" ? "ratio" : source,
        sellableRate: sellableRate ?? 0.6,
        damagedRate,
        totalRefunds: total,
        physicalRefunds: physical,
        returnlessRefunds: returnless,
        displayedReturnRate:
          pastedRow?.returnRatePct != null ? pastedRow.returnRatePct / 100 : null,
        threshold: thresholdForCategory(FEE_CATEGORY),
        returnsFeePerUnit: returnsProcessingFee(toSizeTier(e.sizeTier), weightOz),
        valueRecoveryEnabled: false,
        annualUnits: aspRow?.units ?? annualUnits(velocity[key]),
        priceSource,
        disposalFeePerUnit: disposal.fee,
        disposalFeeEstimated: disposal.estimated,
      }),
    );

    // ── the same SKU through the workbook's model
    if (!cs) {
      modelSkipped.push({ sku: skuRaw, why: "no returns CSV row for this SKU" });
    } else if (typeof cs.unsellableMeasured !== "number") {
      // A store written before the status column was parsed. Undefined here
      // would divide into NaN and quietly poison every unit count, so say so.
      modelSkipped.push({
        sku: skuRaw,
        why: "returns CSV was uploaded before the status column was read — re-upload it",
      });
    } else if (cs.unsellableMeasured <= 0) {
      modelSkipped.push({ sku: skuRaw, why: "no unsellable returns measured for this SKU" });
    } else if (!price || total <= 0) {
      modelSkipped.push({ sku: skuRaw, why: "no price or no refunds in the window" });
    } else {
      const unsellable = cs.physical - cs.sellable;
      // Sales & Traffic units ordered over the same window. The workbook uses
      // the ledger's shipped count; on SEZ0101002 the two are 73,486 vs 73,700,
      // so the return rate this drives is the same to a tenth of a percent.
      const shipped = aspRow?.units ?? annualUnits(velocity[key]) ?? null;
      if (!shipped) {
        modelSkipped.push({ sku: skuRaw, why: "units shipped unknown, so the return rate cannot be measured" });
      } else {
        const m = runReturnsModel({
          sku: skuRaw,
          price,
          referralFee: e?.referralFee ?? price * 0.15,
          fbaFee: e?.fbaFee ?? 0,
          cogs,
          // Amazon bills the removal fee on donated units too, so it applies to
          // every unsellable unit, not only the ones it destroys.
          removalCostPerUnsellable:
            (disposal.fee ?? 0) *
            ((cs.donated + cs.disposed) / Math.max(1, cs.unsellableMeasured)),
          unitsShipped: shipped,
          refunds: total,
          sellableReturns: cs.sellable,
          unsellableReturns: unsellable,
          // Reimbursement counts are not in the returns report; the status
          // column's own "Reimbursed" grade is the closest measured stand-in.
          reimbursedCameBack: cs.statusReimbursed,
          reimbursedStayedAway: 0,
          backToStockShare: cs.backToStock / cs.unsellableMeasured,
          reimbursedShare: cs.statusReimbursed / cs.unsellableMeasured,
          returnsProcessingFeeYear: 0,
          actualReturnRate: 0.7,
        });
        if (!tiesOut(m, total)) {
          modelSkipped.push({ sku: skuRaw, why: "units did not tie back to refunds issued" });
        } else {
          models[skuRaw] = m;
        }
      }
    }
  }

  // Rank by annualised revenue and stamp each SKU's cumulative share, so the
  // UI can filter to "the SKUs that make up N% of revenue".
  const totalRevenue = decisions.reduce((s2, d) => s2 + (d.annualRevenue ?? 0), 0);
  if (totalRevenue > 0) {
    let running = 0;
    for (const d of [...decisions].sort((a, b) => (b.annualRevenue ?? 0) - (a.annualRevenue ?? 0))) {
      running += d.annualRevenue ?? 0;
      d.cumulativeRevenueShare = running / totalRevenue;
    }
  }

  decisions.sort((a, b) => b.annualDelta - a.annualDelta);

  const withCogs = decisions.filter((d) => d.verdict !== "no_cogs");
  const totals = {
    skus: decisions.length,
    skusWithCogs: withCogs.length,
    switchCount: withCogs.filter((d) => d.verdict === "switch_to_return_required").length,
    switchAnnual: round2(
      withCogs
        .filter((d) => d.verdict === "switch_to_return_required")
        .reduce((s, d) => s + d.annualDelta, 0),
    ),
    totalRefunds: withCogs.reduce((s, d) => s + d.totalRefunds, 0),
    totalReturnless: withCogs.reduce((s, d) => s + d.returnlessRefunds, 0),
    /** Fees you lose on every refund no matter what — the prevention prize. */
    annualUnrecoverableFees: round2(
      withCogs.reduce((s, d) => s + d.unrecoverableFeePerRefund * d.totalRefunds, 0),
    ),
    currentAnnualCost: round2(withCogs.reduce((s, d) => s + d.currentAnnualCost, 0)),
    /** Revenue across costed SKUs — denominator for the health ratio. */
    costedRevenue: withCogs.reduce((s, d) => s + (d.annualRevenue ?? 0), 0),
    /** SKUs whose rate would sit above the category threshold if switched. */
    feeRiskSkus: withCogs.filter((d) => d.breachesThresholdIfSwitched).length,
    /** Average all-in cost of one refund — drives the prevention estimate. */
    avgCostPerRefund: 0,
    /** Stock we would stop buying if every positive SKU switched. */
    inventorySaved: round2(
      withCogs.filter((d) => d.annualDelta > 0).reduce((s, d) => s + (d.pnl?.inventorySaved ?? 0), 0),
    ),
    /** Disposal fees that switching would create, on those same SKUs. */
    disposalCost: round2(
      withCogs.filter((d) => d.annualDelta > 0).reduce((s, d) => s + (d.pnl?.disposalCost ?? 0), 0),
    ),
  };
  const _refunds = totals.totalRefunds;
  totals.avgCostPerRefund = _refunds > 0 ? round2(totals.currentAnnualCost / _refunds) : 0;

  return NextResponse.json({
    ready: feesRes.ready === true && (!!csv || returnsRes.ready === true),
    hasDashboardPaste: !!pasted,
    econ: { source: econSource, updatedAt: econUpdatedAt, count: econ.size },
    asp: asp
      ? { updatedAt: asp.updatedAt, windowStart: asp.windowStart, windowEnd: asp.windowEnd, skuCount: Object.keys(asp.bySku).length }
      : null,
    totalAnnualRevenue: Math.round(totalRevenue),
    // The five-outcome model, as the workbook computes it.
    model: {
      skus: Object.keys(models).length,
      skipped: modelSkipped.slice(0, 40),
      totalDifference: Math.round(
        Object.values(models).reduce((t, m) => t + m.difference, 0),
      ),
      switch: Object.values(models).filter((m) => m.verdict === "switch").length,
      keep: Object.values(models).filter((m) => m.verdict === "keep").length,
      rows: Object.values(models)
        .sort((a, b) => b.difference - a.difference)
        .map((m) => ({
          sku: m.sku,
          verdict: m.verdict,
          difference: Math.round(m.difference),
          totalToday: Math.round(m.totalToday),
          totalAfter: Math.round(m.totalAfter),
          reimbursementPerUnit: m.reimbursementPerUnit,
          feesLostPerRefund: m.feesLostPerRefund,
          resellableShare: m.resellableShare,
          keptByCustomer: Math.round(m.keptByCustomer),
          outcomes: m.outcomes.map((o2) => ({
            key: o2.key,
            label: o2.label,
            unitsToday: Math.round(o2.unitsToday),
            unitsAfter: Math.round(o2.unitsAfter),
            perUnit: Math.round(o2.perUnit * 100) / 100,
          })),
        })),
    },
    returnsCsv: csv
      ? {
          filename: csv.filename,
          uploadedAt: csv.uploadedAt,
          windowStart: csv.windowStart,
          windowEnd: csv.windowEnd,
          usRows: csv.usRows,
          canadaRows: csv.canadaRows,
          skuCount: Object.keys(csv.bySku).length,
        }
      : null,
    removals: removals
      ? {
          updatedAt: removals.updatedAt,
          totalUnits: removals.totalUnits,
          totalFee: removals.totalFee,
          avgDisposalFeePerUnit: removals.avgDisposalFeePerUnit,
          orderTypes: removals.orderTypes,
          skuCount: Object.keys(removals.bySku).length,
        }
      : null,
    cogs: {
      count: Object.keys(cogsStore.bySku).length,
      defaultRatioOfPrice: cogsStore.defaultRatioOfPrice,
      updatedAt: cogsStore.updatedAt,
    },
    feeCategory: FEE_CATEGORY,
    threshold: thresholdForCategory(FEE_CATEGORY),
    totals,
    decisions,
    skipped,
  });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
