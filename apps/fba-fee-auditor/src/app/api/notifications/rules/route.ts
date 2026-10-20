import { NextResponse } from "next/server";
import { listRules, createRule, updateRule, deleteRule } from "@/lib/notificationRules";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ rules: await listRules() });
  } catch (err) {
    return NextResponse.json({ rules: [], error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rule = await createRule({
      metric: body.metric ?? "stranded_pct_per_sku",
      threshold_pct: Number(body.threshold_pct),
      email: String(body.email).trim(),
      enabled: body.enabled ?? true,
    });
    return NextResponse.json({ rule });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, ...patch } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const rule = await updateRule(id, patch);
    return NextResponse.json({ rule });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await deleteRule(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
