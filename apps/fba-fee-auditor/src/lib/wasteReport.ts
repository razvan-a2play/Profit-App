// Consolidates every $-related data source into one waste report:
// fee overcharges, reimbursable damage, non-reimbursable damage, stranded,
// LTSF (active + risk), excess inventory, and returnless-refund overspend.
// Each item is normalized into a WasteAction so they can be ranked side-by-side.

export type WasteCategory =
  | "fee_overcharge"
  | "reimbursable_damage"
  | "stranded"
  | "unfulfillable_loss"
  | "ltsf_active"
  | "ltsf_risk"
  | "excess_inventory"
  | "returnless_overspend";

/** Amazon 2025 LTSF rates ($/unit/month, standard-size approx). */
// The aged-inventory surcharge is priced per CUBIC FOOT, so it cannot be
// derived from unit counts. Amazon publishes its own per-SKU estimate in the
// planning report; that is what both this and the Aged Inventory page use.
import { AIS_ENTRY_RATE_PER_CUFT } from "./agedInventory";

/** Estimated monthly storage fee per unit for oversize-agnostic average. */
const MONTHLY_STORAGE_PER_UNIT = 0.03; // rough $ / unit / month for small std

export interface WasteAction {
  sku: string;
  category: WasteCategory;
  categoryLabel: string;
  /** Short description of what to do about it. */
  action: string;
  /** One-time recoverable dollars right now (0 for pure recurring items). */
  recoverableUsd: number;
  /** Recurring monthly bleed (0 for pure one-time items). */
  monthlyBleedUsd: number;
  /** 12-month annualized $ (12 × monthly + one-time recoverable). Used for sort. */
  annualImpactUsd: number;
  /** Optional deadline (e.g. "18-mo claim window", "Auto-remove 2027-01-17"). */
  deadline?: string;
  /** Deep link to Seller Central page that lets user act on it. */
  href?: string;
  /** Extra detail for the row tooltip / long form. */
  detail?: string;
}

export interface CategorySummary {
  category: WasteCategory;
  label: string;
  recoverableUsd: number;
  monthlyBleedUsd: number;
  itemCount: number;
  primaryHref: string;
  primaryActionLabel: string;
}

export interface WasteReport {
  generatedAt: string;
  totalRecoverableUsd: number;
  totalMonthlyBleedUsd: number;
  totalAnnualImpactUsd: number;
  categories: CategorySummary[];
  actions: WasteAction[];
  sources: {
    audit: { ready: boolean; asOf: string | null };
    inventory: { ready: boolean; asOf: string | null };
    returns: { ready: boolean; asOf: string | null };
  };
}

// ── Category metadata ───────────────────────────────────────────────────────

const CATEGORY_META: Record<WasteCategory, {
  label: string;
  href: string;
  actionLabel: string;
}> = {
  fee_overcharge: {
    label: "FBA fee overcharges",
    href: "https://sellercentral.amazon.com/reportcentral/REIMBURSEMENTS/1",
    actionLabel: "File case",
  },
  reimbursable_damage: {
    label: "Reimbursable damage",
    href: "https://sellercentral.amazon.com/reportcentral/REIMBURSEMENTS/1",
    actionLabel: "File case",
  },
  stranded: {
    label: "Stranded inventory",
    href: "https://sellercentral.amazon.com/inventory?viewFilter=fba&filter=stranded",
    actionLabel: "Fix listing",
  },
  unfulfillable_loss: {
    label: "Unfulfillable (your loss)",
    href: "https://sellercentral.amazon.com/gp/ssof/configuration/index.html",
    actionLabel: "Configure removals",
  },
  ltsf_active: {
    label: "LTSF paying now",
    href: "https://sellercentral.amazon.com/gp/ssof/knight/create-removal-order.html",
    actionLabel: "Remove/liquidate",
  },
  ltsf_risk: {
    label: "LTSF risk (91–180d)",
    href: "https://sellercentral.amazon.com/inventory",
    actionLabel: "Discount to move",
  },
  excess_inventory: {
    label: "Excess inventory (>90 DoS)",
    href: "https://sellercentral.amazon.com/inventory",
    actionLabel: "Discount / pause inbound",
  },
  returnless_overspend: {
    label: "Returnless overspend",
    href: "https://sellercentral.amazon.com/gp/ssof/configuration/index.html",
    actionLabel: "Switch strategy",
  },
};

// ── Builders (one per source) ───────────────────────────────────────────────

interface AuditFindingLite {
  sku: string;
  status: string;
  recoverablePerUnit: number;
  feeDeltaPerUnit: number;
  notes?: string[];
}

