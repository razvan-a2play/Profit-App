// Which Amazon report holds which month's storage fees.
//
// Amazon's getReports is one of the most rate-limited calls in SP-API — about
// one request per 45 seconds — and it answers a question that never changes
// once asked: the report id for a closed month. Listing on every page load
// burned the quota, which the gateway reports as "no reports exist", which in
// turn made the app request a brand-new report each time. Ten cancelled
// reports later, nothing worked.
//
// So the id is written down the first time it's known and read from here after.

import fs from "node:fs";
import path from "node:path";

export interface MonthReport {
  reportId: string | null;
  /** DONE, IN_QUEUE, CANCELLED… as Amazon last reported it. */
  status?: string;
  /** When the report list was last consulted for this month, so it isn't re-listed in a loop. */
  listedAt?: string;
  updatedAt: string;
}

type Index = Record<string, MonthReport>;

/** getReports allows roughly one call per 45 seconds. */
const LIST_GAP_MS = 50_000;

export interface ReportIndex {
  get(month: string): MonthReport | null;
  set(month: string, patch: Partial<MonthReport>): void;
  /** Listing is allowed again an hour after the last attempt for that month. */
  mayList(month: string): boolean;
}

export function createReportIndex(dataDir: string): ReportIndex {
  const file = path.join(dataDir, "storage-reports.json");

  function read(): Index {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as Index;
    } catch {
      return {};
    }
  }

  const get = (month: string) => read()[month] ?? null;

  return {
    get,
    set(month, patch) {
      const idx = read();
      idx[month] = { ...(idx[month] ?? { reportId: null }), ...patch, updatedAt: new Date().toISOString() };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(idx, null, 1), "utf8");
    },
    mayList(month) {
      // Space every listing out, whichever month it is for: two months asked
      // for in one page load listed back to back, the second was throttled,
      // and came back as "no report" — then locked out for the hour.
      const lastAny = Math.max(0, ...Object.values(read()).map((r) => (r.listedAt ? new Date(r.listedAt).getTime() : 0)));
      if (Date.now() - lastAny < LIST_GAP_MS) return false;
      const m = get(month);
      if (!m?.listedAt) return true;
      return Date.now() - new Date(m.listedAt).getTime() > 60 * 60 * 1000;
    },
  };
}
