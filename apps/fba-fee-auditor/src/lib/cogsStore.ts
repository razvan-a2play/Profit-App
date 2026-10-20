// Per-SKU landed COGS, assembled from its real components:
//
//   landed COGS = manufacturing (PNL app) + freight/unit (Inbound Pathfinder)
//                 + other
//
// File-backed so it survives restarts and is shared across Next.js route
// handlers (dev mode bundles routes separately, so module-level state is NOT
// shared — same reason the dashboard paste is file-backed).
//
// Include: factory price, packaging/inserts, freight, brokerage, prep, inbound
// Exclude: FBA fulfilment fee, referral fee, storage, PPC — those are modelled
// separately or cancel out in the returns decision.

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "cogs.json");

export interface CogsComponents {
  /** Total manufacturing + packaging, from the PNL calculator. */
  manufacturing?: number;
  /** Landed freight per unit, from Inbound Pathfinder's Freight COGS report. */
  freight?: number;
  /** Prep, inbound to FBA, placement fee, anything else. */
  other?: number;
  /** Explicit override — when set, wins over the sum of components. */
  override?: number;
}

export interface CogsStore {
  updatedAt: string;
  /** lowercased sku -> components */
  bySku: Record<string, CogsComponents>;
  /** Fallback for SKUs with no entry: COGS = price * this ratio. */
  defaultRatioOfPrice: number | null;
}

const EMPTY: CogsStore = {
  updatedAt: "",
  bySku: {},
  defaultRatioOfPrice: null,
};

export function getCogs(): CogsStore {
  try {
    if (!fs.existsSync(FILE)) return EMPTY;
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    // Migrate the old shape (bySku: Record<string, number>).
    if (raw.bySku && Object.values(raw.bySku).some((v) => typeof v === "number")) {
      const migrated: Record<string, CogsComponents> = {};
      for (const [k, v] of Object.entries(raw.bySku)) {
        migrated[k] = typeof v === "number" ? { override: v } : (v as CogsComponents);
      }
      return { ...EMPTY, ...raw, bySku: migrated };
    }
    return { ...EMPTY, ...raw } as CogsStore;
  } catch {
    return EMPTY;
  }
}

function write(s: CogsStore) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s), "utf8");
}

export function clearCogs() {
  try {
    if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
  } catch {
    /* ignore */
  }
}

export function setDefaults(opts: {
  defaultRatioOfPrice?: number | null;
}) {
  const s = getCogs();
  write({
    ...s,
    ...(opts.defaultRatioOfPrice !== undefined
      ? { defaultRatioOfPrice: opts.defaultRatioOfPrice }
      : {}),
    updatedAt: new Date().toISOString(),
  });
}

/** Merge one component field across many SKUs (newer wins). */
export function upsertComponent(
  field: keyof CogsComponents,
  entries: { sku: string; value: number }[],
): CogsStore {
  const s = getCogs();
  const bySku = { ...s.bySku };
  for (const e of entries) {
    const k = e.sku.trim().toLowerCase();
    bySku[k] = { ...(bySku[k] ?? {}), [field]: e.value };
  }
  const next = { ...s, bySku, updatedAt: new Date().toISOString() };
  write(next);
  return next;
}

/**
 * Parse "SKU <sep> value" lines. Accepts comma, tab, semicolon or multi-space
 * separators, tolerates a $ sign and a header row. When `valueColumn` is given,
 * picks that 0-indexed column instead of the first numeric one — used for the
 * Inbound Pathfinder freight CSV where `$ / unit` is not the first number.
 */
export function parsePairs(
  text: string,
  opts: { header?: string } = {},
): { entries: { sku: string; value: number }[]; unparsed: string[] } {
  const entries: { sku: string; value: number }[] = [];
  const unparsed: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { entries, unparsed };

  const split = (l: string) =>
    l.split(/\t|,|;|\s{2,}/).map((p) => p.trim().replace(/^"|"$/g, "")).filter(Boolean);

  // If a header name is supplied and present, use that column.
  let skuIdx = 0;
  let valIdx = -1;
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const looksLikeHeader = head.some((h) => /sku|asin|title|unit|cost|freight|\$/.test(h));
  if (looksLikeHeader) {
    const si = head.findIndex((h) => h === "sku" || h === "seller-sku" || h === "msku");
    if (si >= 0) skuIdx = si;
    if (opts.header) {
      const vi = head.findIndex((h) => h.includes(opts.header!.toLowerCase()));
      if (vi >= 0) valIdx = vi;
    }
  }

  for (const line of lines.slice(looksLikeHeader ? 1 : 0)) {
    const parts = split(line);
    if (parts.length < 2) {
      const m = line.trim().match(/^(\S+)\s+\$?([\d.]+)$/);
      if (m) {
        const v = parseFloat(m[2]);
        if (Number.isFinite(v) && v > 0) {
          entries.push({ sku: m[1], value: v });
          continue;
        }
      }
      unparsed.push(line.slice(0, 100));
      continue;
    }
    const sku = parts[skuIdx];
    if (!sku || /^sku$/i.test(sku)) continue;

    let value: number | null = null;
    if (valIdx >= 0 && parts[valIdx] != null) {
      const v = parseFloat(parts[valIdx].replace(/[$,]/g, ""));
      if (Number.isFinite(v) && v > 0) value = v;
    }
    if (value == null) {
      for (let i = 0; i < parts.length; i++) {
        if (i === skuIdx) continue;
        const v = parseFloat(parts[i].replace(/[$,]/g, ""));
        if (Number.isFinite(v) && v > 0) {
          value = v;
          break;
        }
      }
    }
    if (value == null) {
      unparsed.push(line.slice(0, 100));
      continue;
    }
    entries.push({ sku, value });
  }
  return { entries, unparsed };
}

export interface ResolvedCogs {
  cogs: number | null;
  source: "explicit" | "components" | "ratio" | "none";
  breakdown: CogsComponents;
}

/** Resolve landed COGS: override > sum of components > price-ratio fallback. */
export function resolveCogs(
  store: CogsStore,
  sku: string,
  price: number | null | undefined,
): ResolvedCogs {
  const c = store.bySku[sku.trim().toLowerCase()];
  if (c?.override && c.override > 0) {
    return { cogs: c.override, source: "explicit", breakdown: c };
  }
  if (c && (c.manufacturing || c.freight || c.other)) {
    const total = (c.manufacturing ?? 0) + (c.freight ?? 0) + (c.other ?? 0);
    if (total > 0) {
      return { cogs: total, source: "components", breakdown: c };
    }
  }
  if (store.defaultRatioOfPrice && price && price > 0) {
    return {
      cogs: price * store.defaultRatioOfPrice,
      source: "ratio",
      breakdown: {},
    };
  }
  return { cogs: null, source: "none", breakdown: {} };
}
