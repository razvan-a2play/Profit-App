// Which SKUs are SIPP-certified (Ships in Product Packaging).
//
// Certification is a fact about the listing that Amazon grants, and it has to
// be STATED here rather than read off the fee. Inferring it from a lower charge
// would be circular: a certified SKU that Amazon stopped discounting would just
// look "not certified", and the missing discount — money owed on every unit —
// could never be caught. So the user ticks it, and the audit then checks that
// Amazon keeps honouring it.
//
// The primary source is Amazon's SIPP Product Portfolio report (sippPortfolio);
// ticks here only add listings enrolled since that report was downloaded.
// Kept inside the auditor rather than as a Product Library column so it doesn't
// require a schema change to the supply-chain app.

import fs from "node:fs";
import path from "node:path";
import { getSippPortfolio, isCertified } from "./sippPortfolio";

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "sipp-certified.json");

interface Stored {
  /** Lowercased SKUs. */
  skus: string[];
  updatedAt: string;
}

/**
 * Every SKU to treat as certified: Amazon's SIPP report first, plus manual
 * ticks. The ticks stay useful for a listing enrolled after the report was
 * downloaded - Amazon says new enrolments can take 48 hours to appear in it.
 */
export function getSippCertified(): Set<string> {
  const out = getManualSippTicks();
  const report = getSippPortfolio();
  if (report) {
    for (const [sku, status] of Object.entries(report.bySku)) {
      if (isCertified(status)) out.add(sku);
    }
  }
  return out;
}

/** SKUs ticked by hand in the auditor (lowercased). */
export function getManualSippTicks(): Set<string> {
  try {
    if (!fs.existsSync(FILE)) return new Set();
    const s = JSON.parse(fs.readFileSync(FILE, "utf8")) as Stored;
    return new Set((s.skus ?? []).map((x) => x.trim().toLowerCase()));
  } catch {
    return new Set();
  }
}

export function setSippCertified(sku: string, certified: boolean): Set<string> {
  const set = getManualSippTicks();
  const key = sku.trim().toLowerCase();
  if (!key) return set;
  if (certified) set.add(key);
  else set.delete(key);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const out: Stored = { skus: [...set].sort(), updatedAt: new Date().toISOString() };
  fs.writeFileSync(FILE, JSON.stringify(out, null, 1), "utf8");
  return set;
}
