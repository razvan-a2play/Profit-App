import { NextResponse } from "next/server";
import {
  parseUploadedCsv,
  storeUpload,
  listUploads,
  deleteUpload,
  type UploadedFormat,
} from "@/lib/uploadedReports";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/uploads/returns — list what's been uploaded */
export async function GET() {
  return NextResponse.json({ uploads: listUploads() });
}

/**
 * POST /api/uploads/returns — accept a CSV file body (raw text or multipart).
 * Auto-detects the Amazon report format from the header row.
 */
export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    let text: string;
    let filename = "upload.csv";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file in form" }, { status: 400 });
      }
      filename = file.name || filename;
      text = await file.text();
    } else {
      text = await req.text();
      const nameParam = new URL(req.url).searchParams.get("filename");
      if (nameParam) filename = nameParam;
    }

    if (!text || text.trim().length === 0) {
      return NextResponse.json({ error: "Empty upload" }, { status: 400 });
    }

    const report = parseUploadedCsv(filename, text);
    storeUpload(report);

    return NextResponse.json({
      ok: true,
      format: report.format,
      filename: report.filename,
      rowCount: report.rowCount,
      skuCount: Object.keys(report.bySku).length,
      asinCount: Object.keys(report.byAsin).length,
      headers: report.headers,
      uploadedAt: report.uploadedAt,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 400 },
    );
  }
}

/** DELETE /api/uploads/returns?format=return_insights — remove one uploaded report. */
export async function DELETE(req: Request) {
  const format = new URL(req.url).searchParams.get("format") as UploadedFormat | null;
  if (!format) return NextResponse.json({ error: "format required" }, { status: 400 });
  deleteUpload(format);
  return NextResponse.json({ ok: true });
}
