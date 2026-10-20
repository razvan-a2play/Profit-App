// Units sold per SKU from the SP-API gateway's velocity endpoint, used to rank
// SKUs by revenue so the decision table can be filtered to "the SKUs that make
// up N% of revenue" instead of the full catalogue.
//
// Annualised from the 90-day window (the longest the endpoint returns) rather
// than 30d, so seasonal SKUs aren't judged on a single slow month.

import { getSellerCentralConfig } from "./env";

export interface VelocityRow {
  last7d: number;
  last30d: number;
  last60d: number;
  last90d: number;
}

export type VelocityMap = Record<string, VelocityRow>;

const TTL_MS = 60 * 60 * 1000; // 1h — velocity moves slowly
let cache: { at: number; value: VelocityMap } | null = null;

export async function fetchVelocity(): Promise<VelocityMap> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const cfg = getSellerCentralConfig();
  if (!cfg) return {};
  try {
    const res = await fetch(`${cfg.baseUrl}/inventory/velocity`, {
      headers: { "X-API-Key": cfg.apiKey },
      cache: "no-store",
    });
    if (!res.ok) return cache?.value ?? {};
    const body = (await res.json()) as { data?: VelocityMap };
    const map: VelocityMap = {};
    for (const [sku, v] of Object.entries(body.data ?? {})) {
      map[sku.trim().toLowerCase()] = v;
    }
    cache = { at: Date.now(), value: map };
    return map;
  } catch {
    return cache?.value ?? {};
  }
}

/** Annualised units, preferring the widest window with data. */
export function annualUnits(v: VelocityRow | undefined): number | null {
  if (!v) return null;
  if (v.last90d > 0) return (v.last90d * 365) / 90;
  if (v.last60d > 0) return (v.last60d * 365) / 60;
  if (v.last30d > 0) return (v.last30d * 365) / 30;
  return null;
}
