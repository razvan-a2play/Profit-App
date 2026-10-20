// Parses user-uploaded Amazon CSV exports into a normalized per-SKU shape,
// with format auto-detection based on column headers. Storage is in-process
// (Map) — good enough for single-user; can be swapped to Supabase later.

export type UploadedFormat =
  | "return_insights"   // Return Insights & Opportunities page CSV
  | "customer_returns"  // Reports → Fulfillment → Customer Returns CSV
  | "voice_of_customer" // Return reasons per SKU
  | "business_report"   // Detail Page Sales by Child Item (for return-rate denominator)
  | "unknown";

export interface UploadedSkuRow {
  sku?: string | null;
  asin?: string | null;
  productName?: string | null;
  returnUnits?: number;
  returnRatePct?: number;
  topReturnReasons?: string[];
  refundedAmountUsd?: number;
  unitsSold?: number;
}

export interface UploadedReport {
  format: UploadedFormat;
  uploadedAt: string;
  filename: string;
  rowCount: number;
  bySku: Record<string, UploadedSkuRow>;
  byAsin: Record<string, UploadedSkuRow>;
  /** Raw column headers detected — useful for debugging unknown formats. */
  headers: string[];
}

// ── CSV parsing ─────────────────────────────────────────────────────────────

/** Minimal CSV parser — handles quoted fields with commas and escaped quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Handle TSV fallback (Amazon exports are sometimes tab-delimited)
  if (rows.length > 0 && rows[0].length === 1 && rows[0][0].includes("\t")) {
    return text
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => l.split("\t"));
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// ── Format detection ────────────────────────────────────────────────────────

/**
 * Detect which Amazon report format the CSV is. Uses column-header heuristics.
 * Return Insights CSV headers include a Return Rate column; Customer Returns
 * has license-plate-number etc.
 */
export function detectFormat(headers: string[]): UploadedFormat {
  const h = headers.map((x) => x.toLowerCase().trim());
  const has = (needle: string) => h.some((x) => x.includes(needle));

  // Return Insights & Opportunities CSV — usually has "return rate" or "customer initiated return rate"
  if (has("return rate") || has("customer initiated return rate")) return "return_insights";
  if (has("critical review rate") || has("return badge")) return "return_insights";

  // Customer Returns detail — has license-plate-number and detailed-disposition
  if (has("license-plate-number") || has("detailed-disposition") || has("license plate number")) {
    return "customer_returns";
  }

  // Voice of Customer — return reasons
  if (has("reason") && has("return") && !has("license")) return "voice_of_customer";

  // Business Reports — has sessions, page views, units sold
  if (has("units ordered") || has("sessions") || has("page views")) return "business_report";

  return "unknown";
}

// ── Per-format parsers ──────────────────────────────────────────────────────

