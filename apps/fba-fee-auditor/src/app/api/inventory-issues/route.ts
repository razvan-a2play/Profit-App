import { NextResponse } from "next/server";
import {
  fetchStranded,
  fetchUnfulfillable,
  fetchAdjustmentBuckets,
  fetchAged,
  type UnfulfillableRow,
  type AdjustmentBuckets,
} from "@/lib/amazonInventory";
import { fetchProductIndex } from "@/lib/productLibrary";
import { getProductLibraryConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * GET /api/inventory-issues
 * Returns { stranded, unfulfillable } from Amazon (reusing the latest DONE
 * reports), plus the Library appUrl + SKU→id index so the UI can deep-link
 * each row to the supply-chain-app product page.
 */
export async function GET() {
  try {
    const [stranded, unfulfillable, buckets, aged, libraryIndex] = await Promise.all([
      fetchStranded().catch((e) => ({
        ready: false as const,
        status: e instanceof Error ? e.message : "stranded fetch failed",
        reportId: null,
        dataAsOf: null,
        stale: false,
        rows: [],
      })),
      fetchUnfulfillable().catch((e) => ({
        ready: false as const,
        status: e instanceof Error ? e.message : "unfulfillable fetch failed",
        reportId: null,
        dataAsOf: null,
        stale: false,
        rows: [],
      })),
      fetchAdjustmentBuckets().catch(() => ({} as Record<string, AdjustmentBuckets>)),
      fetchAged().catch(() => null),
      fetchProductIndex().catch(() => ({}) as Record<string, string>),
    ]);

    const libraryAppUrl = getProductLibraryConfig()?.appUrl ?? null;

    // Build SKU → oldest age bucket for context on LTSF exposure.
    const oldestAgeBySku: Record<string, string> = {};
    if (aged && aged.ready) {
      for (const a of aged.rows) {
        const key = a.sku.trim().toLowerCase();
        if (a.age365Plus > 0) oldestAgeBySku[key] = "365+ days";
        else if (a.age331_365 > 0) oldestAgeBySku[key] = "331-365 days";
        else if (a.age271_330 > 0) oldestAgeBySku[key] = "271-330 days";
        else if (a.age181_270 > 0) oldestAgeBySku[key] = "181-270 days";
        else if (a.age91_180 > 0) oldestAgeBySku[key] = "91-180 days";
        else if (a.age0_90 > 0) oldestAgeBySku[key] = "0-90 days";
      }
    }

    // Merge adjustment buckets into each unfulfillable row.
    let bucketsAvailable = false;
    if (unfulfillable.ready && Object.keys(buckets).length > 0) {
      const enriched: UnfulfillableRow[] = unfulfillable.rows.map((r) => {
        const b = buckets[r.sku.trim().toLowerCase()];
        const oldest = oldestAgeBySku[r.sku.trim().toLowerCase()] ?? null;
        if (b) {
          bucketsAvailable = true;
          // Scale bucket ratios to the CURRENT unsellable total — Amazon's
          // adjustment log accumulates history, while the MYI report shows the
          // remaining unsellable snapshot. Ratios approximate current mix.
          const bTotal = b.reimbursableTotal + b.nonReimbursableTotal;
          const scale = bTotal > 0 ? r.unsellableTotal / bTotal : 0;
          const scaled = {
            warehouseDamaged: Math.round(b.warehouseDamaged * scale),
            carrierDamaged: Math.round(b.carrierDamaged * scale),
            distributorDamaged: Math.round(b.distributorDamaged * scale),
            customerDamaged: Math.round(b.customerDamaged * scale),
            defective: Math.round(b.defective * scale),
            expired: Math.round(b.expired * scale),
          };
          const reimbursableTotal =
            scaled.warehouseDamaged + scaled.carrierDamaged + scaled.distributorDamaged;
          const nonReimbursableTotal =
            scaled.customerDamaged + scaled.defective + scaled.expired;
          const reimbursableUsd = (r.yourPrice ?? 0) * reimbursableTotal;
          return {
            ...r,
            ...scaled,
            bucketsFromAdjustments: true,
            reimbursableTotal,
            nonReimbursableTotal,
            reimbursableUsd,
            oldestAgeBucket: oldest,
          };
        }
        return { ...r, oldestAgeBucket: oldest };
      });
      unfulfillable.rows = enriched;
    }

    return NextResponse.json({
      stranded,
      unfulfillable: { ...unfulfillable, bucketsAvailable },
      libraryAppUrl,
      libraryIndex,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "inventory-issues failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
