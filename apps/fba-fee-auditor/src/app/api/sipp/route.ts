import { NextResponse } from "next/server";
import { getManualSippTicks, getSippCertified, setSippCertified } from "@/lib/sippCertification";
import { getSippPortfolio, isCertified } from "@/lib/sippPortfolio";

export const dynamic = "force-dynamic";

/**
 * SIPP-certified SKUs (lowercased): `skus` is everything treated as certified,
 * `fromReport` the ones Amazon's SIPP report certifies - those can't be unticked
 * here, since the report is the record - and `manual` the hand-ticked extras.
 */
export async function GET() {
  return NextResponse.json(certificationState());
}

function certificationState() {
  const report = getSippPortfolio();
  const fromReport = report
    ? Object.entries(report.bySku).filter(([, s]) => isCertified(s)).map(([k]) => k)
    : [];
  return { skus: [...getSippCertified()], fromReport, manual: [...getManualSippTicks()] };
}

/** Mark or unmark one SKU: { sku, certified }. */
export async function PUT(req: Request) {
  let body: { sku?: unknown; certified?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  if (typeof body.sku !== "string" || !body.sku.trim() || typeof body.certified !== "boolean") {
    return NextResponse.json({ error: "Give { sku: string, certified: boolean }." }, { status: 400 });
  }
  setSippCertified(body.sku, body.certified);
  return NextResponse.json({ ok: true, ...certificationState() });
}
