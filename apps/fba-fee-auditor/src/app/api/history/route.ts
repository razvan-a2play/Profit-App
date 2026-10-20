import { NextResponse } from "next/server";
import { fetchWeeklyHistory } from "@/lib/measurementHistory";

export const dynamic = "force-dynamic";

/** GET /api/history?sku=XYZ → weekly Amazon-measurement averages + your box. */
export async function GET(req: Request) {
  const sku = new URL(req.url).searchParams.get("sku");
  if (!sku) {
    return NextResponse.json({ available: false, sku: "", ours: null, weeks: [] });
  }
  try {
    const history = await fetchWeeklyHistory(sku);
    return NextResponse.json(history);
  } catch (err) {
    const message = err instanceof Error ? err.message : "history fetch failed";
    return NextResponse.json({ available: false, sku, ours: null, weeks: [], error: message });
  }
}
