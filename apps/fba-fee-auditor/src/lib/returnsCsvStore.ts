// Per-SKU physical-return stats parsed from the FBA Customer Returns CSV
// (Reports -> Fulfillment -> Customer Returns). File-backed.
//
// Why upload instead of using SP-API: the API report is heavily throttled and
// often returns a 1-day window, while the download is instant, complete, and
// carries the exact per-unit `detailed-disposition` we need for sellable-back
// rates. It also lets us drop non-US fulfilment centres (Canada = `Y*`), which
// matters because the Return Insights dashboard is filtered to United States.

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "returns-csv.json");

export interface ReturnsSkuStats {
  sku: string;
  asin: string | null;
  physical: number;
  sellable: number;
  customerDamaged: number;
  defective: number;
  /** Amazon-caused damage — reimbursable. */
  reimbursable: number;
  sellableRate: number;
  damagedRate: number;
  topReason: string | null;
  /**
   * What Amazon did with the unsellable units, from the report's `status`
   * column. This is the only place the donation share is visible — it appears
   * in no other report, and Amazon bills the removal fee on donations too.
   */
  unsellableMeasured: number;
  donated: number;
  disposed: number;
  statusReimbursed: number;
  backToStock: number;
}

export interface ReturnsCsvStore {
  uploadedAt: string;
  filename: string;
  windowStart: string | null;
  windowEnd: string | null;
  totalRows: number;
  usRows: number;
  canadaRows: number;
  bySku: Record<string, ReturnsSkuStats>;
  byAsin: Record<string, string>;
}

export function getReturnsCsv(): ReturnsCsvStore | null {
  try {
    if (!fs.existsSync(FILE)) return null;
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as ReturnsCsvStore;
  } catch {
    return null;
  }
}

export function clearReturnsCsv() {
  try {
    if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
  } catch {
    /* ignore */
  }
}

function splitLine(line: string, delim: string): string[] {
  if (delim === "\t") return line.split("\t");
  // CSV with quoted fields
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** True for non-US fulfilment centres (Canada codes start with Y). */
function isNonUsFc(fc: string): boolean {
  return fc.trim().toUpperCase().startsWith("Y");
}

export function parseReturnsCsv(filename: string, text: string): ReturnsCsvStore {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error("CSV looks empty");

  const delim = lines[0].includes("\t") && !lines[0].includes(",") ? "\t" : ",";
  const headers = splitLine(lines[0], delim).map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());

  const idx = (...names: string[]) => {
    for (const n of names) {
      const i = headers.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iSku = idx("sku", "seller-sku", "msku");
  const iAsin = idx("asin");
  const iQty = idx("quantity");
  const iFc = idx("fulfillment-center-id", "fulfillment center id");
  const iDisp = idx("detailed-disposition", "disposition");
  const iReason = idx("reason");
  const iStatus = idx("status");
  const iDate = idx("return-date", "return date");

  if (iSku < 0 || iDisp < 0) {
    throw new Error(
      `Not an FBA Customer Returns CSV — expected 'sku' and 'detailed-disposition' columns. Saw: ${headers.slice(0, 8).join(", ")}`,
    );
  }

  const bySku: Record<string, ReturnsSkuStats> = {};
  const byAsin: Record<string, string> = {};
  const reasons: Record<string, Record<string, number>> = {};
  let usRows = 0;
  let canadaRows = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const line of lines.slice(1)) {
    const c = splitLine(line, delim).map((x) => x.trim().replace(/^"|"$/g, ""));
    const sku = (c[iSku] ?? "").trim();
    if (!sku) continue;

    const fc = iFc >= 0 ? c[iFc] ?? "" : "";
    if (isNonUsFc(fc)) {
      canadaRows++;
      continue; // US only — matches the dashboard's marketplace filter
    }
    usRows++;

    const qty = iQty >= 0 ? Math.max(1, parseInt(c[iQty] || "1", 10) || 1) : 1;
    const disp = (c[iDisp] ?? "").trim().toUpperCase();
    const asin = iAsin >= 0 ? (c[iAsin] ?? "").trim() : "";
    const date = iDate >= 0 ? (c[iDate] ?? "").slice(0, 10) : "";

    if (date) {
      if (!minDate || date < minDate) minDate = date;
      if (!maxDate || date > maxDate) maxDate = date;
    }

    const key = sku.toLowerCase();
    const e =
      bySku[key] ??
      (bySku[key] = {
        sku,
        asin: asin || null,
        physical: 0,
        sellable: 0,
        customerDamaged: 0,
        defective: 0,
        reimbursable: 0,
        sellableRate: 0,
        damagedRate: 0,
        topReason: null,
        unsellableMeasured: 0,
        donated: 0,
        disposed: 0,
        statusReimbursed: 0,
        backToStock: 0,
      });
    if (asin && !e.asin) e.asin = asin;
    if (asin) byAsin[asin.toLowerCase()] = key;

    e.physical += qty;
    if (disp === "SELLABLE") e.sellable += qty;
    else if (disp === "CUSTOMER_DAMAGED") e.customerDamaged += qty;
    else if (disp === "DEFECTIVE") e.defective += qty;
    else if (disp === "CARRIER_DAMAGED" || disp === "DAMAGED" || disp === "DISTRIBUTOR_DAMAGED")
      e.reimbursable += qty;

    // The status column only means anything for a unit graded unsellable: a
    // sellable return has nowhere to go but back on the shelf.
    if (iStatus >= 0 && disp !== "SELLABLE") {
      const st = (c[iStatus] ?? "").trim().toUpperCase();
      e.unsellableMeasured += qty;
      if (st === "IMMEDIATE_DONATION") e.donated += qty;
      else if (st === "IMMEDIATE_DISPOSAL") e.disposed += qty;
      else if (st === "REIMBURSED") e.statusReimbursed += qty;
      else if (st === "UNIT RETURNED TO INVENTORY") e.backToStock += qty;
    }

    if (iReason >= 0) {
      const r = (c[iReason] ?? "").trim() || "UNKNOWN";
      (reasons[key] ??= {})[r] = (reasons[key][r] ?? 0) + qty;
    }
  }

  for (const [key, e] of Object.entries(bySku)) {
    e.sellableRate = e.physical > 0 ? e.sellable / e.physical : 0;
    e.damagedRate = e.physical > 0 ? e.customerDamaged / e.physical : 0;
    const rs = reasons[key];
    if (rs) e.topReason = Object.entries(rs).sort((a, b) => b[1] - a[1])[0][0];
  }

  const store: ReturnsCsvStore = {
    uploadedAt: new Date().toISOString(),
    filename,
    windowStart: minDate,
    windowEnd: maxDate,
    totalRows: usRows + canadaRows,
    usRows,
    canadaRows,
    bySku,
    byAsin,
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(store), "utf8");
  return store;
}
