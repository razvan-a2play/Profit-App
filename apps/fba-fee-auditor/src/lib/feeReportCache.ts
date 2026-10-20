// Last good FBA fee report, cached to disk.
//
// Amazon rate-limits GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA to roughly one
// generation every few hours, and a request made inside that window comes back
// FATAL. Without a cache that turns into a hard failure: the audit can't run at
// all until Amazon relents, even though the previous rows are minutes old and
// perfectly usable — fee rows change far more slowly than the rate limit.
//
// So every successful fetch is stored, and a FATAL / CANCELLED / unavailable
// report falls back to it rather than erroring out. The response says which was
// used and how old it is, so nobody mistakes cached numbers for live ones.

import fs from "node:fs";
import path from "node:path";
import type { AmazonMeasuredRow } from "@platform/calc";

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "fee-report.json");

export interface CachedFeeReport {
  reportId: string;
  fetchedAt: string;
  rows: AmazonMeasuredRow[];
}

export function getCachedFeeReport(): CachedFeeReport | null {
  try {
    if (!fs.existsSync(FILE)) return null;
    const c = JSON.parse(fs.readFileSync(FILE, "utf8")) as CachedFeeReport;
    return Array.isArray(c.rows) && c.rows.length > 0 ? c : null;
  } catch {
    return null;
  }
}

export function storeFeeReport(reportId: string, rows: AmazonMeasuredRow[]) {
  // Never overwrite a good cache with an empty result — an empty report is
  // exactly the case where the fallback needs to still be there.
  if (!rows || rows.length === 0) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload: CachedFeeReport = {
      reportId,
      fetchedAt: new Date().toISOString(),
      rows,
    };
    fs.writeFileSync(FILE, JSON.stringify(payload), "utf8");
  } catch {
    /* a cache write failure must never break the audit */
  }
}

export function clearFeeReportCache() {
  try {
    if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
  } catch {
    /* ignore */
  }
}

/** Whole hours since the cache was written, for "as of" messaging. */
export function cacheAgeHours(c: CachedFeeReport): number {
  const ms = Date.now() - new Date(c.fetchedAt).getTime();
  return Math.max(0, Math.floor(ms / 3_600_000));
}

export function describeCacheAge(c: CachedFeeReport): string {
  const h = cacheAgeHours(c);
  if (h < 1) return "under an hour old";
  if (h === 1) return "1 hour old";
  if (h < 48) return `${h} hours old`;
  return `${Math.floor(h / 24)} days old`;
}
