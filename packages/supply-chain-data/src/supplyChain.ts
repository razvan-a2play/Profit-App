// Supply-chain assessment: what each product costs to hold and move, and
// whether the stock behind it is working.
//
// The storage page reports what Amazon billed. This turns those bills into a
// per-SKU judgement by putting them next to the thing that justifies them —
// how fast the SKU actually sells.
//
// Two kinds of number live here, and they are never mixed up:
//   MEASURED   Amazon billed this SKU this amount (FBA storage, per ASIN).
//   ALLOCATED  Amazon billed the account one figure and it has been shared out
//              (AWD storage, receiving, transport). Useful for comparing SKUs,
//              not for disputing a charge.

import type { AwdStockRow, BilledFees, PlanningRow, StorageSkuRow } from "./storageCosts";

export type { AwdStockRow };

/** Cover beyond this is stock that is paying rent without earning. */
export const OVERSTOCKED_DAYS = 180;
/** Amazon's low-inventory-level fee starts under 28 days of cover. */
export const THIN_COVER_DAYS = 28;
/** Aged-inventory surcharge begins at 181 days in a fulfilment centre. */
export const AGED_DAYS = 181;

export type Verdict =
  | "stockout_risk"
  | "overstocked"
  | "storage_heavy"
  | "dead_stock"
  | "healthy"
  | "no_data";

export interface SkuAssessment {
  sku: string;
  asin: string;
  productName: string;

  unitsSoldT30: number | null;
  unitsSoldT90: number | null;
  fbaUnits: number | null;
  awdUnits: number | null;
  daysOfSupply: number | null;
  sellThrough: number | null;

  /** MEASURED: Amazon's storage bill for this ASIN this month. */
  fbaStorage: number;
  /** ALLOCATED: this SKU's share of the AWD charges, by units held at AWD. */
  awdStorageAllocated: number;
  awdHandlingAllocated: number;
  /** Everything above, for the month. */
  totalCost: number;
  /** Cost to hold and move one unit sold this month. */
  costPerUnitSold: number | null;
  /** Monthly storage per unit sitting in stock — the rent on one unit. */
  storagePerUnitHeld: number | null;
  /** Storage cost as a share of what the stock sells for. */
  costShareOfRevenue: number | null;
  revenue: number | null;

  verdict: Verdict;
  reasons: string[];
}

export interface SupplyChainReport {
  month: string;
  /** Charges that could be tied to a specific ASIN. */
  measuredTotal: number;
  /** Charges shared out across SKUs because Amazon bills them account-wide. */
  allocatedTotal: number;
  utilizationWeeks: number | null;
  skus: SkuAssessment[];
  counts: Record<Verdict, number>;
  /** Portfolio-level findings worth acting on, biggest first. */
  headlines: string[];
}

