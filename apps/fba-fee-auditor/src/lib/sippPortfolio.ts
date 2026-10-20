// Amazon's SIPP Product Portfolio report — which listings are Ships in Product
// Packaging certified, which are eligible but not enrolled, and why the rest
// are excluded.
//
// There is no SP-API report for this (checked against Amazon's report-type
// list and the SP-API client's 158 types), so it arrives as the CSV downloaded
// from Seller Central. It is the right source for SIPP certification because it
// is Amazon's own enrolment record, independent of what Amazon bills: the audit
// can then check the discount is actually applied, which inferring
// certification from a lower fee could never do.

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "sipp-portfolio.json");

/** Only the US marketplace is audited — the fee report is the US one. */
export const AUDITED_MARKETPLACE = "US";

export type SippEligibility = "certified" | "eligible" | "excluded";

export interface SippPortfolioRow {
  asin: string;
  itemName: string;
  eligibility: SippEligibility | string;
  /** "Rigid (Box)", "NONE", "DECERTIFIED", ... as Amazon writes it. */
  certificationStatus: string;
  certificationDate: string | null;
  decertificationDate: string | null;
  marketplace: string;
  currency: string;
  /** Discount per unit Amazon applies now (certified) — null when "N/A". */
  currentBenefit: number | null;
  /** Discount per unit available if enrolled — null when "N/A". */
  perUnitSavings: number | null;
  /** Amazon's estimate over the past 90 days' shipments — null when not a number. */
  savings90d: number | null;
  /** Why it's excluded, or Amazon's note when there's no estimate. */
  reason: string | null;
  primaryAsin: string | null;
}

export interface ParsedPortfolio {
  rows: SippPortfolioRow[];
  /** Data lines that didn't have the header's column count. */
  skipped: number;
}

/**
 * RFC 4180 CSV: quoted fields may hold commas, newlines, and "" for a quote.
 * Amazon's item names do all three ("30"" X-Large | ...").
 */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      out.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  return out;
}

/** "0.23" -> 0.23; "N/A", "", "There was no shipment..." -> null. */
function num(v: string | undefined): number | null {
  if (v == null) return null;
  const t = v.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(t)) return null;
  return parseFloat(t);
}

function orNull(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" || t.toUpperCase() === "N/A" ? null : t;
}

/**
 * Read the report. It opens with a few lines of explanatory text before the
 * real header, so the header is found by its first column rather than assumed
 * to be line one.
 */
export function parseSippPortfolio(text: string): ParsedPortfolio {
  const table = parseCsv(text);
  const h = table.findIndex((r) => (r[0] ?? "").trim() === "ASIN");
  if (h < 0) {
    throw new Error(
      "No 'ASIN' header found. This should be the SIPP Product Portfolio CSV from Seller Central.",
    );
  }
  const header = table[h].map((c) => c.trim());
  const col = (name: string) => {
    const i = header.findIndex((c) => c.toLowerCase() === name.toLowerCase());
    if (i < 0) throw new Error(`The report has no "${name}" column — Amazon may have changed its layout.`);
    return i;
  };
  const idx = {
    asin: col("ASIN"),
    name: col("Item Name"),
    eligibility: col("Eligibility Status"),
    cert: col("Certification Status"),
    certDate: col("Certification Date"),
    decertDate: col("Decertification Date"),
    marketplace: col("Marketplace"),
    currency: col("Currency"),
    benefit: col("Current Benefits"),
    perUnit: col("Per Unit Fee Savings"),
    total: col("Estimated total fee savings"),
    reason: col("InEligibility Reason"),
    primary: col("Primary ASIN"),
  };

  const rows: SippPortfolioRow[] = [];
  let skipped = 0;
  for (const r of table.slice(h + 1)) {
    if (r.every((c) => c.trim() === "")) continue;
    if (r.length !== header.length) {
      skipped++;
      continue;
    }
    const asin = r[idx.asin].trim();
    if (!asin) {
      skipped++;
      continue;
    }
    const total = r[idx.total];
    // Amazon sometimes puts its "no shipment" note in the savings column and
    // "N/A" in the reason column; keep whichever one is actually a reason.
    const reason = orNull(r[idx.reason]) ?? (num(total) == null ? orNull(total) : null);
    rows.push({
      asin,
      itemName: r[idx.name].trim(),
      eligibility: r[idx.eligibility].trim().toLowerCase(),
      certificationStatus: r[idx.cert].trim(),
      certificationDate: orNull(r[idx.certDate]),
      decertificationDate: orNull(r[idx.decertDate]),
      marketplace: r[idx.marketplace].trim().toUpperCase(),
      currency: r[idx.currency].trim(),
      currentBenefit: num(r[idx.benefit]),
      perUnitSavings: num(r[idx.perUnit]),
      savings90d: num(total),
      reason,
      primaryAsin: orNull(r[idx.primary]),
    });
  }
  return { rows, skipped };
}

