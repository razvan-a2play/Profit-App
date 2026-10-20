// One-off connectivity check: does the service_role key read the unit packaging
// specs (through RLS) and join to products? Run: node scripts/check-library.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// Minimal .env.local parse (no extra deps).
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const client = createClient(env.PRODUCT_LIBRARY_SUPABASE_URL, env.PRODUCT_LIBRARY_SUPABASE_KEY, {
  auth: { persistSession: false },
});

const { data, error, count } = await client
  .from("packaging_specs")
  .select("length_cm,width_cm,height_cm,weight_kg,version_number,status,products!inner(sku,asin)", { count: "exact" })
  .eq("spec_type", env.PRODUCT_LIBRARY_UNIT_SPEC_TYPE || "unit")
  .limit(5);

if (error) {
  console.error("ERROR:", error.message);
  process.exit(1);
}
console.log(`unit packaging_specs rows (count=${count}). First ${data.length}:`);
for (const r of data) {
  console.log(
    `  ${r.products?.sku ?? "?"}  ${r.length_cm}x${r.width_cm}x${r.height_cm} cm  ${r.weight_kg} kg  v${r.version_number} ${r.status}`,
  );
}
