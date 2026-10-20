// Month-by-month supply-chain costs: what it cost to fulfil, store and move
// the stock, set against what it sold.
//
// The one rule that shapes everything here: Amazon bills storage a month in
// arrears. The FBA and AWD storage posted in September is August's storage
// (the AWD charge even says so in its reference, "US-2026-08-…"). Pairing each
// month's sales with the storage posted that month would compare August's
// sales with July's storage, so storage is moved back to the month it was for.
// Activity charges — fulfilment, AWD processing and transport, placement,
// removals — are billed as the work happens and stay where they posted.
//
// Per SKU, fulfilment fees and sales are MEASURED (Amazon itemises them per
// order line). FBA storage per SKU comes from the storage-fee report, which is
// Amazon's per-ASIN estimate for the month. AWD is billed to the account, so it
// is only shown at portfolio level here rather than shared out by a guess.

import { ACCOUNT_LEVEL_SKU, type BilledCharge, type BilledFees, type StorageFeeResult } from "./storageCosts";

/** Just the parts of a cached month this report reads. */
export interface MonthCostsInput {
  billed: BilledFees | null;
  storage: StorageFeeResult | null;
  monthUnavailable?: boolean;
}

export const FULFILMENT_FEE = "FBAPerUnitFulfillmentFee";
export const REFERRAL_FEE = "Commission";

export type StorageSource =
  /** The storage charge Amazon posted the following month: the invoice. */
  | "billed"
  /** The storage-fee report's figure, used until the invoice posts. */
  | "estimate";

export interface MonthSummary {
  month: string;
  /** This month's own fee scan has finished. */
  feesReady: boolean;
  /** The scan finished but predates per-SKU sales, so sales are unknown rather than zero. */
  salesMissing: boolean;
  /** Amazon's finance API, or Helium 10 for months older than Amazon will return. */
  source: "amazon" | "helium";
  unitsSold: number;
  unitsRefunded: number;
  grossSales: number;
  refunds: number;
  netSales: number;

  fulfilmentFees: number;
  referralFees: number;
  /** Every other order-level fee (variable closing, digital services...). */
  otherOrderFees: number;

  /** FBA storage for the month, from the invoice when it has posted. Null until either source exists. */
  fbaStorage: number | null;
  fbaStorageSource: StorageSource | null;
  /** Posted with storage, a month in arrears: null until that invoice is in. */
  agedSurcharge: number | null;
  awdStorage: number | null;
  awdProcessing: number;
  awdTransport: number;
  fbaInbound: number;
  removals: number;

  /** Fulfilment + storage + AWD + inbound + removals. Excludes referral fees, which are a selling cost. */
  supplyChainCost: number;
  /** FBA + AWD storage as a share of net sales. */
  storageShareOfSales: number | null;
  supplyChainShareOfSales: number | null;
  fulfilmentPerUnit: number | null;
  /** Amazon's storage utilisation ratio, in weeks of supply. */
  utilizationWeeks: number | null;
  /** Units Amazon averaged in FBA storage over the month, from the storage report. */
  avgUnitsStored: number | null;
}

export interface SkuMonthRow {
  month: string;
  sku: string;
  asin: string;
  productName: string;
  unitsSold: number;
  unitsRefunded: number;
  netSales: number;
  fulfilmentFees: number;
  fulfilmentPerUnit: number | null;
  referralFees: number;
  /** This SKU's share of its ASIN's storage-report fee. Null when the month has no storage report. */
  fbaStorage: number | null;
  avgUnitsStored: number | null;
  storagePerUnitSold: number | null;
  storageShareOfSales: number | null;
  /** Fulfilment + FBA storage as a share of net sales. */
  costShareOfSales: number | null;
}

export interface MonthlyReport {
  months: MonthSummary[];
  skus: SkuMonthRow[];
}

