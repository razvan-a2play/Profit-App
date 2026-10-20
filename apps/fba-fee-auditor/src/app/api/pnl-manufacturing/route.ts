import { NextResponse } from "next/server";
import { fetchPnlManufacturing, isPnlConfigured } from "@/lib/pnlManufacturing";
import { upsertComponent } from "@/lib/cogsStore";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET — preview manufacturing costs without writing. */
export async function GET() {
  if (!isPnlConfigured()) {
    return NextResponse.json({
      ok: false,
      configured: false,
      error:
        "Add PNL_SUPABASE_URL and PNL_SUPABASE_SERVICE_ROLE_KEY to .env.local to pull manufacturing costs automatically.",
      rows: [],
    });
  }
  return NextResponse.json(await fetchPnlManufacturing());
}

/** POST — pull and write into the COGS store's `manufacturing` component. */
export async function POST() {
  const res = await fetchPnlManufacturing();
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error ?? "PNL pull failed", configured: res.configured },
      { status: res.configured ? 500 : 400 },
    );
  }
  const entries = res.rows.map((r) => ({ sku: r.sku, value: r.manufacturing }));
  if (entries.length === 0) {
    return NextResponse.json({ error: "No saved PNL versions with costs found." }, { status: 400 });
  }
  upsertComponent("manufacturing", entries);
  return NextResponse.json({ ok: true, imported: entries.length, rows: res.rows.slice(0, 60) });
}
