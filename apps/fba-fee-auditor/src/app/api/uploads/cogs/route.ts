import { NextResponse } from "next/server";
import {
  getCogs,
  parsePairs,
  upsertComponent,
  setDefaults,
  clearCogs,
  resolveCogs,
  type CogsComponents,
} from "@/lib/cogsStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FIELDS: (keyof CogsComponents)[] = ["manufacturing", "freight", "other", "override"];

/** Header hint per field, so pasted exports pick the right column. */
const HEADER_HINT: Partial<Record<keyof CogsComponents, string>> = {
  freight: "$ / unit",
};

export async function GET() {
  const s = getCogs();
  const entries = Object.entries(s.bySku).map(([sku, c]) => {
    const r = resolveCogs(s, sku, null);
    return { sku, ...c, landed: r.cogs, source: r.source };
  });
  entries.sort((a, b) => a.sku.localeCompare(b.sku));
  return NextResponse.json({
    updatedAt: s.updatedAt,
    count: entries.length,
    defaultRatioOfPrice: s.defaultRatioOfPrice,
    entries,
  });
}

export async function POST(req: Request) {
  try {
    const ct = req.headers.get("content-type") ?? "";

    // CSV upload (Inbound Pathfinder freight export etc.)
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const field = String(form.get("field") ?? "freight") as keyof CogsComponents;
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file" }, { status: 400 });
      }
      if (!FIELDS.includes(field)) {
        return NextResponse.json({ error: `Unknown field ${field}` }, { status: 400 });
      }
      const text = await file.text();
      const { entries, unparsed } = parsePairs(text, { header: HEADER_HINT[field] });
      if (entries.length === 0) {
        return NextResponse.json(
          { error: "No SKU/value pairs found in that file.", unparsed },
          { status: 400 },
        );
      }
      const store = upsertComponent(field, entries);
      return NextResponse.json({
        ok: true,
        field,
        added: entries.length,
        count: Object.keys(store.bySku).length,
        unparsed,
      });
    }

    const body = await req.json();

    // Default price-ratio fallback
    if (body.defaultRatioOfPrice !== undefined) {
      setDefaults({
        ...(body.defaultRatioOfPrice !== undefined
          ? {
              defaultRatioOfPrice:
                body.defaultRatioOfPrice == null || body.defaultRatioOfPrice === ""
                  ? null
                  : Number(body.defaultRatioOfPrice),
            }
          : {}),
      });
      const s = getCogs();
      return NextResponse.json({
        ok: true,
        defaultRatioOfPrice: s.defaultRatioOfPrice,
      });
    }

    // Pasted "SKU value" text for one component
    const field = (body.field ?? "override") as keyof CogsComponents;
    if (!FIELDS.includes(field)) {
      return NextResponse.json({ error: `Unknown field ${field}` }, { status: 400 });
    }
    const text: string = body.text ?? "";
    if (!text.trim()) return NextResponse.json({ error: "Paste is empty" }, { status: 400 });

    const { entries, unparsed } = parsePairs(text, { header: HEADER_HINT[field] });
    if (entries.length === 0) {
      return NextResponse.json(
        {
          error: "No SKU/value pairs found. One per line, e.g. `SPBATH0034, 3.55`.",
          unparsed,
        },
        { status: 400 },
      );
    }
    const store = upsertComponent(field, entries);
    return NextResponse.json({
      ok: true,
      field,
      added: entries.length,
      count: Object.keys(store.bySku).length,
      unparsed,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  clearCogs();
  return NextResponse.json({ ok: true });
}
