import { NextResponse } from "next/server";
import { parseReturnsCsv, getReturnsCsv, clearReturnsCsv } from "@/lib/returnsCsvStore";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const s = getReturnsCsv();
  if (!s) return NextResponse.json({ present: false });
  return NextResponse.json({
    present: true,
    filename: s.filename,
    uploadedAt: s.uploadedAt,
    windowStart: s.windowStart,
    windowEnd: s.windowEnd,
    totalRows: s.totalRows,
    usRows: s.usRows,
    canadaRows: s.canadaRows,
    skuCount: Object.keys(s.bySku).length,
  });
}

export async function POST(req: Request) {
  try {
    const ct = req.headers.get("content-type") ?? "";
    let text: string;
    let filename = "returns.csv";
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const f = form.get("file");
      if (!(f instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
      filename = f.name || filename;
      text = await f.text();
    } else {
      text = await req.text();
    }
    const s = parseReturnsCsv(filename, text);
    return NextResponse.json({
      ok: true,
      filename: s.filename,
      windowStart: s.windowStart,
      windowEnd: s.windowEnd,
      totalRows: s.totalRows,
      usRows: s.usRows,
      canadaRows: s.canadaRows,
      skuCount: Object.keys(s.bySku).length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Parse failed" },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  clearReturnsCsv();
  return NextResponse.json({ ok: true });
}
