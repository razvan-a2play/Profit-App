/**
 * GET /api/library-products: every non-archived Product Library product with
 * its unit box and master carton, for the dashboard and the SKU picker.
 *
 * The Library is another Supabase project whose tables need an authenticated
 * role, so this reads it with that project's service-role key, server-side
 * only (PRODUCT_LIBRARY_SUPABASE_URL / PRODUCT_LIBRARY_SUPABASE_KEY). Callers
 * must send their P&L session token and be on the P&L allowlist. Read-only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  pickBestSpec,
  specToBox,
  specToCarton,
  type LibraryLoad,
  type LibraryProduct,
  type SpecRow,
} from "@/lib/product-library";

export const dynamic = "force-dynamic";

const noSession = { persistSession: false, autoRefreshToken: false };

function reply(body: LibraryLoad, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const authz = req.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+/.test(authz)) return reply({ state: "error", message: "Sign in first." }, 401);

  const pnlUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const pnlAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!pnlUrl || !pnlAnon) return reply({ state: "error", message: "P&L database not configured." }, 500);

  // Same allowlist as the rest of the app, checked as the caller.
  const asUser = createClient(pnlUrl, pnlAnon, {
    global: { headers: { Authorization: authz } },
    auth: noSession,
  });
  const { data: allowed, error: allowErr } = await asUser.rpc("is_allowlisted_user");
  if (allowErr) return reply({ state: "error", message: `Couldn't check access: ${allowErr.message}` }, 401);
  if (allowed !== true) return reply({ state: "error", message: "This account isn't on the P&L allowlist." }, 403);

  const libUrl = process.env.PRODUCT_LIBRARY_SUPABASE_URL;
  const libKey = process.env.PRODUCT_LIBRARY_SUPABASE_KEY;
  if (!libUrl || !libKey) return reply({ state: "not-configured" });

  const lib = createClient(libUrl, libKey, { auth: noSession });
  const [products, specs, listings, flags] = await Promise.all([
    lib.from("products").select("id,sku,product_name,status,asin").neq("status", "archived"),
    lib
      .from("packaging_specs")
      .select("sku_id,spec_type,status,version_number,length_cm,width_cm,height_cm,weight_kg,units_per_carton")
      .in("spec_type", ["unit", "master_carton"]),
    lib
      .from("product_listings")
      .select("product_id,asin,status")
      .eq("channel", "Amazon")
      .eq("marketplace", "US"),
    // Dangerous-goods flags; older Library schemas don't have them.
    lib.from("products").select("id,is_hazmat,contains_battery"),
  ]);
  const failed = products.error ?? specs.error ?? listings.error;
  if (failed) return reply({ state: "error", message: `Product Library read failed: ${failed.message}` }, 502);

  const specsById = new Map<string, { unit: SpecRow[]; carton: SpecRow[] }>();
  for (const s of (specs.data ?? []) as SpecRow[]) {
    const entry = specsById.get(s.sku_id) ?? { unit: [], carton: [] };
    (s.spec_type === "unit" ? entry.unit : entry.carton).push(s);
    specsById.set(s.sku_id, entry);
  }
  const usAsin = new Map<string, string>();
  for (const l of (listings.data ?? []) as { product_id: string; asin: string | null; status: string }[]) {
    if (!l.asin) continue;
    if (!usAsin.has(l.product_id) || l.status === "active") usAsin.set(l.product_id, l.asin);
  }
  const dg = new Map<string, { is_hazmat: boolean | null; contains_battery: boolean | null }>();
  if (!flags.error) {
    for (const f of (flags.data ?? []) as { id: string; is_hazmat: boolean | null; contains_battery: boolean | null }[]) {
      dg.set(f.id, f);
    }
  }

  const out: LibraryProduct[] = [];
  for (const p of (products.data ?? []) as {
    id: string;
    sku: string | null;
    product_name: string | null;
    status: string;
    asin: string | null;
  }[]) {
    const sku = p.sku?.trim();
    if (!sku) continue;
    const s = specsById.get(p.id);
    out.push({
      sku,
      name: p.product_name?.trim() || sku,
      status: p.status,
      asin: p.asin?.trim() || usAsin.get(p.id) || null,
      unit: specToBox(pickBestSpec(s?.unit ?? [])),
      carton: specToCarton(pickBestSpec(s?.carton ?? [])),
      hazmat: dg.get(p.id)?.is_hazmat === true,
      containsBattery: dg.get(p.id)?.contains_battery === true,
    });
  }
  out.sort((a, b) => a.sku.localeCompare(b.sku));
  return reply({ state: "ok", products: out });
}
