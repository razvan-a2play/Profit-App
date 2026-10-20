import { NextResponse } from "next/server";
import {
  parsePastedDashboard,
  storePastedDashboard,
  appendPastedDashboard,
  getPastedDashboard,
  clearPastedDashboard,
} from "@/lib/pastedDashboard";

export const dynamic = "force-dynamic";

/** GET — what's currently stored. */
export async function GET() {
  const d = getPastedDashboard();
  if (!d) return NextResponse.json({ present: false });
  return NextResponse.json({
    present: true,
    pastedAt: d.pastedAt,
    asinCount: d.rows.length,
    totalUnits: d.totalUnits,
    unparsedSample: d.unparsedSample,
    rows: d.rows,
  });
}

/** POST — body is the raw pasted text. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const text: string = body?.text ?? (await req.text());
    if (!text || text.trim().length < 10) {
      return NextResponse.json({ error: "Paste looks empty" }, { status: 400 });
    }
    const parsed = parsePastedDashboard(text);
    if (parsed.rows.length === 0) {
      return NextResponse.json(
        {
          error:
            "No ASINs found in the paste. Make sure you copied the table rows (each row should contain an ASIN like B07MNMT3M7 and a return-units number).",
          unparsedSample: parsed.unparsedSample,
        },
        { status: 400 },
      );
    }

    // Multi-page tables: append mode merges each page into the stored set.
    const append = body?.append === true;
    const newAsins = parsed.rows.length;
    const final = append ? appendPastedDashboard(parsed) : (storePastedDashboard(parsed), parsed);

    return NextResponse.json({
      ok: true,
      appended: append,
      addedThisPaste: newAsins,
      pastedAt: final.pastedAt,
      asinCount: final.rows.length,
      totalUnits: final.totalUnits,
      unparsedSample: final.unparsedSample,
      rows: final.rows,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Parse failed" },
      { status: 400 },
    );
  }
}

/** DELETE — clear stored paste. */
export async function DELETE() {
  clearPastedDashboard();
  return NextResponse.json({ ok: true });
}
