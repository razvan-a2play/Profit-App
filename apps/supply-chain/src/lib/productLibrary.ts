// Server-only: each SKU's category, from the Product Library (the
// supply-chain-app's Supabase project, which the FBA Fee Auditor already reads).
// A category is the product's product line. Read-only; refreshed hourly, and
// the last good copy is kept on disk so the page still has categories when
// the Library can't be reached.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./server";

export interface Categories {
  /** SKU (upper case) -> product line name. */
  bySku: Record<string, string>;
  /** Every product line, in the Library's order. */
  lines: string[];
  fetchedAt: string;
  /** Why the Library couldn't be read, when it couldn't. */
  error?: string;
}

const FILE = path.join(DATA_DIR, "product-categories.json");
const MAX_AGE_MS = 3600 * 1000;
let memo: Categories | null = null;

/**
 * The Library's URL and service key: this app's own env first, else the FBA
 * Fee Auditor's .env.local beside it (one key, kept in one place).
 */
function config(): { url: string; key: string } | null {
  let url = process.env.PRODUCT_LIBRARY_SUPABASE_URL;
  let key = process.env.PRODUCT_LIBRARY_SUPABASE_KEY;
  if (!url || !key) {
    try {
      const text = fs.readFileSync(path.join(process.cwd(), "..", "fba-fee-auditor", ".env.local"), "utf8");
      const read = (name: string) => text.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim();
      url ||= read("PRODUCT_LIBRARY_SUPABASE_URL");
      key ||= read("PRODUCT_LIBRARY_SUPABASE_KEY");
    } catch {
      /* no auditor config either */
    }
  }
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

async function rest<T>(c: { url: string; key: string }, query: string): Promise<T> {
  const res = await fetch(`${c.url}/rest/v1/${query}`, {
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Product Library ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export async function getCategories(): Promise<Categories> {
  if (memo && Date.now() - Date.parse(memo.fetchedAt) < MAX_AGE_MS && !memo.error) return memo;
  const saved = (() => {
    try {
      return JSON.parse(fs.readFileSync(FILE, "utf8")) as Categories;
    } catch {
      return null;
    }
  })();
  const c = config();
  if (!c) return (memo = saved ?? { bySku: {}, lines: [], fetchedAt: new Date().toISOString(), error: "Product Library not configured" });
  try {
    const [lines, products] = await Promise.all([
      rest<Array<{ id: string; name: string }>>(c, "product_lines?select=id,name&order=created_at"),
      rest<Array<{ id: string; sku: string; product_line_id: string | null; parent_sku: string | null }>>(
        c,
        "products?select=id,sku,product_line_id,parent_sku",
      ),
    ]);
    const lineName = new Map(lines.map((l) => [l.id, l.name]));
    const byId = new Map(products.map((p) => [p.id, p]));
    const bySku: Record<string, string> = {};
    for (const p of products) {
      // A variant without its own line takes its parent's.
      const lineId = p.product_line_id ?? (p.parent_sku ? byId.get(p.parent_sku)?.product_line_id : null);
      const name = lineId ? lineName.get(lineId) : undefined;
      if (name) bySku[p.sku.trim().toUpperCase()] = name;
    }
    memo = { bySku, lines: lines.map((l) => l.name), fetchedAt: new Date().toISOString() };
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(memo), "utf8");
    } catch {
      /* the copy in memory still serves */
    }
    return memo;
  } catch (e) {
    return (memo = { ...(saved ?? { bySku: {}, lines: [] }), fetchedAt: new Date().toISOString(), error: (e as Error).message });
  }
}

/**
 * The category for a SKU as the reports name it: the Library's own SKU, or the
 * SKU it is a channel copy of (an FBM listing of the same product).
 */
export function categoryOf(cats: Categories, sku: string): string | null {
  const s = sku.trim().toUpperCase();
  return cats.bySku[s] ?? cats.bySku[s.replace(/-?FBM$/, "")] ?? null;
}