export function buildFeeOverchargeActions(findings: AuditFindingLite[]): WasteAction[] {
  const meta = CATEGORY_META.fee_overcharge;
  const rows: WasteAction[] = [];
  for (const f of findings) {
    if (f.status !== "overcharge" || f.recoverablePerUnit <= 0) continue;
    rows.push({
      sku: f.sku,
      category: "fee_overcharge",
      categoryLabel: meta.label,
      action: "File FBA fee reimbursement case",
      recoverableUsd: f.recoverablePerUnit, // per-unit; can't multiply without units sold
      monthlyBleedUsd: 0,
      annualImpactUsd: f.recoverablePerUnit,
      deadline: "60-day dispute window from fee charge",
      href: meta.href,
      detail: `Amazon is charging $${f.feeDeltaPerUnit.toFixed(2)}/unit more than the correct fee.`,
    });
  }
  return rows;
}

interface StrandedLite {
  sku: string;
  quantity: number | null;
  yourPrice: number | null;
  autoRemovalDate: string | null;
  reason: string | null;
}

export function buildStrandedActions(rows: StrandedLite[]): WasteAction[] {
  const meta = CATEGORY_META.stranded;
  const out: WasteAction[] = [];
  for (const r of rows) {
    const qty = r.quantity ?? 0;
    const value = (r.yourPrice ?? 0) * qty;
    if (value <= 0) continue;
    out.push({
      sku: r.sku,
      category: "stranded",
      categoryLabel: meta.label,
      action: "Fix listing to unstrand",
      recoverableUsd: value,
      monthlyBleedUsd: qty * MONTHLY_STORAGE_PER_UNIT,
      annualImpactUsd: value + qty * MONTHLY_STORAGE_PER_UNIT * 12,
      deadline: r.autoRemovalDate ? `Auto-remove ${r.autoRemovalDate}` : undefined,
      href: meta.href,
      detail: `${qty} units stranded (${r.reason ?? "unknown reason"}). Fix listing to unlock sales.`,
    });
  }
  return out;
}

interface UnfulfillableLite {
  sku: string;
  unsellableTotal: number;
  yourPrice: number | null;
  reimbursableTotal?: number;
  reimbursableUsd?: number;
  nonReimbursableTotal?: number;
  bucketsFromAdjustments?: boolean;
  oldestAgeBucket?: string | null;
}

export function buildDamageActions(rows: UnfulfillableLite[]): WasteAction[] {
  const out: WasteAction[] = [];
  for (const r of rows) {
    const price = r.yourPrice ?? 0;
    // Split into reimbursable + non-reimbursable rows so they rank independently.
    if ((r.reimbursableTotal ?? 0) > 0) {
      const meta = CATEGORY_META.reimbursable_damage;
      const recoverable = r.reimbursableUsd ?? 0;
      out.push({
        sku: r.sku,
        category: "reimbursable_damage",
        categoryLabel: meta.label,
        action: "File reimbursement case",
        recoverableUsd: recoverable,
        monthlyBleedUsd: 0,
        annualImpactUsd: recoverable,
        deadline: "18 months from damage date",
        href: meta.href,
        detail: `${r.reimbursableTotal} units damaged by Amazon/carrier/distributor.`,
      });
    }
    const nonReimb = r.nonReimbursableTotal ?? 0;
    if (nonReimb > 0 && price > 0) {
      const meta = CATEGORY_META.unfulfillable_loss;
      // Assume ~30% recoverable via Grade & Resell / Liquidation.
      const recoverable = nonReimb * price * 0.3;
      out.push({
        sku: r.sku,
        category: "unfulfillable_loss",
        categoryLabel: meta.label,
        action: "Enable value recovery (Grade & Resell + Liquidation)",
        recoverableUsd: recoverable,
        monthlyBleedUsd: nonReimb * MONTHLY_STORAGE_PER_UNIT,
        annualImpactUsd: recoverable + nonReimb * MONTHLY_STORAGE_PER_UNIT * 12,
        href: meta.href,
        detail: `${nonReimb} damaged/expired units. Enable Grade & Resell to recover ~30% instead of $0.`,
      });
    }
  }
  return out;
}

interface AgedLite {
  sku: string;
  age91_180: number;
  age181_270: number;
  age271_330: number;
  age331_365: number;
  age365Plus: number;
  yourPrice: number | null;
  /** Amazon's own estimate of next month's surcharge for this SKU. */
  aisMonthly: number;
  itemVolumeCuFt: number | null;
}

