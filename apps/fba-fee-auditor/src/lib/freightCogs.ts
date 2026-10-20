// Pulls landed freight per unit straight from the Inbound Pathfinder database
// (same Supabase project as the Product Library, so the service_role key we
// already hold works).
//
// Mirrors Inbound Pathfinder's "Freight COGS — Actuals only" report:
//   1. shipments delivered/received inside the window
//   2. keep only shipments covered by an APPROVED (or paid) invoice — that's
//      what finance recognises as COGS; quoted estimates are excluded
//   3. packing_list_boxes give per-SKU units + CBM for each shipment
//   4. a SKU's slice of the bill is CBM-weighted:
//        freight_share = shipment_freight x (sku_cbm / shipment_total_cbm)
//      because ocean freight is priced by volume
//   5. freight_per_unit = total_freight / total_units across all shipments
//
// US-only by default: Canadian FCs use ship_to_code starting with "Y", and the
// returns/dashboard data we compare against is filtered to the US marketplace.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getProductLibraryConfig } from "./env";

export interface FreightRow {
  sku: string;
  asin: string | null;
  title: string | null;
  units: number;
  cbm: number;
  freight: number;
  freightPerUnit: number;
  shipments: number;
}

export interface FreightResult {
  ok: boolean;
  error?: string;
  windowStart: string;
  windowEnd: string;
  shipmentsInWindow: number;
  shipmentsCovered: number;
  rows: FreightRow[];
}

function client(): SupabaseClient | null {
  const cfg = getProductLibraryConfig();
  if (!cfg) return null;
  return createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Canadian fulfilment centres use a Y-prefixed code. */
function isCanada(shipToCode: string | null, dest: string | null): boolean {
  if (shipToCode && /^Y/i.test(shipToCode)) return true;
  const d = (dest ?? "").toLowerCase();
  return /canada|ontario|quebec|british columbia|alberta|manitoba|saskatchewan/.test(d);
}

/** Supabase caps rows per request; page through until exhausted. */
async function fetchAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await run(from, from + pageSize - 1);
    if (error) throw error;
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < pageSize) break;
  }
  return out;
}

