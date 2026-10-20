import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  getCachedFeeReport,
  storeFeeReport,
  clearFeeReportCache,
  describeCacheAge,
  cacheAgeHours,
} from "./feeReportCache";

const FILE = path.join(process.cwd(), ".data", "fee-report.json");
const backup = FILE + ".test-backup";

const rows = [
  { sku: "SPBATH0034", expectedFulfillmentFee: 4.09, itemPackageWeight: 0.22 },
  { sku: "BDRL002", expectedFulfillmentFee: 6.9, itemPackageWeight: 2.81 },
];

describe("fee report cache", () => {
  beforeEach(() => {
    // Never destroy the real cache while testing.
    if (fs.existsSync(FILE)) fs.renameSync(FILE, backup);
  });
  afterEach(() => {
    clearFeeReportCache();
    if (fs.existsSync(backup)) fs.renameSync(backup, FILE);
  });

  it("returns null when nothing has been cached yet", () => {
    expect(getCachedFeeReport()).toBeNull();
  });

  it("round-trips the rows and the report id", () => {
    storeFeeReport("2749036020697", rows);
    const c = getCachedFeeReport()!;
    expect(c.reportId).toBe("2749036020697");
    expect(c.rows).toHaveLength(2);
    expect(c.rows[0].sku).toBe("SPBATH0034");
    expect(new Date(c.fetchedAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("refuses to overwrite a good cache with an empty report", () => {
    // An empty report is exactly when the fallback needs to survive.
    storeFeeReport("good", rows);
    storeFeeReport("empty", []);
    const c = getCachedFeeReport()!;
    expect(c.reportId).toBe("good");
    expect(c.rows).toHaveLength(2);
  });

  it("treats a cached-but-empty file as no cache", () => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ reportId: "x", fetchedAt: "", rows: [] }));
    expect(getCachedFeeReport()).toBeNull();
  });

  it("survives a corrupt cache file rather than throwing", () => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, "{not json");
    expect(getCachedFeeReport()).toBeNull();
  });

  it("describes age in units a person would use", () => {
    const at = (iso: string) => ({ reportId: "r", fetchedAt: iso, rows });
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    expect(describeCacheAge(at(hoursAgo(0.2)))).toBe("under an hour old");
    expect(describeCacheAge(at(hoursAgo(1.2)))).toBe("1 hour old");
    expect(describeCacheAge(at(hoursAgo(5)))).toBe("5 hours old");
    expect(describeCacheAge(at(hoursAgo(72)))).toBe("3 days old");
    expect(cacheAgeHours(at(hoursAgo(5)))).toBe(5);
  });
});