interface Inputs {
  month: string;
  storageRows: StorageSkuRow[];
  planning: PlanningRow[];
  awdStock: AwdStockRow[];
  billed: BilledFees | null;
  /** sku -> selling price, from the fee report. */
  priceBySku?: Record<string, number>;
  /** sku -> asin, so planning and storage rows can be matched. */
  asinBySku?: Record<string, string>;
  utilizationWeeks?: number | null;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Build the assessment. Everything is derived here rather than in the
 * component, so the same numbers can be exported or tested without a browser.
 */
export function assessSupplyChain(i: Inputs): SupplyChainReport {
  const planByAsin = new Map<string, PlanningRow>();
  const planBySku = new Map<string, PlanningRow>();
  for (const p of i.planning) {
    if (p.asin) planByAsin.set(p.asin.toUpperCase(), p);
    if (p.sku) planBySku.set(p.sku.toUpperCase(), p);
  }
  const awdBySku = new Map(i.awdStock.map((a) => [a.sku.toUpperCase(), a]));

  // AWD charges are billed to the account, not the ASIN, so they are shared out
  // by units held at AWD. Stated as allocated wherever they are shown.
  const awdStorageTotal = i.billed?.by_group?.awd_storage ?? 0;
  const awdHandlingTotal =
    (i.billed?.by_group?.awd_receiving ?? 0) + (i.billed?.by_group?.awd_transportation ?? 0);
  const awdUnitsTotal = sum(i.awdStock.map((a) => a.available + a.reserved + a.toFba));

  // One row per SKU that exists anywhere: storage bill, AWD stock, or planning.
  const skus = new Set<string>();
  const skuByAsin = new Map<string, string>();
  for (const [sku, asin] of Object.entries(i.asinBySku ?? {})) {
    skuByAsin.set(asin.toUpperCase(), sku);
    skus.add(sku.toUpperCase());
  }
  for (const a of i.awdStock) skus.add(a.sku.toUpperCase());
  for (const p of i.planning) if (p.sku) skus.add(p.sku.toUpperCase());
  for (const r of i.storageRows) {
    const sku = skuByAsin.get(r.asin.toUpperCase());
    if (sku) skus.add(sku.toUpperCase());
  }

  const out: SkuAssessment[] = [];
  for (const sku of skus) {
    const asin = (i.asinBySku?.[sku] ?? planBySku.get(sku)?.asin ?? "").toUpperCase();
    const storage = i.storageRows.filter((r) => r.asin.toUpperCase() === asin);
    const plan = planBySku.get(sku) ?? (asin ? planByAsin.get(asin) : undefined);
    const awd = awdBySku.get(sku);

    const fbaStorage = sum(storage.map((r) => r.fee));
    const awdUnits = awd ? awd.available + awd.reserved + awd.toFba : 0;
    const share = awdUnitsTotal > 0 ? awdUnits / awdUnitsTotal : 0;
    const awdStorageAllocated = awdStorageTotal * share;
    const awdHandlingAllocated = awdHandlingTotal * share;
    const totalCost = fbaStorage + awdStorageAllocated + awdHandlingAllocated;

    const fbaUnits = sum(storage.map((r) => r.avg_units)) || null;
    const unitsSoldT30 = plan?.units_shipped_t90 != null ? Math.round(plan.units_shipped_t90 / 3) : null;
    const price = i.priceBySku?.[sku] ?? null;
    const revenue = price != null && unitsSoldT30 != null ? price * unitsSoldT30 : null;

    const assessment: SkuAssessment = {
      sku,
      asin,
      productName: storage[0]?.product_name ?? "",
      unitsSoldT30,
      unitsSoldT90: plan?.units_shipped_t90 ?? null,
      fbaUnits,
      awdUnits: awd ? awdUnits : null,
      daysOfSupply: plan?.days_of_supply ?? null,
      sellThrough: plan?.sell_through ?? null,
      fbaStorage: round(fbaStorage),
      awdStorageAllocated: round(awdStorageAllocated),
      awdHandlingAllocated: round(awdHandlingAllocated),
      totalCost: round(totalCost),
      costPerUnitSold: unitsSoldT30 && unitsSoldT30 > 0 ? round(totalCost / unitsSoldT30, 3) : null,
      storagePerUnitHeld: fbaUnits && fbaUnits > 0 ? round(fbaStorage / fbaUnits, 3) : null,
      costShareOfRevenue: revenue && revenue > 0 ? round(totalCost / revenue, 4) : null,
      revenue: revenue != null ? round(revenue) : null,
      verdict: "no_data",
      reasons: [],
    };
    // Only judge a SKU whose sales figure Amazon actually reported. A planning
    // row with an empty units-shipped column is still missing data: having the
    // row is not having the number.
    out.push(judge(assessment, plan != null && plan.units_shipped_t90 != null));
  }

  out.sort((a, b) => b.totalCost - a.totalCost);

  const counts = out.reduce(
    (acc, s) => ({ ...acc, [s.verdict]: (acc[s.verdict] ?? 0) + 1 }),
    {} as Record<Verdict, number>,
  );

  return {
    month: i.month,
    measuredTotal: round(sum(out.map((s) => s.fbaStorage))),
    allocatedTotal: round(sum(out.map((s) => s.awdStorageAllocated + s.awdHandlingAllocated))),
    utilizationWeeks: i.utilizationWeeks ?? null,
    skus: out,
    counts,
    headlines: headline(out, i),
  };
}

/**
 * One verdict per SKU, with the reasons that produced it.
 *
 * `hasSalesData` matters more than it looks: without it, a SKU whose planning
 * row simply didn't load reads as "sold nothing in 90 days" and gets called
 * dead stock. Absence of evidence is not evidence of zero, so a SKU with no
 * sales figures is reported as unknown, never condemned.
 */
function judge(s: SkuAssessment, hasSalesData: boolean): SkuAssessment {
  const reasons: string[] = [];
  let verdict: Verdict = "healthy";

  const sells = (s.unitsSoldT90 ?? 0) > 0;
  const hasStock = (s.fbaUnits ?? 0) > 0 || (s.awdUnits ?? 0) > 0;

  if (!hasSalesData) {
    return {
      ...s,
      verdict: "no_data",
      reasons: [
        hasStock
          ? `Holding ${fmt((s.fbaUnits ?? 0) + (s.awdUnits ?? 0))} units, but Amazon's inventory planning report had no sales figures for this SKU — no verdict without them.`
          : "No sales figures and no stock for this SKU.",
      ],
    };
  }

  if (!sells && !hasStock) {
    return { ...s, verdict: "no_data", reasons: ["No sales and no stock in the window."] };
  }

  if (!sells && hasStock) {
    verdict = "dead_stock";
    reasons.push(
      `No units shipped in 90 days while holding ${fmt(s.fbaUnits ?? 0)} at FBA and ${fmt(s.awdUnits ?? 0)} at AWD — ` +
        `$${s.totalCost.toFixed(2)} a month of storage with nothing coming back.`,
    );
  } else if (s.daysOfSupply != null && s.daysOfSupply > OVERSTOCKED_DAYS) {
    verdict = "overstocked";
    reasons.push(
      `${Math.round(s.daysOfSupply)} days of cover. Stock past ${AGED_DAYS} days in a fulfilment centre also starts paying the aged-inventory surcharge.`,
    );
  } else if (s.daysOfSupply != null && s.daysOfSupply < THIN_COVER_DAYS && sells) {
    verdict = "stockout_risk";
    reasons.push(
      `Only ${Math.round(s.daysOfSupply)} days of cover — under ${THIN_COVER_DAYS}, which is where Amazon's low-inventory-level fee starts.`,
    );
  }

  // Independent of cover: the cost of holding it may simply be too high a share
  // of what it earns.
  if (s.costShareOfRevenue != null && s.costShareOfRevenue > 0.05) {
    reasons.push(
      `Storage and handling is ${(s.costShareOfRevenue * 100).toFixed(1)}% of this SKU's monthly revenue.`,
    );
    if (verdict === "healthy") verdict = "storage_heavy";
  }

  if (verdict === "healthy") {
    reasons.push(
      s.daysOfSupply != null
        ? `${Math.round(s.daysOfSupply)} days of cover, ${s.costPerUnitSold != null ? `$${s.costPerUnitSold.toFixed(3)}` : "—"} of storage per unit sold.`
        : "Selling, with no cover or cost flags.",
    );
  }
  return { ...s, verdict, reasons };
}

/** The few portfolio-level sentences worth reading first. */
function headline(rows: SkuAssessment[], i: Inputs): string[] {
  const out: string[] = [];
  const dead = rows.filter((r) => r.verdict === "dead_stock");
  const over = rows.filter((r) => r.verdict === "overstocked");
  const thin = rows.filter((r) => r.verdict === "stockout_risk");

  const unknown = rows.filter((r) => r.verdict === "no_data" && r.totalCost > 0);
  if (unknown.length) {
    out.push(
      `${unknown.length} SKU${unknown.length === 1 ? "" : "s"} carrying $${sum(unknown.map((r) => r.totalCost)).toFixed(0)} of cost have no sales figures in the planning report, so they are not judged here.`,
    );
  }
  if (dead.length) {
    const cost = sum(dead.map((r) => r.totalCost));
    out.push(
      `${dead.length} SKU${dead.length === 1 ? "" : "s"} sold nothing in 90 days and cost $${cost.toFixed(0)} this month to store.`,
    );
  }
  if (over.length) {
    const cost = sum(over.map((r) => r.totalCost));
    out.push(
      `${over.length} SKU${over.length === 1 ? "" : "s"} hold more than ${OVERSTOCKED_DAYS} days of cover — $${cost.toFixed(0)} of storage a month against stock that is turning slowly.`,
    );
  }
  if (thin.length) {
    out.push(
      `${thin.length} SKU${thin.length === 1 ? "" : "s"} ${thin.length === 1 ? "is" : "are"} under ${THIN_COVER_DAYS} days of cover and exposed to the low-inventory-level fee: ${thin
        .slice(0, 4)
        .map((r) => r.sku)
        .join(", ")}.`,
    );
  }
  if (i.utilizationWeeks != null) {
    out.push(
      i.utilizationWeeks > 26
        ? `Storage utilisation is ${i.utilizationWeeks} weeks, past the 26-week line where Amazon adds the utilisation surcharge.`
        : `Storage utilisation is ${i.utilizationWeeks} weeks, comfortably inside the 26-week surcharge threshold.`,
    );
  }
  return out;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}
