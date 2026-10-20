import { NextResponse } from "next/server";
import { refreshAsp, getAsp } from "@/lib/avgSellingPrice";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** GET — what's cached. */
export async function GET() {
  const s = getAsp();
  if (!s) return NextResponse.json({ present: false });
  return NextResponse.json({
    present: true,
    updatedAt: s.updatedAt,
    reportId: s.reportId,
    windowStart: s.windowStart,
    windowEnd: s.windowEnd,
    skuCount: Object.keys(s.bySku).length,
  });
}

/** POST — pull a fresh 365-day ASP from Amazon's All-Orders report. */
export async function POST() {
  try {
    const res = await refreshAsp();
    if (!res.ok) {
      return NextResponse.json(
        {
          error:
            res.status === "generating"
              ? "Amazon is generating the 365-day orders report — try again in a few minutes."
              : `Not ready: ${res.status}`,
          ...res,
        },
        { status: 202 },
      );
    }
    return NextResponse.json({ ...res, ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ASP refresh failed" },
      { status: 500 },
    );
  }
}