function pickIdx(headers: string[], ...names: string[]): number {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const name of names) {
    const idx = lower.findIndex((h) => h === name.toLowerCase());
    if (idx >= 0) return idx;
  }
  // Fallback: substring match
  for (const name of names) {
    const idx = lower.findIndex((h) => h.includes(name.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

function num(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const cleaned = s.replace(/[^\d.\-]/g, "");
  const v = parseFloat(cleaned);
  return Number.isFinite(v) ? v : undefined;
}

function parseReturnInsights(rows: string[][]): Omit<UploadedReport, "format" | "uploadedAt" | "filename"> {
  const headers = rows[0];
  const skuI = pickIdx(headers, "sku", "seller sku", "merchant sku", "msku");
  const asinI = pickIdx(headers, "asin");
  const nameI = pickIdx(headers, "product name", "product details", "item name", "product-name");
  const unitsI = pickIdx(headers, "return units", "return-units");
  const rateI = pickIdx(headers, "customer initiated return rate", "return rate");
  const reasonsI = pickIdx(headers, "customer return reasons", "top return reasons", "return reasons");

  const bySku: Record<string, UploadedSkuRow> = {};
  const byAsin: Record<string, UploadedSkuRow> = {};
  for (const cells of rows.slice(1)) {
    const sku = skuI >= 0 ? cells[skuI]?.trim() : "";
    const asin = asinI >= 0 ? cells[asinI]?.trim() : "";
    if (!sku && !asin) continue;
    const row: UploadedSkuRow = {
      sku: sku || null,
      asin: asin || null,
      productName: nameI >= 0 ? cells[nameI]?.trim() : null,
      returnUnits: unitsI >= 0 ? num(cells[unitsI]) : undefined,
      returnRatePct: rateI >= 0 ? num(cells[rateI]) : undefined,
      topReturnReasons:
        reasonsI >= 0
          ? cells[reasonsI]
              ?.split(/[|,;\n]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
    };
    if (sku) bySku[sku.toLowerCase()] = row;
    if (asin) byAsin[asin.toLowerCase()] = row;
  }
  return { rowCount: rows.length - 1, bySku, byAsin, headers };
}

function parseCustomerReturns(rows: string[][]): Omit<UploadedReport, "format" | "uploadedAt" | "filename"> {
  const headers = rows[0];
  const skuI = pickIdx(headers, "sku", "msku", "merchant sku", "seller sku");
  const asinI = pickIdx(headers, "asin");
  const qtyI = pickIdx(headers, "quantity", "return quantity");

  // Aggregate one row per SKU counting units.
  const bySku: Record<string, UploadedSkuRow> = {};
  const byAsin: Record<string, UploadedSkuRow> = {};
  for (const cells of rows.slice(1)) {
    const sku = skuI >= 0 ? cells[skuI]?.trim() : "";
    const asin = asinI >= 0 ? cells[asinI]?.trim() : "";
    if (!sku && !asin) continue;
    const qty = qtyI >= 0 ? num(cells[qtyI]) ?? 1 : 1;
    const key = sku.toLowerCase();
    const entry = bySku[key] ?? { sku: sku || null, asin: asin || null, returnUnits: 0 };
    entry.returnUnits = (entry.returnUnits ?? 0) + qty;
    bySku[key] = entry;
    if (asin) byAsin[asin.toLowerCase()] = entry;
  }
  return { rowCount: rows.length - 1, bySku, byAsin, headers };
}

function parseBusinessReport(rows: string[][]): Omit<UploadedReport, "format" | "uploadedAt" | "filename"> {
  const headers = rows[0];
  const skuI = pickIdx(headers, "sku", "child asin", "asin");
  const asinI = pickIdx(headers, "asin");
  const nameI = pickIdx(headers, "title", "product name");
  const unitsSoldI = pickIdx(headers, "units ordered", "units ordered - b2b");
  const bySku: Record<string, UploadedSkuRow> = {};
  const byAsin: Record<string, UploadedSkuRow> = {};
  for (const cells of rows.slice(1)) {
    const sku = skuI >= 0 ? cells[skuI]?.trim() : "";
    const asin = asinI >= 0 ? cells[asinI]?.trim() : "";
    if (!sku && !asin) continue;
    const row: UploadedSkuRow = {
      sku: sku || null,
      asin: asin || null,
      productName: nameI >= 0 ? cells[nameI]?.trim() : null,
      unitsSold: unitsSoldI >= 0 ? num(cells[unitsSoldI]) : undefined,
    };
    if (sku) bySku[sku.toLowerCase()] = row;
    if (asin) byAsin[asin.toLowerCase()] = row;
  }
  return { rowCount: rows.length - 1, bySku, byAsin, headers };
}

export function parseUploadedCsv(filename: string, text: string): UploadedReport {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error("Empty CSV");
  const headers = rows[0].map((h) => h.trim());
  const format = detectFormat(headers);
  const parsed = (() => {
    if (format === "return_insights" || format === "voice_of_customer") return parseReturnInsights(rows);
    if (format === "customer_returns") return parseCustomerReturns(rows);
    if (format === "business_report") return parseBusinessReport(rows);
    // Unknown format — still return headers for user to inspect.
    return { rowCount: rows.length - 1, bySku: {}, byAsin: {}, headers };
  })();
  return {
    format,
    uploadedAt: new Date().toISOString(),
    filename,
    ...parsed,
  };
}

// ── Storage (in-process) ────────────────────────────────────────────────────

const store = new Map<UploadedFormat, UploadedReport>();

export function storeUpload(report: UploadedReport) {
  store.set(report.format, report);
}

export function getUpload(format: UploadedFormat): UploadedReport | null {
  return store.get(format) ?? null;
}

export function listUploads(): UploadedReport[] {
  return [...store.values()].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export function deleteUpload(format: UploadedFormat) {
  store.delete(format);
}
