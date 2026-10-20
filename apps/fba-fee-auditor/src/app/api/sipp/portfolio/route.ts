import { NextResponse } from "next/server";
import { fetchAsinIndex } from "@/lib/productLibrary";
import { getCachedFeeReport } from "@/lib/feeReportCache";
import {
  AUDITED_MARKETPLACE,
  clearSippPortfolio,
  getSippPortfolio,
  mapPortfolioToSkus,
  parseSippPortfolio,
  storeSippPortfolio,
  type StoredPortfolio,
} from "@/lib/sippPortfolio";

export const dynamic = "force-dynamic";

/** The report is a few kilobytes per hundred ASINs; this is generous. */
const MAX_BYTES = 5_000_000;

/** The stored report, if one has been uploaded. */
export async function GET() {
  return NextResponse.json({ stored: getSippPortfolio() });
}

export async function DELETE() {
  clearSippPortfolio();
  return NextResponse.json({ ok: true });
}

/**
 * Upload Amazon's SIPP Product Portfolio CSV. Each ASIN is matched to its SKU
 * through the Product Library (which carries ASIN and FNSKU) and the cached fee
 * report (which covers listings the Library doesn't), then stored as the
 * certification record the audit uses.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "That file is too large to be the SIPP report." }, { status: 413 });
    }

    const parsed = parseSippPortfolio(await file.text());
    if (parsed.rows.length === 0) {
      return NextResponse.json({ error: "That report has a header but no ASIN rows." }, { status: 400 });
    }

    const skusByAsin = new Map<string, Set<string>>();
    const add = (asin: string | null | undefined, sku: string | null | undefined) => {
      const a = asin?.trim().toLowerCase();
      const s = sku?.trim();
      if (!a || !s) return;
      if (!skusByAsin.has(a)) skusByAsin.set(a, new Set());
      skusByAsin.get(a)!.add(s);
    };
    // The Library index can't be skipped silently: without it most ASINs go
    // unmatched and the certification record would look emptier than it is.
    let libraryError: string | null = null;
    try {
      for (const [code, sku] of Object.entries(await fetchAsinIndex())) add(code, sku);
    } catch (e) {
      libraryError = e instanceof Error ? e.message : "Product Library unavailable";
    }
    for (const r of getCachedFeeReport()?.rows ?? []) add(r.asin, r.sku);

    const mapped = mapPortfolioToSkus(parsed.rows, skusByAsin);
    const stored: StoredPortfolio = {
      importedAt: new Date().toISOString(),
      fileName: file.name,
      ...mapped,
    };
    storeSippPortfolio(stored);

    return NextResponse.json({
      ok: true,
      stored,
      marketplace: AUDITED_MARKETPLACE,
      skippedRows: parsed.skipped,
      ...(libraryError ? { warning: `Couldn't read the Product Library (${libraryError}); matched through the fee report only.` } : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read that file." },
      { status: 400 },
    );
  }
}
