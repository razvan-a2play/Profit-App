import { NextResponse } from "next/server";
import { fetchFreightCogs } from "@/lib/freightCogs";
import { upsertComponent } from "@/lib/cogsStore";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** GET — preview freight per unit without writing anything. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const days = Number(url.searchParams.get("days") ?? 365);
  const market = (url.searchParams.get("market") ?? "US") as "US" | "CA" | "all";
  const res = await fetchFreightCogs({ lookbackDays: days, market });
  return NextResponse.json(res);
}

/** POST — pull and write straight into the COGS store's `freight` component. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const days = Number(body.days ?? 365);
  const market = (body.market ?? "US") as "US" | "CA" | "all";

  const res = await fetchFreightCogs({ lookbackDays: days, market });
  if (!res.ok) {
    return NextResponse.json({ error: res.error ?? "Freight pull failed" }, { status: 500 });
  }
  const entries = res.rows
    .filter((r) => r.freightPerUnit > 0)
    .map((r) => ({ sku: r.sku, value: r.freightPerUnit }));
  if (entries.length === 0) {
    return NextResponse.json(
      { error: "No invoiced shipments in the window — nothing to import.", ...res },
      { status: 400 },
    );
  }
  upsertComponent("freight", entries);

  return NextResponse.json({
    ok: true,
    imported: entries.length,
    windowStart: res.windowStart,
    windowEnd: res.windowEnd,
    shipmentsInWindow: res.shipmentsInWindow,
    shipmentsCovered: res.shipmentsCovered,
    rows: res.rows.slice(0, 60),
  });
}
