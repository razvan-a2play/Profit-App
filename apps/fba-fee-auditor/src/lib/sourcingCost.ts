// Amazon's "Manage Your Sourcing Cost" file, checked against the PNL app.
//
// Sourcing cost is what Amazon reimburses when it loses or damages a unit
// BEFORE a customer orders it. Amazon keeps its own estimate per ASIN and only
// pays out against an *approved* cost, so a stale or missing figure is money
// left on the table. There is no SP-API for any of it (both the download and
// the upload are Seller Central only), which is why this is an upload page.
//
// The file is keyed by ASIN/FNSKU; the PNL app is keyed by SKU. The Product
// Library holds both, so it's the bridge between them.

import { looksLikeXlsx, readXlsx } from "./xlsxRead";

export interface SourcingFileRow {
  asin: string;
  fnsku: string;
  amazonEstimated: number | null;
  latestApproved: number | null;
  approvedSource: string | null;
  currency: string | null;
  updatedAt: string | null;
  sellerNewCost: number | null;
}

export type SourcingStatus =
  | "no_cost_on_file"
  | "amazon_lower"
  | "amazon_higher"
  | "match"
  | "no_pnl_version"
  | "unknown_asin";

export interface SourcingComparisonRow extends SourcingFileRow {
  sku: string | null;
  ourCost: number | null;
  /** ourCost - latestApproved, when both are known. */
  delta: number | null;
  status: SourcingStatus;
  /** What to put in "Seller New Cost", or null to leave the row alone. */
  suggested: number | null;
  versionName: string | null;
}

/** Amazon's own column headings, in the order it ships them. */
export const SOURCING_HEADERS = [
  "Asin",
  "Fnsku",
  "Amazon Estimated Cost",
  "Latest Approved Cost",
  "Source of Latest Approved Cost",
  "Currency",
  "Date of Last Updated Cost",
  "Seller New Cost",
] as const;

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

const HEADER_ALIASES: Record<string, keyof SourcingFileRow> = {
  asin: "asin",
  fnsku: "fnsku",
  amazonestimatedcost: "amazonEstimated",
  latestapprovedcost: "latestApproved",
  sourceoflatestapprovedcost: "approvedSource",
  currency: "currency",
  dateoflastupdatedcost: "updatedAt",
  sellernewcost: "sellerNewCost",
};