export async function fetchFreightCogs(opts: {
  lookbackDays?: number;
  market?: "US" | "CA" | "all";
} = {}): Promise<FreightResult> {
  const lookbackDays = opts.lookbackDays ?? 365;
  const market = opts.market ?? "US";
  const end = new Date();
  const start = new Date(end.getTime() - lookbackDays * 86_400_000);
  const windowStart = start.toISOString().slice(0, 10);
  const windowEnd = end.toISOString().slice(0, 10);

  const sb = client();
  if (!sb) {
    return {
      ok: false,
      error: "Product Library Supabase not configured",
      windowStart, windowEnd, shipmentsInWindow: 0, shipmentsCovered: 0, rows: [],
    };
  }

  try {
    const startIso = `${windowStart}T00:00:00Z`;
    const endIso = `${windowEnd}T23:59:59Z`;

    // 1. Shipments delivered or received in the window.
    const { data: shipments, error: sErr } = await sb
      .from("shipments")
      .select(
        "id, reference, ship_to_code, ship_to_destination, destination_type, total_cbm, amazon_delivered_at, amazon_received_at, status",
      )
      .or(
        [
          `and(amazon_received_at.gte.${startIso},amazon_received_at.lte.${endIso})`,
          `and(amazon_received_at.is.null,amazon_delivered_at.gte.${startIso},amazon_delivered_at.lte.${endIso})`,
        ].join(","),
      );
    if (sErr) throw sErr;

    type Ship = {
      id: string;
      ship_to_code: string | null;
      ship_to_destination: string | null;
      total_cbm: number | null;
    };
    const all = (shipments ?? []) as Ship[];
    const filtered = all.filter((s) => {
      if (market === "all") return true;
      const ca = isCanada(s.ship_to_code, s.ship_to_destination);
      return market === "CA" ? ca : !ca;
    });
    const ids = filtered.map((s) => s.id);
    if (ids.length === 0) {
      return { ok: true, windowStart, windowEnd, shipmentsInWindow: 0, shipmentsCovered: 0, rows: [] };
    }
    const shipById = new Map(filtered.map((s) => [s.id, s]));

    // 2. Approved/paid invoice totals per shipment — actuals only.
    const invLines = await fetchAll<{
      matched_shipment_id: string | null;
      amount: number | null;
      invoice: { status: string | null } | { status: string | null }[] | null;
    }>((from, to) =>
      sb
        .from("invoice_lines")
        .select("matched_shipment_id, amount, invoice:invoice_id(status)")
        .in("matched_shipment_id", ids)
        .range(from, to),
    );

    const freightByShip = new Map<string, number>();
    for (const l of invLines) {
      const parent = l.invoice;
      const status = Array.isArray(parent) ? parent[0]?.status : parent?.status;
      if (status !== "approved" && status !== "paid") continue;
      const sid = l.matched_shipment_id;
      if (!sid) continue;
      freightByShip.set(sid, (freightByShip.get(sid) ?? 0) + (Number(l.amount) || 0));
    }
    const covered = [...freightByShip.entries()].filter(([, v]) => v > 0).map(([k]) => k);
    if (covered.length === 0) {
      return {
        ok: true, windowStart, windowEnd,
        shipmentsInWindow: ids.length, shipmentsCovered: 0, rows: [],
      };
    }

    // 3. Packing lists -> boxes for the SKU x CBM x units breakdown.
    const { data: pls, error: plErr } = await sb
      .from("packing_lists")
      .select("id, shipment_id")
      .in("shipment_id", covered);
    if (plErr) throw plErr;
    const plToShip = new Map<string, string>(
      (pls ?? []).map((p) => [p.id as string, p.shipment_id as string]),
    );
    const plIds = [...plToShip.keys()];
    if (plIds.length === 0) {
      return {
        ok: true, windowStart, windowEnd,
        shipmentsInWindow: ids.length, shipmentsCovered: covered.length, rows: [],
      };
    }

    const boxes = await fetchAll<{
      packing_list_id: string;
      sku: string | null;
      asin: string | null;
      title: string | null;
      qty: number | null;
      volume_cbm: number | null;
    }>((from, to) =>
      sb
        .from("packing_list_boxes")
        .select("packing_list_id, sku, asin, title, qty, volume_cbm")
        .in("packing_list_id", plIds)
        .range(from, to),
    );

    // 4. Roll up per (shipment x SKU).
    type Line = { shipment: string; sku: string; asin: string | null; title: string | null; units: number; cbm: number };
    const perLine = new Map<string, Line>();
    for (const b of boxes) {
      const sid = plToShip.get(b.packing_list_id);
      if (!sid || !shipById.has(sid)) continue;
      const sku = (b.sku ?? "").trim();
      if (!sku) continue;
      const k = `${sid}::${sku}`;
      const cur =
        perLine.get(k) ??
        { shipment: sid, sku, asin: b.asin ?? null, title: b.title ?? null, units: 0, cbm: 0 };
      cur.units += Number(b.qty) || 0;
      cur.cbm += Number(b.volume_cbm) || 0;
      if (!cur.asin && b.asin) cur.asin = b.asin;
      if (!cur.title && b.title) cur.title = b.title;
      perLine.set(k, cur);
    }

    // CBM actually shipped per shipment — prefer the summed box CBM over the
    // header's total_cbm so the shares always add to 100% of the bill.
    const cbmByShip = new Map<string, number>();
    for (const l of perLine.values()) {
      cbmByShip.set(l.shipment, (cbmByShip.get(l.shipment) ?? 0) + l.cbm);
    }

    // 5. CBM-weighted allocation, then aggregate per SKU.
    const agg = new Map<string, FreightRow & { _ships: Set<string> }>();
    for (const l of perLine.values()) {
      const bill = freightByShip.get(l.shipment) ?? 0;
      if (bill <= 0) continue;
      const shipCbm = cbmByShip.get(l.shipment) ?? shipById.get(l.shipment)?.total_cbm ?? 0;
      if (shipCbm <= 0) continue;
      const share = bill * (l.cbm / shipCbm);

      const key = l.sku.toLowerCase();
      const cur =
        agg.get(key) ??
        {
          sku: l.sku, asin: l.asin, title: l.title,
          units: 0, cbm: 0, freight: 0, freightPerUnit: 0, shipments: 0,
          _ships: new Set<string>(),
        };
      cur.units += l.units;
      cur.cbm += l.cbm;
      cur.freight += share;
      cur._ships.add(l.shipment);
      if (!cur.asin && l.asin) cur.asin = l.asin;
      if (!cur.title && l.title) cur.title = l.title;
      agg.set(key, cur);
    }

    const rows: FreightRow[] = [...agg.values()]
      .map((r) => ({
        sku: r.sku,
        asin: r.asin,
        title: r.title,
        units: r.units,
        cbm: Math.round(r.cbm * 100) / 100,
        freight: Math.round(r.freight * 100) / 100,
        freightPerUnit: r.units > 0 ? Math.round((r.freight / r.units) * 10000) / 10000 : 0,
        shipments: r._ships.size,
      }))
      .filter((r) => r.units > 0)
      .sort((a, b) => b.units - a.units);

    return {
      ok: true,
      windowStart, windowEnd,
      shipmentsInWindow: ids.length,
      shipmentsCovered: covered.length,
      rows,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      windowStart, windowEnd, shipmentsInWindow: 0, shipmentsCovered: 0, rows: [],
    };
  }
}
