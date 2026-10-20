import { NextResponse } from "next/server";
import { fetchAsinIndex } from "@/lib/productLibrary";
import { fetchPnlManufacturing, isPnlConfigured } from "@/lib/pnlManufacturing";
import {
  buildUploadFile,
  compareSourcingCosts,
  parseSourcingFile,
  summarise,
  type SourcingComparisonRow,
} from "@/lib/sourcingCost";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST a downloaded sourcing-cost file and get back every ASIN lined up with
 * the PNL app's manufacturing cost, plus the upload file to send back.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = parseSourcingFile(buf);
    if (parsed.rows.length === 0) {
      return NextResponse.json(
        { error: "That file has a header but no ASIN rows." },
        { status: 400 },
      );
    }

    if (!isPnlConfigured()) {
      return NextResponse.json(
        {
          error:
            "PNL Supabase is not configured, so there is nothing to check against. " +
            "Add PNL_SUPABASE_URL and PNL_SUPABASE_SERVICE_ROLE_KEY to .env.local.",
        },
        { status: 400 },
      );
    }

    const [skuByCode, pnl] = await Promise.all([fetchAsinIndex(), fetchPnlManufacturing()]);
    if (!pnl.ok) {
      return NextResponse.json({ error: pnl.error ?? "PNL pull failed" }, { status: 500 });
    }
    if (Object.keys(skuByCode).length === 0) {
      return NextResponse.json(
        {
          error:
            "The Product Library returned no products, so ASINs cannot be matched to SKUs. " +
            "Check PRODUCT_LIBRARY_SUPABASE_URL / _KEY.",
        },
        { status: 400 },
      );
    }

    const costBySku: Record<string, { cost: number; versionName: string | null }> = {};
    for (const r of pnl.rows) {
      costBySku[r.sku.toLowerCase()] = { cost: r.manufacturing, versionName: r.versionName };
    }

    const rows = compareSourcingCosts(parsed.rows, { skuByCode, costBySku });
    return NextResponse.json({
      ok: true,
      fileName: file.name,
      skippedRows: parsed.skipped,
      pnlSkus: pnl.rows.length,
      summary: summarise(rows),
      rows,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read that file." },
      { status: 400 },
    );
  }
}

/** PUT — rebuild the upload file for whichever rows the user accepted. */
export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as {
      rows?: SourcingComparisonRow[];
      newCostByAsin?: Record<string, number>;
    };
    if (!body.rows?.length) {
      return NextResponse.json({ error: "No rows to write." }, { status: 400 });
    }
    const text = buildUploadFile(body.rows, body.newCostByAsin ?? {});
    return new NextResponse(text, {
      headers: {
        "Content-Type": "text/tab-separated-values; charset=utf-8",
        "Content-Disposition": 'attachment; filename="sourcing-cost-upload.txt"',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 400 },
    );
  }
}
