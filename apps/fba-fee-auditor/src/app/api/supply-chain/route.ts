import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getCachedFeeReport } from "@/lib/feeReportCache";
import { assessSupplyChain, fetchAwdStock } from "@platform/supply-chain-data";
import { getGateway } from "@/lib/gateway";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The supply-chain view is built on top of the storage-costs month, so it
 * reuses that endpoint rather than pulling Amazon a second time. If the month
 * is still being scanned it says so instead of reporting half the costs as
 * though they were all of them.
 */
const DATA_DIR = path.join(process.cwd(), ".data");
/** An unsettled month is re-derived after this long; a settled one never is. */
const STALE_AFTER_MS = 45_000;

function cacheFile(month: string) {
  return path.join(DATA_DIR, `supply-chain-${month}.json`);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const month = url.searchParams.get("month");
  const qs = month ? `?month=${encodeURIComponent(month)}` : "";
  const refresh = url.searchParams.get("refresh") === "1";

  // The assessment is derived from the month's costs, so it is cached on the
  // same terms: once the month is settled it can never change, and until then a
  // short-lived copy still saves re-deriving it on every tab switch.
  if (month && !refresh) {
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile(month), "utf8"));
      const age = Date.now() - new Date(c.builtAt ?? 0).getTime();
      if (c.settled || age < STALE_AFTER_MS) {
        return NextResponse.json({ ...c, cached: true });
      }
    } catch {
      /* no usable cache */
    }
  }

  try {
    const costs = await fetch(`${url.origin}/api/storage-costs${qs}`, { cache: "no-store" }).then((r) =>
      r.json(),
    );
    if (costs.error) return NextResponse.json({ error: costs.error }, { status: 502 });

    const awdStock = await fetchAwdStock(getGateway());

    // Selling price and the SKU↔ASIN mapping both come from the fee report the
    // audit already caches — no extra Amazon call.
    const feeRows = getCachedFeeReport()?.rows ?? [];
    const priceBySku: Record<string, number> = {};
    const asinBySku: Record<string, string> = {};
    for (const r of feeRows) {
      const sku = r.sku?.trim().toUpperCase();
      if (!sku) continue;
      if (r.yourPrice != null) priceBySku[sku] = r.yourPrice;
      if (r.asin) asinBySku[sku] = r.asin;
    }

    const report = assessSupplyChain({
      month: costs.month,
      storageRows: costs.storage?.rows ?? [],
      planning: costs.planning ?? [],
      awdStock,
      billed: costs.billed ?? null,
      priceBySku,
      asinBySku,
      utilizationWeeks: costs.storage?.totals?.utilization_ratio_weeks ?? null,
    });

    // Final only once the month's charges are signed (refunds netted), or an
    // older copy would be cached here for good.
    const settled = Boolean(
      costs.billed?.ready && costs.billed?.signed === true && (costs.storage?.ready || costs.monthUnavailable),
    );
    const payload = {
      ...report,
      settled,
      builtAt: new Date().toISOString(),
      // Said plainly, because a month still being scanned has only part of its
      // AWD costs, and every allocation below is built on them.
      billedReady: Boolean(costs.billed?.ready),
      billedStatus: costs.billed?.status ?? null,
      storageReady: Boolean(costs.storage?.ready),
      monthUnavailable: Boolean(costs.monthUnavailable),
      awdSkus: awdStock.length,
      pricedSkus: Object.keys(priceBySku).length,
    };

    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(cacheFile(report.month), JSON.stringify(payload), "utf8");
    } catch {
      /* caching is an optimisation, never a reason to fail the request */
    }
    return NextResponse.json({ ...payload, cached: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not build the supply-chain report." },
      { status: 502 },
    );
  }
}
