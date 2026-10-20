import { NextResponse } from "next/server";
import {
  addInventory,
  buildMonthlyReport,
  monthRange,
  nextMonth,
  type AgedSurchargeSku,
  type AwdMovements,
  type AwdNow,
  type Gateway,
  type LedgerByAsin,
  type MonthCostsInput,
} from "@platform/supply-chain-data";
import {
  defaultMonth,
  feesRead,
  isSettled,
  loadMonthCosts,
  readMonthCache,
  type CachedMonth,
} from "@platform/supply-chain-data/monthCosts";
import { DATA_DIR, earliestReadableMonth, getCatalogue, getGateway, getHeliumMonths, getUnitCosts } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** "unavailable": older than Amazon will return, and no other source has it. */
export type MonthState = "ready" | "scanning" | "queued" | "failed" | "unavailable";

export interface MonthStatus {
  month: string;
  fees: MonthState;
  error?: string;
  /** The storage-fee report: per-SKU FBA storage and the utilisation ratio. */
  storageReport: "ready" | "pending" | "unpublished";
  /** Where the month's fees came from. */
  source?: "amazon" | "helium";
}

/**
 * The history, oldest month first.
 *
 * Each month's fees come from a walk of Amazon's whole financial-event stream,
 * about six minutes at the rate Amazon allows. Asking for twelve at once would
 * start twelve walks against the same rate limit, so at most one month is
 * scanned at a time — newest first, since that is the one people look at — and
 * the rest wait their turn. The page polls, and each poll moves the queue on.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const last = url.searchParams.get("last") ?? defaultMonth();
  const helium = getHeliumMonths();
  const readable = earliestReadableMonth();
  // "all" runs from the oldest month any source has: Helium's export before
  // Amazon's window, Amazon from there on.
  const oldest = [readable, ...Object.keys(helium)].sort()[0];
  const countParam = url.searchParams.get("count") ?? "12";
  const count =
    countParam === "all"
      ? monthsBetween(oldest, last)
      : Math.min(Math.max(Number(countParam) || 12, 1), 120);
  if (!/^\d{4}-\d{2}$/.test(last)) {
    return NextResponse.json({ error: "last must look like 2026-09" }, { status: 400 });
  }

  let gw;
  try {
    gw = getGateway();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  const months = monthRange(last, count);
  // The month after the last one carries its storage invoice — but only once it
  // has closed. The current month is still accruing.
  const after = nextMonth(last);
  const wanted = after <= defaultMonth() ? [after, ...[...months].reverse()] : [...months].reverse();

  const costsByMonth: Record<string, MonthCostsInput | null> = {};
  const statusByMonth: Record<string, MonthStatus> = {};
  let scanning = false;

  for (const month of wanted) {
    // Older than Amazon will answer for: take it from Helium, or say it is
    // unavailable, but never ask Amazon — it refuses, and the refusal would
    // hold up the months behind it.
    if (month < readable && !feesRead(readMonthCache(DATA_DIR, month), true)) {
      const h = helium[month];
      costsByMonth[month] = h ?? null;
      statusByMonth[month] = {
        month,
        fees: h ? "ready" : "unavailable",
        storageReport: "unpublished",
        source: h ? "helium" : undefined,
      };
      continue;
    }
    let c: CachedMonth | null = readMonthCache(DATA_DIR, month);
    let error: string | undefined;

    const feesDone = feesRead(c, true);
    // Settled months are final. A month whose fees are in but whose storage
    // report is still pending is cheap to re-check. A month that needs its fees
    // scanned waits unless nothing else is scanning.
    if (!isSettled(c, true) && (feesDone || !scanning)) {
      const res = await loadMonthCosts(gw, month, { dataDir: DATA_DIR, planning: false, requireSkuSales: true });
      if ("error" in res.body) error = res.body.error;
      else {
        c = res.body;
        if (res.body.warning) error = res.body.warning;
      }
      if (!feesRead(c, true)) scanning = true;
    }

    const billedStatus = c?.billed?.status;
    statusByMonth[month] = {
      month,
      fees: feesRead(c, true)
        ? "ready"
        : billedStatus === "failed"
          ? "failed"
          : billedStatus === "scanning"
            ? "scanning"
            : "queued",
      error: error ?? c?.billed?.error,
      source: "amazon",
      storageReport: c?.storage?.ready ? "ready" : c?.monthUnavailable ? "unpublished" : "pending",
    };
    costsByMonth[month] = c;
  }

  const catalogue = await getCatalogue(gw);
  const monthly = buildMonthlyReport({
    months,
    costsByMonth,
    asinBySku: catalogue.asinBySku,
    productNameBySku: catalogue.nameBySku,
  });

  const [ledger, awdMovements, awdNow, aged, snapshots, inStock] = await Promise.all([
    soft(gw, "/supply-chain/ledger-monthly"),
    soft(gw, "/supply-chain/awd-movements"),
    soft(gw, "/awd/inventory"),
    soft(gw, `/supply-chain/aged-surcharge?months=${months.join(",")}`),
    soft(gw, `/supply-chain/snapshots?since=${months[0]}-01`),
    soft(gw, "/supply-chain/in-stock"),
  ]);
  const agedBySku: Record<string, Record<string, AgedSurchargeSku>> = {};
  for (const [m, v] of Object.entries((aged?.months ?? {}) as Record<string, { skus?: Record<string, AgedSurchargeSku>; unavailable?: boolean }>)) {
    if (!v.unavailable) agedBySku[m] = v.skus ?? {};
  }
  const awdRows = (awdNow?.rows ?? null) as Array<AwdNow & { sku: string }> | null;
  const report = addInventory(monthly, {
    ledger: ledger?.asins ? (ledger as LedgerByAsin) : null,
    asinBySku: catalogue.asinBySku,
    productNameBySku: catalogue.nameBySku,
    awdNow: awdRows ? Object.fromEntries(awdRows.map((r) => [r.sku, r])) : null,
    awdMovements: awdMovements?.shipments ? (awdMovements as AwdMovements) : null,
    agedBySku,
    unitCost: getUnitCosts(),
    inStock: inStock?.asins ?? null,
    costsByMonth,
  });
  const snaps = (snapshots?.snapshots ?? []) as Array<{ date: string; age: Record<string, Record<string, number>> }>;
  const latestSnap = snaps[snaps.length - 1] ?? null;

  // Product names travel once, not on every SKU-month row.
  const productNames: Record<string, string> = {};
  const skus = report.skus.map(({ productName, ...row }) => {
    if (productName) productNames[row.sku] = productName;
    return row;
  });

  return NextResponse.json({
    ...report,
    skus,
    productNames,
    inventory: {
      ledger: sourceState(ledger),
      awd: awdRows && awdMovements?.shipments ? sourceState(awdMovements) : awdNow == null ? "unavailable" : sourceState(awdMovements),
      inStock: sourceState(inStock),
      aged: aged == null ? "unavailable" : aged.ready ? "ready" : aged.status === "failed" ? "failed" : "scanning",
      agedPending: (aged?.pending ?? []) as string[],
      snapshotDays: snaps.length,
      ageNow: latestSnap ? { date: latestSnap.date, bySku: latestSnap.age } : null,
    },
    status: months.map((m) => statusByMonth[m]),
    // A failed scan holds the queue (the next month would hit the same wall, and
    // usually for the same reason), so polling stops until someone retries.
    busy: [ledger, awdMovements, inStock].some((r) => r && (r.status === "scanning")) ||
      Boolean(aged && !aged.ready && aged.status !== "failed") ||
      Object.values(statusByMonth).some((s) => s.fees === "scanning") ||
      (Object.values(statusByMonth).some((s) => s.fees === "queued") &&
        !Object.values(statusByMonth).some((s) => s.fees === "failed")),
    blocked: Object.values(statusByMonth).find((s) => s.fees === "failed") ?? null,
  });
}

/** A gateway call whose failure costs one section, not the page. */
async function soft(gw: Gateway, path: string): Promise<any | null> {
  try {
    return await gw(path);
  } catch {
    return null;
  }
}

function sourceState(r: any | null): "ready" | "scanning" | "failed" | "unavailable" {
  if (r == null) return "unavailable";
  if (r.status === "failed") return "failed";
  if (r.ready && !r.stale) return "ready";
  return r.ready ? "ready" : "scanning";
}

/** Months from `first` to `last` inclusive. */
function monthsBetween(first: string, last: string): number {
  const [y1, m1] = first.split("-").map(Number);
  const [y2, m2] = last.split("-").map(Number);
  return Math.max(1, (y2 - y1) * 12 + (m2 - m1) + 1);
}
