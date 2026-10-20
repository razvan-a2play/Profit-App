import { NextResponse } from "next/server";
import { fetchAged } from "@/lib/amazonInventory";
import { rankAged, toAgedSku, totalAged } from "@/lib/agedInventory";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    const aged = await fetchAged();
    if (!aged.ready) {
      return NextResponse.json({
        ready: false,
        status: aged.status ?? "PENDING",
        reportId: aged.reportId,
        dataAsOf: aged.dataAsOf,
        stale: aged.stale,
        rows: [],
        totals: null,
      });
    }
    const rows = rankAged(aged.rows.map(toAgedSku));
    return NextResponse.json({
      ready: true,
      status: aged.status ?? "DONE",
      reportId: aged.reportId,
      dataAsOf: aged.dataAsOf,
      stale: aged.stale,
      totals: totalAged(rows),
      rows,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Aged inventory pull failed" },
      { status: 500 },
    );
  }
}
