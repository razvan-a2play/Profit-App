// Parses text pasted from Amazon's "Returns and Recovery: Insights and
// Opportunities" dashboard table. That page has no CSV export, but the HTML
// table copies cleanly — this parser pulls ASIN + return units out of whatever
// shape the clipboard delivers (tab-separated columns, or the multi-line
// per-row blob you get when copying the rendered table).
//
// Why we need it: Amazon's FBA Customer Returns report only contains PHYSICAL
// returns (units that arrived at a fulfillment center). Returnless refunds
// never reach an FC, so they're invisible to every SP-API report. The dashboard
// total is the only source that includes them, hence:
//
//   returnless_refunds = dashboard_total − fba_returns_report_physical

export interface PastedDashboardRow {
  asin: string;
  returnUnits: number;
  /** Customer-initiated return rate, if present in the paste (percent). */
  returnRatePct?: number;
  productName?: string;
}

export interface PastedDashboard {
  pastedAt: string;
  rows: PastedDashboardRow[];
  /** ASIN (lowercase) → return units. */
  byAsin: Record<string, number>;
  totalUnits: number;
  /** Lines we couldn't interpret — surfaced so the user can spot problems. */
  unparsedSample: string[];
}

const ASIN_RE = /\b(B0[A-Z0-9]{8})\b/;
// A bare integer with optional thousands separators, e.g. 3671 or 3,671
const INT_RE = /^\d{1,3}(?:,\d{3})*$|^\d+$/;
const PCT_RE = /^(\d+(?:\.\d+)?)\s*%$/;

function toInt(s: string): number | null {
  const cleaned = s.replace(/,/g, "").trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse pasted dashboard text.
 *
 * Handles two clipboard shapes:
 *  1. Tab/multi-space separated rows — one row per line containing the ASIN
 *     and its numbers on the same line.
 *  2. "Blob" paste — the rendered table copies as many lines per row, with the
 *     ASIN on one line and the return-units number a line or two later. We
 *     anchor on the ASIN and take the first standalone integer that follows.
 */
export function parsePastedDashboard(text: string): PastedDashboard {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const rows: PastedDashboardRow[] = [];
  const unparsed: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const asinMatch = line.match(ASIN_RE);
    if (!asinMatch) continue;
    const asin = asinMatch[1];
    if (seen.has(asin)) continue;

    // --- Shape 1: numbers on the same line as the ASIN.
    // Split on tabs first (Excel-ish paste), fall back to 2+ spaces.
    const cells = line.includes("\t") ? line.split("\t") : line.split(/\s{2,}/);
    let units: number | null = null;
    let ratePct: number | undefined;

    for (const raw of cells) {
      const cell = raw.trim();
      if (!cell || cell.includes(asin)) continue;
      const pct = cell.match(PCT_RE);
      if (pct && ratePct === undefined) {
        ratePct = parseFloat(pct[1]);
        continue;
      }
      if (units === null && INT_RE.test(cell)) {
        const n = toInt(cell);
        // Ignore obvious non-counts (years, prices already have $ or .)
        if (n !== null && n > 0 && n < 1_000_000) units = n;
      }
    }

    // --- Shape 2: scan the next few lines for the first standalone integer.
    if (units === null) {
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const cand = lines[j].trim();
        // Stop if we hit the next product row.
        if (ASIN_RE.test(cand)) break;
        if (INT_RE.test(cand)) {
          const n = toInt(cand);
          if (n !== null && n > 0 && n < 1_000_000) {
            units = n;
            // Peek one line further for the rate.
            const next = lines[j + 1]?.trim() ?? "";
            const pct = next.match(PCT_RE);
            if (pct) ratePct = parseFloat(pct[1]);
            break;
          }
        }
      }
    }

    if (units === null) {
      unparsed.push(line.slice(0, 120));
      continue;
    }

    seen.add(asin);
    rows.push({ asin, returnUnits: units, returnRatePct: ratePct });
  }

  const byAsin: Record<string, number> = {};
  for (const r of rows) byAsin[r.asin.toLowerCase()] = r.returnUnits;

  return {
    pastedAt: new Date().toISOString(),
    rows,
    byAsin,
    totalUnits: rows.reduce((s, r) => s + r.returnUnits, 0),
    unparsedSample: unparsed.slice(0, 10),
  };
}

// ── Storage ─────────────────────────────────────────────────────────────────
// File-backed, NOT in-memory. Two reasons:
//   1. Next.js dev mode bundles each route handler separately, so module-level
//      state is not shared between /api/uploads/dashboard-paste and
//      /api/returns-strategy — an in-memory Map silently reads back empty.
//   2. The paste is manual work; it should survive app restarts so the user
//      only redoes it when Amazon's numbers actually change (monthly).

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "dashboard-paste.json");

export function storePastedDashboard(d: PastedDashboard) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(d), "utf8");
}

/**
 * Merge a new paste into whatever is already stored — for multi-page tables
 * where each page has to be copied separately. Same ASIN pasted twice keeps
 * the NEWER value (assumes a re-paste is a correction, not a duplicate page).
 */
export function appendPastedDashboard(next: PastedDashboard): PastedDashboard {
  const prev = getPastedDashboard();
  if (!prev) {
    storePastedDashboard(next);
    return next;
  }
  const byAsinRow = new Map<string, PastedDashboardRow>();
  for (const r of prev.rows) byAsinRow.set(r.asin, r);
  for (const r of next.rows) byAsinRow.set(r.asin, r); // newer wins

  const rows = [...byAsinRow.values()].sort((a, b) => b.returnUnits - a.returnUnits);
  const byAsin: Record<string, number> = {};
  for (const r of rows) byAsin[r.asin.toLowerCase()] = r.returnUnits;

  const merged: PastedDashboard = {
    pastedAt: next.pastedAt,
    rows,
    byAsin,
    totalUnits: rows.reduce((s, r) => s + r.returnUnits, 0),
    unparsedSample: next.unparsedSample,
  };
  storePastedDashboard(merged);
  return merged;
}

export function getPastedDashboard(): PastedDashboard | null {
  try {
    if (!fs.existsSync(FILE)) return null;
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as PastedDashboard;
  } catch {
    return null;
  }
}

export function clearPastedDashboard() {
  try {
    if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
  } catch {
    /* ignore */
  }
}
