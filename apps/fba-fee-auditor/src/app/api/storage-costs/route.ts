import { NextResponse } from "next/server";
import path from "node:path";
import { defaultMonth, loadMonthCosts } from "@platform/supply-chain-data/monthCosts";
import { getGateway } from "@/lib/gateway";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DATA_DIR = path.join(process.cwd(), ".data");

export async function GET(req: Request) {
  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? defaultMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month must look like 2026-08" }, { status: 400 });
  }
  let gw;
  try {
    gw = getGateway();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  const { status, body } = await loadMonthCosts(gw, month, {
    dataDir: DATA_DIR,
    refresh: url.searchParams.get("refresh") === "1",
    // Re-ask until the gateway has the month with refunds netted (signed charges).
    requireSigned: true,
  });
  return NextResponse.json(body, { status });
}