function money(v: string | undefined): number | null {
  if (v == null) return null;
  const t = v.replace(/[$,\s]/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Split a text export. Amazon ships tab-delimited; accept comma too. */
function splitRows(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const delimiter = (lines[0]?.split("\t").length ?? 1) > 1 ? "\t" : ",";
  return lines.map((l) =>
    l.split(delimiter).map((c) => c.trim().replace(/^"(.*)"$/, "$1")),
  );
}

export interface ParsedSourcingFile {
  rows: SourcingFileRow[];
  /** Rows present in the file that had no usable ASIN. */
  skipped: number;
}

/**
 * Parse the downloaded sourcing-cost file — .xlsx as downloaded, or the
 * tab-delimited text Amazon also offers.
 */
export function parseSourcingFile(buf: Buffer): ParsedSourcingFile {
  const grid = looksLikeXlsx(buf) ? readXlsx(buf) : splitRows(buf.toString("utf8"));
  if (grid.length === 0) throw new Error("That file is empty.");

  const header = grid[0].map(norm);
  const col: Partial<Record<keyof SourcingFileRow, number>> = {};
  header.forEach((h, i) => {
    const field = HEADER_ALIASES[h];
    if (field && col[field] === undefined) col[field] = i;
  });
  if (col.asin === undefined) {
    throw new Error(
      "No 'Asin' column found. Upload the file from Inventory Defect and Reimbursement " +
        "→ Manage Your Sourcing Cost → Download sourcing cost.",
    );
  }

  const at = (r: string[], f: keyof SourcingFileRow) => {
    const i = col[f];
    return i === undefined ? undefined : r[i];
  };

  const rows: SourcingFileRow[] = [];
  let skipped = 0;
  for (const r of grid.slice(1)) {
    const asin = (at(r, "asin") ?? "").trim();
    if (!asin) {
      skipped++;
      continue;
    }
    rows.push({
      asin,
      fnsku: (at(r, "fnsku") ?? "").trim(),
      amazonEstimated: money(at(r, "amazonEstimated")),
      latestApproved: money(at(r, "latestApproved")),
      approvedSource: (at(r, "approvedSource") ?? "").trim() || null,
      currency: (at(r, "currency") ?? "").trim() || null,
      updatedAt: (at(r, "updatedAt") ?? "").trim() || null,
      sellerNewCost: money(at(r, "sellerNewCost")),
    });
  }
  return { rows, skipped };
}

export interface CompareOptions {
  /** asin or fnsku (lowercased) -> our SKU. */
  skuByCode: Record<string, string>;
  /** sku (lowercased) -> what the PNL app says one unit costs to make. */
  costBySku: Record<string, { cost: number; versionName: string | null }>;
  /** Ignore differences at or below this, in dollars. */
  toleranceUsd?: number;
}

/**
 * Line up each ASIN with our own cost and say what to do about it.
 *
 * A claim is only worth filing where OUR cost is higher than what Amazon has
 * approved — that is the reimbursement we are currently short. Where Amazon's
 * approved figure is already above ours, submitting would cut our own payout,
 * so nothing is suggested for those rows.
 */
export function compareSourcingCosts(
  fileRows: SourcingFileRow[],
  o: CompareOptions,
): SourcingComparisonRow[] {
  const tolerance = o.toleranceUsd ?? 0.01;

  return fileRows.map((row) => {
    const sku =
      o.skuByCode[row.asin.toLowerCase()] ??
      (row.fnsku ? o.skuByCode[row.fnsku.toLowerCase()] : undefined) ??
      null;
    const ours = sku ? o.costBySku[sku.toLowerCase()] : undefined;
    const ourCost = ours?.cost ?? null;

    const base: Omit<SourcingComparisonRow, "status" | "suggested"> = {
      ...row,
      sku,
      ourCost,
      delta:
        ourCost != null && row.latestApproved != null ? ourCost - row.latestApproved : null,
      versionName: ours?.versionName ?? null,
    };

    if (!sku) return { ...base, status: "unknown_asin", suggested: null };
    if (ourCost == null) return { ...base, status: "no_pnl_version", suggested: null };
    if (row.latestApproved == null)
      return { ...base, status: "no_cost_on_file", suggested: round2(ourCost) };
    if (Math.abs(ourCost - row.latestApproved) <= tolerance)
      return { ...base, status: "match", suggested: null };
    if (ourCost > row.latestApproved)
      return { ...base, status: "amazon_lower", suggested: round2(ourCost) };
    return { ...base, status: "amazon_higher", suggested: null };
  });
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface SourcingSummary {
  total: number;
  matched: number;
  claimable: number;
  /** Total per-unit shortfall across the claimable rows. */
  claimableDelta: number;
  amazonHigher: number;
  noCostOnFile: number;
  noPnlVersion: number;
  unknownAsin: number;
}

export function summarise(rows: SourcingComparisonRow[]): SourcingSummary {
  const by = (s: SourcingStatus) => rows.filter((r) => r.status === s);
  const claimable = by("amazon_lower");
  return {
    total: rows.length,
    matched: by("match").length,
    claimable: claimable.length,
    claimableDelta: round2(claimable.reduce((t, r) => t + (r.delta ?? 0), 0)),
    amazonHigher: by("amazon_higher").length,
    noCostOnFile: by("no_cost_on_file").length,
    noPnlVersion: by("no_pnl_version").length,
    unknownAsin: by("unknown_asin").length,
  };
}

/**
 * Rebuild the file for upload: Amazon's own columns, with "Seller New Cost"
 * filled only on the rows passed in. Tab-delimited, two decimal places —
 * both are what the upload page asks for.
 */
export function buildUploadFile(
  rows: SourcingComparisonRow[],
  newCostByAsin: Record<string, number>,
): string {
  const lines = [SOURCING_HEADERS.join("\t")];
  for (const r of rows) {
    const proposed = newCostByAsin[r.asin];
    lines.push(
      [
        r.asin,
        r.fnsku,
        r.amazonEstimated ?? "",
        r.latestApproved ?? "",
        r.approvedSource ?? "",
        r.currency ?? "",
        r.updatedAt ?? "",
        proposed == null ? "" : round2(proposed).toFixed(2),
      ].join("\t"),
    );
  }
  return lines.join("\r\n");
}
