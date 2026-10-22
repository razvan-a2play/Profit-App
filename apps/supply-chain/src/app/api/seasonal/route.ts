import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { DATA_DIR } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Which SKUs are seasonal and their lead time in days, kept in a file beside
 * the app's other local data so the setting survives restarts and browsers.
 */
const FILE = path.join(DATA_DIR, "seasonal-skus.json");

function read(): Record<string, number> {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, number] => typeof e[1] === "number"));
  } catch {
    return {};
  }
}

export async function GET() {
  return NextResponse.json(read());
}

/** Body: the whole map, { "SKU": leadDays }. A SKU left out is no longer seasonal. */
export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "expected { sku: leadDays }" }, { status: 400 });
  }
  const clean: Record<string, number> = {};
  for (const [sku, days] of Object.entries(body)) {
    const d = Math.round(Number(days));
    if (sku && d >= 0 && d <= 365) clean[sku.toUpperCase()] = d;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(clean, null, 2), "utf8");
  return NextResponse.json(clean);
}
