import { NextResponse } from "next/server";
import { getGateway } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Where the background loading has got to, in a few hundred bytes: how many
 * months are cached and which one is being read. The page polls this and only
 * re-fetches the full figures (about a megabyte) when it changes.
 */
export async function GET() {
  try {
    const s = await getGateway()("/supply-chain/backfill");
    return NextResponse.json({
      cached: s.cached ?? null,
      months: s.months ?? null,
      current: s.current ?? null,
      running: Boolean(s.running),
      missing: Array.isArray(s.missing) ? s.missing.length : null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