export function buildLtsfActions(rows: AgedLite[]): WasteAction[] {
  const out: WasteAction[] = [];
  const activeMeta = CATEGORY_META.ltsf_active;
  const riskMeta = CATEGORY_META.ltsf_risk;
  for (const r of rows) {
    const price = r.yourPrice ?? 0;
    // Amazon's own figure — never re-derived from unit counts, which would
    // apply a per-cubic-foot rate per unit and overstate a small item ~10x.
    const monthlyActive = r.aisMonthly;
    const activeUnits = r.age181_270 + r.age271_330 + r.age331_365 + r.age365Plus;
    if (monthlyActive > 0) {
      out.push({
        sku: r.sku,
        category: "ltsf_active",
        categoryLabel: activeMeta.label,
        action: "Remove or liquidate aged inventory",
        recoverableUsd: 0,
        monthlyBleedUsd: monthlyActive,
        // Annual = 12 mo of LTSF (this is what stops if you remove today).
        annualImpactUsd: monthlyActive * 12,
        href: activeMeta.href,
        detail: `${activeUnits} units aged 181+ days. Paying LTSF now — remove or liquidate to stop the bleed.`,
      });
    }
    // Risk bucket: units aged 91-180. Will hit LTSF at 181 days.
    if (r.age91_180 > 0 && r.itemVolumeCuFt) {
      // Priced on volume at the entry tier, the way Amazon charges it.
      const projectedMonthly = r.age91_180 * r.itemVolumeCuFt * AIS_ENTRY_RATE_PER_CUFT;
      out.push({
        sku: r.sku,
        category: "ltsf_risk",
        categoryLabel: riskMeta.label,
        action: "Discount to sell before day 181",
        recoverableUsd: 0,
        // Not yet paying — annualImpact = what you'd pay over next 12 mo if not sold.
        monthlyBleedUsd: 0,
        annualImpactUsd: projectedMonthly * 12,
        href: riskMeta.href,
        detail: `${r.age91_180} units aged 91–180 days at $${price.toFixed(2)}. The surcharge starts at 181 days.`,
      });
    }
  }
  return out;
}

interface PlanningLite {
  sku: string;
  daysOfSupply: number | null;
  excessUnits: number;
  yourPrice: number | null;
}

export function buildExcessActions(rows: PlanningLite[]): WasteAction[] {
  const meta = CATEGORY_META.excess_inventory;
  const out: WasteAction[] = [];
  for (const r of rows) {
    const dos = r.daysOfSupply ?? 0;
    if (dos <= 90 || r.excessUnits <= 0) continue;
    const price = r.yourPrice ?? 0;
    // Not currently paying LTSF but will if DoS keeps growing. Rough monthly
    // storage cost on the excess portion.
    const monthlyBleed = r.excessUnits * MONTHLY_STORAGE_PER_UNIT;
    out.push({
      sku: r.sku,
      category: "excess_inventory",
      categoryLabel: meta.label,
      action: "Discount or pause inbound",
      recoverableUsd: 0,
      monthlyBleedUsd: monthlyBleed,
      annualImpactUsd: monthlyBleed * 12,
      href: meta.href,
      detail: `${dos.toFixed(0)} days of supply · ${r.excessUnits} excess units at $${price.toFixed(2)}. Will hit LTSF if not moved.`,
    });
  }
  return out;
}

interface ReturnsStrategyLite {
  sku: string;
  verdict: string;
  annualDelta: number;
  savingsPerReturn: number;
  returnlessCount: number;
}

export function buildReturnlessActions(rows: ReturnsStrategyLite[]): WasteAction[] {
  const meta = CATEGORY_META.returnless_overspend;
  const out: WasteAction[] = [];
  for (const r of rows) {
    if (r.verdict !== "switch_to_return_required" || r.annualDelta <= 0) continue;
    out.push({
      sku: r.sku,
      category: "returnless_overspend",
      categoryLabel: meta.label,
      action: "Switch off returnless for this SKU",
      recoverableUsd: 0, // pure recurring
      monthlyBleedUsd: r.annualDelta / 12,
      annualImpactUsd: r.annualDelta,
      href: meta.href,
      detail: `${r.returnlessCount} returnless refunds/yr × $${r.savingsPerReturn.toFixed(2)} savings each = $${r.annualDelta.toFixed(0)}/yr on wrong strategy.`,
    });
  }
  return out;
}

// ── Aggregator ──────────────────────────────────────────────────────────────

export function assembleReport(actions: WasteAction[], sources: WasteReport["sources"]): WasteReport {
  const categories: CategorySummary[] = [];
  const bucket = new Map<WasteCategory, WasteAction[]>();
  for (const a of actions) {
    (bucket.get(a.category) ?? bucket.set(a.category, []).get(a.category)!).push(a);
  }
  for (const [cat, items] of bucket) {
    const meta = CATEGORY_META[cat];
    categories.push({
      category: cat,
      label: meta.label,
      recoverableUsd: items.reduce((s, i) => s + i.recoverableUsd, 0),
      monthlyBleedUsd: items.reduce((s, i) => s + i.monthlyBleedUsd, 0),
      itemCount: items.length,
      primaryHref: meta.href,
      primaryActionLabel: meta.actionLabel,
    });
  }
  categories.sort((a, b) => (b.recoverableUsd + b.monthlyBleedUsd * 12) - (a.recoverableUsd + a.monthlyBleedUsd * 12));

  const ranked = [...actions].sort((a, b) => b.annualImpactUsd - a.annualImpactUsd);

  return {
    generatedAt: new Date().toISOString(),
    totalRecoverableUsd: actions.reduce((s, a) => s + a.recoverableUsd, 0),
    totalMonthlyBleedUsd: actions.reduce((s, a) => s + a.monthlyBleedUsd, 0),
    totalAnnualImpactUsd: actions.reduce((s, a) => s + a.annualImpactUsd, 0),
    categories,
    actions: ranked,
    sources,
  };
}