export interface MonthlyInputs {
  /** Months to report, any order; output is oldest first. */
  months: string[];
  /** Cached costs per month. Include the month after the last one, if known, for its storage invoice. */
  costsByMonth: Record<string, MonthCostsInput | null | undefined>;
  /** SKU -> ASIN, to tie the per-ASIN storage report to SKUs. */
  asinBySku: Record<string, string>;
  productNameBySku?: Record<string, string>;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The `count` closed months ending with `last`, oldest first. */
export function monthRange(last: string, count: number): string[] {
  const out = [last];
  while (out.length < count) out.unshift(prevMonth(out[0]));
  return out;
}

/**
 * The month a storage charge was for. AWD's reference names it; FBA's carries
 * no reference, so it is the month before the one it posted in.
 */
export function storageMonthOf(charge: BilledCharge, postedInMonth: string): string {
  const named = /(\d{4}-\d{2})/.exec(charge.reference ?? "");
  return named ? named[1] : prevMonth(postedInMonth);
}

/**
 * A charge's effect on AWD storage, or null if it is not AWD storage.
 * Amazon posts adjustments as their own fee types — STARStorageFee-Reversal
 * (a refund) and STARStorageFee-Correction (a re-charge) — which the gateway
 * files under "other". Amounts arrive unsigned, so the name gives the sign.
 */
export function awdStorageEffect(c: BilledCharge): number | null {
  if (c.group === "awd_storage") return c.amount;
  if (!c.fee_type.startsWith("STARStorageFee")) return null;
  return /reversal|refund|credit/i.test(c.fee_type) ? -c.amount : c.amount;
}

export function buildMonthlyReport(i: MonthlyInputs): MonthlyReport {
  const months = [...new Set(i.months)].sort();
  const asinBySku = new Map(Object.entries(i.asinBySku).map(([s, a]) => [s.toUpperCase(), a.toUpperCase()]));
  const nameBySku = new Map(Object.entries(i.productNameBySku ?? {}).map(([s, n]) => [s.toUpperCase(), n]));

  // Storage charges, re-filed under the month they were for, from every scan
  // available — a month's storage lives in the following month's scan.
  const fbaStorageFor = new Map<string, number>();
  const agedFor = new Map<string, number>();
  const awdStorageFor = new Map<string, number>();
  /** Months whose storage invoice can have posted: the following month's scan finished. */
  const invoicedFor = new Set<string>();
  for (const [posted, costs] of Object.entries(i.costsByMonth)) {
    if (!costs?.billed?.ready) continue;
    if (costs.billed.storageKnown !== false) invoicedFor.add(prevMonth(posted));
    for (const c of costs.billed.charges) {
      const awd = awdStorageEffect(c);
      const bucket =
        c.fee_type === "FBALongTermStorageFee"
          ? agedFor
          : c.group === "fba_storage"
            ? fbaStorageFor
            : awd != null
              ? awdStorageFor
              : null;
      if (!bucket) continue;
      const m = storageMonthOf(c, posted);
      bucket.set(m, (bucket.get(m) ?? 0) + (awd ?? c.amount));
    }
  }

  const summaries: MonthSummary[] = [];
  const skuRows: SkuMonthRow[] = [];

  for (const month of months) {
    const costs = i.costsByMonth[month] ?? null;
    const billed = costs?.billed?.ready ? costs.billed : null;
    const bySku = billed?.by_sku;
    const group = (g: string) => (billed?.by_group as Record<string, number> | undefined)?.[g] ?? 0;

    // ── per SKU ──
    const storageRows = costs?.storage?.ready ? costs.storage.rows : [];
    const storageByAsin = new Map<string, { fee: number; units: number; name: string }>();
    for (const r of storageRows) {
      const k = r.asin.toUpperCase();
      const cur = storageByAsin.get(k) ?? { fee: 0, units: 0, name: r.product_name };
      cur.fee += r.fee;
      cur.units += r.avg_units;
      storageByAsin.set(k, cur);
    }

    const sales = new Map<string, NonNullable<BilledFees["by_sku"]>[string]>();
    for (const [sku, s] of Object.entries(bySku ?? {})) sales.set(sku.toUpperCase(), s);

    // Every SKU that sold, or that has an ASIN Amazon charged storage for.
    const skus = new Set<string>([...sales.keys()].filter((k) => k !== ACCOUNT_LEVEL_SKU));
    const skusByAsin = new Map<string, string[]>();
    for (const [sku, asin] of asinBySku) {
      if (storageByAsin.has(asin)) skus.add(sku);
    }
    for (const sku of skus) {
      const asin = asinBySku.get(sku);
      if (!asin) continue;
      skusByAsin.set(asin, [...(skusByAsin.get(asin) ?? []), sku]);
    }

    const monthSkuRows: SkuMonthRow[] = [];
    for (const sku of skus) {
      const s = sales.get(sku);
      const asin = asinBySku.get(sku) ?? "";
      const units = s?.units_sold ?? 0;
      const netSales = s ? s.sales - s.refunds : 0;
      const fulfilment = s?.fees[FULFILMENT_FEE] ?? 0;
      const referral = s?.fees[REFERRAL_FEE] ?? 0;

      // An ASIN sold under several SKUs is billed once; share it by units sold,
      // or evenly when none of them sold.
      let fbaStorage: number | null = null;
      let avgUnitsStored: number | null = null;
      const st = asin ? storageByAsin.get(asin) : undefined;
      if (costs?.storage?.ready) {
        fbaStorage = 0;
        if (st) {
          const siblings = skusByAsin.get(asin) ?? [sku];
          const siblingUnits = sum(siblings.map((x) => sales.get(x)?.units_sold ?? 0));
          const share = siblingUnits > 0 ? units / siblingUnits : 1 / siblings.length;
          fbaStorage = st.fee * share;
          avgUnitsStored = st.units * share;
        }
      }

      monthSkuRows.push({
        month,
        sku,
        asin,
        productName: nameBySku.get(sku) ?? st?.name ?? "",
        unitsSold: units,
        unitsRefunded: s?.units_refunded ?? 0,
        netSales: round(netSales),
        fulfilmentFees: round(fulfilment),
        fulfilmentPerUnit: units > 0 ? round(fulfilment / units, 3) : null,
        referralFees: round(referral),
        fbaStorage: fbaStorage != null ? round(fbaStorage) : null,
        avgUnitsStored: avgUnitsStored != null ? Math.round(avgUnitsStored) : null,
        storagePerUnitSold: fbaStorage != null && units > 0 ? round(fbaStorage / units, 3) : null,
        storageShareOfSales: fbaStorage != null && netSales > 0 ? round(fbaStorage / netSales, 4) : null,
        costShareOfSales: netSales > 0 ? round((fulfilment + (fbaStorage ?? 0)) / netSales, 4) : null,
      });
    }
    monthSkuRows.sort((a, b) => b.netSales - a.netSales);
    skuRows.push(...monthSkuRows);

    // ── portfolio ──
    const all = [...sales.values()];
    const grossSales = sum(all.map((s) => s.sales));
    const refunds = sum(all.map((s) => s.refunds));
    const netSales = grossSales - refunds;
    const unitsSold = sum(all.map((s) => s.units_sold));
    const fulfilmentFees = sum(all.map((s) => s.fees[FULFILMENT_FEE] ?? 0));
    const referralFees = sum(all.map((s) => s.fees[REFERRAL_FEE] ?? 0));
    const otherOrderFees = sum(
      all.map((s) =>
        sum(Object.entries(s.fees).filter(([k]) => k !== FULFILMENT_FEE && k !== REFERRAL_FEE).map(([, v]) => v)),
      ),
    );

    const invoiced = invoicedFor.has(month);
    const estimate = costs?.storage?.ready ? costs.storage.totals?.fee ?? null : null;
    const fbaStorage = invoiced ? fbaStorageFor.get(month) ?? 0 : estimate;
    const fbaStorageSource: StorageSource | null = invoiced ? "billed" : estimate != null ? "estimate" : null;
    const agedSurcharge = invoiced || agedFor.has(month) ? agedFor.get(month) ?? 0 : null;
    const awdStorage = invoiced || awdStorageFor.has(month) ? awdStorageFor.get(month) ?? 0 : null;
    const awdProcessing = group("awd_receiving");
    const awdTransport = group("awd_transportation");
    const fbaInbound = group("fba_inbound");
    const removals = group("fba_removal");

    const supplyChainCost =
      fulfilmentFees + (fbaStorage ?? 0) + (agedSurcharge ?? 0) + (awdStorage ?? 0) + awdProcessing + awdTransport + fbaInbound + removals;
    const storage = (fbaStorage ?? 0) + (agedSurcharge ?? 0) + (awdStorage ?? 0);
    const salesKnown = billed != null && bySku != null;

    summaries.push({
      month,
      feesReady: billed != null,
      salesMissing: billed != null && bySku == null,
      source: billed?.source ?? "amazon",
      unitsSold,
      unitsRefunded: sum(all.map((s) => s.units_refunded)),
      grossSales: round(grossSales),
      refunds: round(refunds),
      netSales: round(netSales),
      fulfilmentFees: round(fulfilmentFees),
      referralFees: round(referralFees),
      otherOrderFees: round(otherOrderFees),
      fbaStorage: fbaStorage != null ? round(fbaStorage) : null,
      fbaStorageSource,
      agedSurcharge: agedSurcharge != null ? round(agedSurcharge) : null,
      awdStorage: awdStorage != null ? round(awdStorage) : null,
      awdProcessing: round(awdProcessing),
      awdTransport: round(awdTransport),
      fbaInbound: round(fbaInbound),
      removals: round(removals),
      supplyChainCost: round(supplyChainCost),
      // A share is only stated when both halves are known: storage still to be
      // invoiced would otherwise read as a cheap month.
      storageShareOfSales:
        salesKnown && netSales > 0 && fbaStorage != null && awdStorage != null ? round(storage / netSales, 4) : null,
      supplyChainShareOfSales:
        salesKnown && netSales > 0 && fbaStorage != null && awdStorage != null
          ? round(supplyChainCost / netSales, 4)
          : null,
      fulfilmentPerUnit: unitsSold > 0 ? round(fulfilmentFees / unitsSold, 3) : null,
      utilizationWeeks: costs?.storage?.ready ? costs.storage.totals?.utilization_ratio_weeks ?? null : null,
      avgUnitsStored: storageRows.length ? Math.round(sum(storageRows.map((r) => r.avg_units))) : null,
    });
  }

  return { months: summaries, skus: skuRows };
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