/** One SKU's SIPP position, from the audited marketplace's row. */
export interface SippSkuStatus {
  sku: string;
  asin: string;
  eligibility: string;
  certificationStatus: string;
  certificationDate: string | null;
  decertificationDate: string | null;
  currentBenefit: number | null;
  perUnitSavings: number | null;
  savings90d: number | null;
  reason: string | null;
}

export interface StoredPortfolio {
  importedAt: string;
  fileName: string;
  /** Lowercased SKU -> its status in the audited marketplace. */
  bySku: Record<string, SippSkuStatus>;
  /** Audited-marketplace ASINs with no SKU in the Library or fee report. */
  unmatchedAsins: string[];
  counts: { certified: number; eligible: number; excluded: number; decertified: number };
  otherMarketplaceRows: number;
}

/**
 * Attach SKUs. One ASIN can sit behind several SKUs (a relaunch, a bundle
 * variant), so each matched SKU gets the ASIN's row; a SKU seen on two ASINs
 * keeps a certified row over any other.
 */
export function mapPortfolioToSkus(
  rows: SippPortfolioRow[],
  skusByAsin: Map<string, Set<string>>,
  marketplace = AUDITED_MARKETPLACE,
): Omit<StoredPortfolio, "importedAt" | "fileName"> {
  const bySku: Record<string, SippSkuStatus> = {};
  const unmatched = new Set<string>();
  let other = 0;
  const rank = (e: string) => (e === "certified" ? 2 : e === "eligible" ? 1 : 0);

  for (const r of rows) {
    if (r.marketplace !== marketplace) {
      other++;
      continue;
    }
    const skus = skusByAsin.get(r.asin.toLowerCase());
    if (!skus || skus.size === 0) {
      unmatched.add(r.asin);
      continue;
    }
    for (const sku of skus) {
      const key = sku.trim().toLowerCase();
      const prev = bySku[key];
      if (prev && rank(prev.eligibility) >= rank(r.eligibility)) continue;
      bySku[key] = {
        sku: sku.trim(),
        asin: r.asin,
        eligibility: r.eligibility,
        certificationStatus: r.certificationStatus,
        certificationDate: r.certificationDate,
        decertificationDate: r.decertificationDate,
        currentBenefit: r.currentBenefit,
        perUnitSavings: r.perUnitSavings,
        savings90d: r.savings90d,
        reason: r.reason,
      };
    }
  }

  const all = Object.values(bySku);
  return {
    bySku,
    unmatchedAsins: [...unmatched].sort(),
    counts: {
      certified: all.filter((s) => s.eligibility === "certified").length,
      eligible: all.filter((s) => s.eligibility === "eligible").length,
      excluded: all.filter((s) => s.eligibility === "excluded").length,
      decertified: all.filter((s) => /decertified/i.test(s.certificationStatus)).length,
    },
    otherMarketplaceRows: other,
  };
}

/** True when Amazon's record says this SKU is SIPP-certified right now. */
export function isCertified(s: SippSkuStatus | undefined): boolean {
  return s?.eligibility === "certified" && !/decertified/i.test(s.certificationStatus);
}

/**
 * The note an eligible-but-not-certified SKU earns: money Amazon itself says
 * you're forgoing. Excluded SKUs get nothing — a size floor can't be fixed by
 * enrolling, and repeating it on every bath toy is noise.
 */
export function sippOpportunityNote(s: SippSkuStatus | undefined): string | null {
  if (!s || s.eligibility !== "eligible") return null;
  // Amazon marks some decertified listings "eligible" while giving a size-floor
  // reason and $0 savings - nothing is on offer there, so saying "re-enrol"
  // would send you after a discount that doesn't exist.
  if (!(s.perUnitSavings != null && s.perUnitSavings > 0)) return null;
  const perUnit = s.perUnitSavings != null && s.perUnitSavings > 0 ? `$${s.perUnitSavings.toFixed(2)}/unit` : null;
  const total =
    s.savings90d != null && s.savings90d > 0
      ? `about $${s.savings90d.toLocaleString("en-US", { maximumFractionDigits: 0 })} over the last 90 days`
      : null;
  const value = [perUnit, total].filter(Boolean).join(", ");
  if (/decertified/i.test(s.certificationStatus)) {
    return (
      `SIPP: decertified${s.decertificationDate ? ` on ${s.decertificationDate}` : ""} but still eligible` +
      (value ? ` — re-enrolling is worth ${value} by Amazon's estimate.` : ".") +
      " The discount only applies to units received after the first-arrival date you give when enrolling."
    );
  }
  return (
    "SIPP: eligible but not enrolled" +
    (value ? ` — Amazon estimates ${value}.` : ".") +
    " Enrolling needs rigid, six-sided packaging with no windows, cut-outs or hang tags."
  );
}

// ── store ──────────────────────────────────────────────────────────────────

export function getSippPortfolio(): StoredPortfolio | null {
  try {
    if (!fs.existsSync(FILE)) return null;
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as StoredPortfolio;
  } catch {
    return null;
  }
}

export function storeSippPortfolio(p: StoredPortfolio) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(p), "utf8");
}

export function clearSippPortfolio() {
  try {
    if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
  } catch {
    /* ignore */
  }
}
