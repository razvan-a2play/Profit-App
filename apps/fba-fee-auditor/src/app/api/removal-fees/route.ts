import { NextResponse } from "next/server";
import { refreshRemovalFees, getRemovalFees } from "@/lib/removalFees";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json(getRemovalFees() ?? { empty: true });
}

/** Pull the newest FBA Removal Order Detail report and cache per-SKU fees. */
export async function POST() {
  try {
    const res = await refreshRemovalFees();
    if (!res.ok) {
      return NextResponse.json(
        {
          ...res,
          error:
            res.status === "generating"
              ? "Amazon is still generating the removal report — try again in a few minutes."
              : res.status === "requested"
                ? "Requested a removal report from Amazon — try again in a few minutes."
                : `Not ready: ${res.status}`,
        },
        { status: 202 },
      );
    }
    return NextResponse.json({ ...res, ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Removal-fee refresh failed" },
      { status: 500 },
    );
  }
}
