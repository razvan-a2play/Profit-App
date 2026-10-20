// Amazon's PUBLISHED FBA fulfilment rate card, entered by the user.
//
// Why this exists: the audit used to compare Amazon's charge against a rate
// table hardcoded in packages/calc. When Amazon revised its rates the table
// went stale, and the audit started reporting a $0.82/unit "Dangerous Goods
// overcharge" on SPBATH0034 that was simply the new standard rate.
//
// Deriving the table from `expected_fulfillment_fee` instead would be circular:
// if the reference rate IS whatever Amazon billed, a billing error can never be
// detected — the audit could only ever find Amazon disagreeing with itself.
//
// So the reference has to come from OUTSIDE the invoice. The user supplies the
// published rate card (a URL we fetch, or the table pasted from the page), we
// parse it into the same shape as the built-in table, and the audit compares
// billed-vs-published. That makes an Amazon billing mistake visible, which is
// the whole point of the tool.

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "rate-card.json");

/** Matches FbaFeeRow in @platform/calc so it can override the built-in table. */
export interface RateCardRow {
  tier: string;
  weightRange: string;
  nonPeak: number;
  peak: number;
  weightBasis: string;
  /** True when the page listed this row under a Dangerous Goods / hazmat table. */
  hazmat: boolean;
  /**
   * Amazon prices the same tier/weight differently by the item's SELLING price
   * — products under $10 get Low-Price FBA rates. The published table carries
   * a column per band, so we keep them rather than collapsing to one number:
   * SPBATH0034 at $11.00 is billed the $10-$50 rate and SPBATH0010 at $6.42 the
   * <$10 rate, and auditing either against the wrong column invents a variance.
   *
   * `nonPeak` holds the $10-$50 rate (the common case, and the fallback when a
   * page publishes only one column).
   */
  lowPrice?: number | null;
  highPrice?: number | null;
  /** Holiday peak rates, from the page's separate peak table, by price band. */
  peakLow?: number | null;
  peakHigh?: number | null;
  /**
   * Bulky / extra-large tiers: the rate is `nonPeak` plus this much per pound
   * for each whole-pound interval above `surchargeAboveLb`.
   */
  surchargePerInterval?: number | null;
  surchargeIntervalLb?: number | null;
  surchargeAboveLb?: number | null;
}

/** Pick the rate for an item's selling price, falling back to the mid band. */
export function rateForPrice(row: RateCardRow, sellingPrice?: number | null): number {
  if (sellingPrice != null) {
    if (sellingPrice < 10 && row.lowPrice != null) return row.lowPrice;
    if (sellingPrice > 50 && row.highPrice != null) return row.highPrice;
  }
  return row.nonPeak;
}

export interface RateCard {
  savedAt: string;
  /** Where it came from: the URL we fetched, or "pasted". */
  source: string;
  /** Fuel & inflation surcharge as a rate (0.035), if the page stated one. */
  fuelSurchargeRate: number | null;
  rows: RateCardRow[];
  /** Lines we couldn't interpret — shown so the user can spot a bad paste. */
  unparsedSample: string[];
  /**
   * Every fee table found in the source and what was taken from each. Kept so
   * the UI can show that e.g. the apparel tables were deliberately skipped,
   * rather than silently dropping 110 of the 150 rate rows on the page.
   */
  coverage?: SectionCoverage[];
  /**
   * The pasted text this card was parsed from, so it can be re-parsed later
   * without asking the user to paste again — the parser is tolerant and will
   * keep improving as Amazon reshapes the page.
   *
   * Only kept for pasted input. URL-sourced cards re-fetch instead, which is
   * both fresher and avoids storing a multi-megabyte HTML blob.
   */
  raw?: string;
  /**
   * Ships in Product Packaging tables, AS PUBLISHED. Amazon keeps these on a
   * separate Seller Central page, so they usually arrive in their own paste and
   * are merged onto the card rather than replacing it.
   *
   * Stored exactly as the page states them, because the page may state either
   * the discount itself ("$0.11") or the lowered fee ("$5.46"). Which one is
   * decided against the regular rows at the moment they're used - see
   * resolveSippDiscounts - so re-pasting the main fee table can't leave a
   * discount derived from last year's regular rate.
   */
  sipp?: RateCardRow[];
  /** Packaging fee Amazon charges bulky units that are NOT SIPP-certified. */
  nonSippPackaging?: RateCardRow[];
  sippSavedAt?: string;
  /** The SIPP paste, kept so it can be re-parsed like the main one. */
  sippRaw?: string;
}

/** Cap on stored paste text, so .data can't grow unbounded. */
export const MAX_RAW_BYTES = 512_000;

// ── parsing ────────────────────────────────────────────────────────────────

/** "Large standard-size", "Large standard", "LargeStandardSize" -> "large standard" */
function normaliseTier(s: string): string | null {
  const t = s
    .toLowerCase()
    .replace(/[_\-]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\bsize\b/g, "")
    .replace(/\bus\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^small standard/.test(t)) return "small standard";
  if (/^large standard/.test(t)) return "large standard";
  if (/^small bulky/.test(t)) return "small bulky";
  if (/^large bulky/.test(t)) return "large bulky";
  // Hyphenated, to match the tier name calculateFBATierAndFee assigns.
  if (/^extra ?large/.test(t)) return "extra-large";
  if (/oversize/.test(t)) return t;
  return null;
}

// "2 oz or less" | "4+ to 8 oz" | "1+ to 1.25 lb" | "0 to 0.5 lb" | "50+ to 70 lb"
// Weight bands, in the several shapes Amazon's pages and clipboards use.
// Kept as separate patterns rather than one alternation so each can be tuned
// without disturbing the others.
const WEIGHT_PATTERNS: RegExp[] = [
  // "4+ to 8 oz", "4 to 8 oz", "1+ to 1.25 lb", "0 to 0.5 lb", "4 oz to 8 oz"
  /\d+(?:\.\d+)?\s*\+?\s*(?:oz|lb)?\s*\+?\s*(?:to|through|thru|–|—|-)\s*\d+(?:\.\d+)?\s*(?:oz|lb)\b/i,
  // "4 oz or less", "0.5 lb or less"
  /\d+(?:\.\d+)?\s*(?:oz|lb)\s+or\s+less\b/i,
  // "up to 4 oz", "<= 4 oz", "≤4 oz"
  /(?:up\s+to|≤|<=)\s*\d+(?:\.\d+)?\s*(?:oz|lb)\b/i,
  // Open-ended TOP band: "150+ lb", "150 lb and over", "over 150 lb". Amazon's
  // heaviest row has no upper bound, and without this the line parses as no band
  // at all - which the loop below reads as a heading, so a real rate row is
  // dropped without ever being counted. Last, so a closed range like
  // "50+ to 70 lb" is claimed by the range pattern first.
  /\d+(?:\.\d+)?\s*(?:\+\s*(?:oz|lb)\b|\s*(?:oz|lb)\s+(?:and|or)\s+(?:over|above|greater))(?!\s*(?:to|through|thru|–|—|-)\s*\d)/i,
  /(?:over|above)\s+\d+(?:\.\d+)?\s*(?:oz|lb)\b/i,
  // "45 or more lb", "45 lb or more" - the SIPP packaging-fee table's top row.
  /\d+(?:\.\d+)?\s*(?:(?:oz|lb)\s+)?or\s+more(?:\s+(?:oz|lb))?\b/i,
];
const MONEY_RE = /\$\s*(\d+(?:\.\d{1,2})?)/g;
/** A line that is nothing but a price, as clipboard tables often produce. */
const BARE_MONEY_RE = /^(?:USD\s*)?(\d{1,3}\.\d{2})$/;
const TIER_LINE_RE =
  /(small standard|large standard|small bulky|large bulky|extra[- ]?large|.*oversize)/i;
const HAZMAT_RE = /(dangerous goods|hazmat|hazardous)/i;
/** Section headings on Amazon's fee page, e.g. "FBA fulfillment fees for apparel". */
const SECTION_RE = /fulfill?ment fees/i;
const NONPEAK_RE = /non-?peak/i;
const PEAK_RE = /peak/i;
/** "for apparel" — but NOT "excluding apparel", which is the general table. */
const APPAREL_RE = /(?<!excluding )apparel/i;

/** What kind of table we're reading; the page stacks six of them. */
interface Section {
  label: string;
  hazmat: boolean;
  apparel: boolean;
  peak: boolean;
  /**
   * Inside a Ships in Product Packaging table: "discount" for certified units,
   * "packaging" for the extra fee on bulky units that aren't certified. These
   * figures are adjustments to the fee, not fees - they must never land in the
   * regular table, where a $0.11 row would read as an $0.11 fulfilment fee.
   */
  sipp: "discount" | "packaging" | null;
}

/** "Ships in Product Packaging (SIPP) discounts" - a heading, not the prose paragraph. */
const SIPP_RE = /ships in product packaging|\bSIPP\b/i;
/** The fee on NON-certified bulky units, as opposed to the certified discount. */
const NON_SIPP_RE = /\b(?:not|non)[- ]?(?:enrolled|certified|sipp)\b|packaging fee/i;

/** Every size tier a line names, in order, e.g. "Small Bulky and Large Bulky". */
function tiersNamedOn(line: string): string[] {
  const found = line.match(/small standard|large standard|small bulky|large bulky|extra[- ]?large/gi) ?? [];
  const out: string[] = [];
  for (const f of found) {
    const n = normaliseTier(f);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

function sippKindOf(line: string): Section["sipp"] {
  if (!SIPP_RE.test(line) && !/packaging fee/i.test(line)) return null;
  return NON_SIPP_RE.test(line) ? "packaging" : "discount";
}

/** Per-section tally, so nothing is dropped without the user being told. */
export interface SectionCoverage {
  label: string;
  kind: string;
  /** New rows created from this section. */
  taken: number;
  /** Peak rates merged onto rows already created from the non-peak table. */
  merged: number;
  /** Rate-looking rows this section contributed nothing from. */
  skipped: number;
}
const SURCHARGE_RE = /(\d+(?:\.\d+)?)\s*%\s*(?:fuel|fuel and (?:inflation|logistics))/i;
/** How far past a weight band to look for its price in a cell-per-line paste. */
const LOOKAHEAD_LINES = 4;
/** Column labels for Amazon's selling-price bands, e.g. "<$10  $10-$50  >$50". */
const PRICE_BAND_RE = /(<\s*\$10|\$10\s*-\s*\$50|>\s*\$50)/g;

type Band = "low" | "mid" | "high";

/**
 * Bulky and extra-large rates aren't flat — Amazon states them as
 *   "$8.84 + $0.38/lb interval above first lb"
 * one such formula per price-band column. Parsed into a base plus a per-pound
 * surcharge so those tiers are covered by the published card too, instead of
 * falling back to hardcoded arithmetic that can go stale unnoticed.
 */
const FORMULA_CELL_RE =
  /\$(\d+(?:\.\d{1,2})?)\s*\+\s*\$(\d+(?:\.\d{1,2})?)\s*(?:\/|\s+per\s+)\s*(half-?lb|\d+(?:\.\d+)?\s*(?:oz|lb)|lb|oz)\s*(?:interval)?\s*above\s+(?:the\s+)?(?:first\s+)?(\d+(?:\.\d+)?)?\s*(oz|lb)?/i;

interface FormulaCell {
  base: number;
  /** Charged once per whole `intervalLb` above `aboveLb`. */
  perInterval: number;
  intervalLb: number;
  aboveLb: number;
}

/**
 * "$0.38/lb interval above first lb" is only one of the shapes Amazon uses.
 * Large standard is stated per 4 oz (and, on the dangerous-goods table, per
 * half-lb), so the interval size has to be read rather than assumed to be a
 * pound — assuming a pound understates the fee by 4x on those rows.
 */
function intervalToLb(spec: string): number {
  const t = spec.toLowerCase().replace(/\s+/g, "");
  if (/^half-?lb$/.test(t)) return 0.5;
  const m = t.match(/^(\d+(?:\.\d+)?)?(oz|lb)$/);
  if (!m) return 1;
  const n = m[1] ? parseFloat(m[1]) : 1;
  return m[2] === "oz" ? n / 16 : n;
}

function parseFormulaCells(line: string): FormulaCell[] {
  // Cells arrive tab-separated; tabs are normalised to a double space upstream.
  return line
    .split(/\s{2,}/)
    .map((cell) => cell.trim().match(FORMULA_CELL_RE))
    .filter((m): m is RegExpMatchArray => m != null)
    .map((m) => {
      // "above first lb" states no number; the threshold is one unit.
      const n = m[4] ? parseFloat(m[4]) : 1;
      const aboveLb = (m[5] || "lb").toLowerCase() === "oz" ? n / 16 : n;
      return {
        base: parseFloat(m[1]),
        perInterval: parseFloat(m[2]),
        intervalLb: intervalToLb(m[3]),
        aboveLb,
      };
    });
}

/**
 * Read a column header like
 *   Size tier | Shipping weight | <$10 | $10-$50 | >$50 | <$10 | $10-$50 | >$50
 * into the band each money column carries. Amazon repeats the three bands once
 * per effective period (old rates, then new), so the LAST group is the one in
 * force — reading column 0 would silently audit against last year's rates.
 */
function parseBandHeader(line: string): Band[] | null {
  const found = [...line.matchAll(PRICE_BAND_RE)].map((m) => {
    const t = m[1].replace(/\s+/g, "");
    return t.startsWith("<") ? "low" : t.startsWith(">") ? "high" : "mid";
  }) as Band[];
  return found.length >= 2 ? found : null;
}

function matchWeight(line: string): string | null {
  for (const re of WEIGHT_PATTERNS) {
    const m = line.match(re);
    if (m) return m[0];
  }
  return null;
}

/**
 * Normalise a weight band to the exact spelling the built-in table uses
 * ("4+ to 8 oz", "4 oz or less"), so parsed rows line up with it both for the
 * diff and for fee lookup. Without this, "4 to 8 oz" and "4+ to 8 oz" would be
 * treated as different bands and every row would look like an addition.
 */
function canonicalWeight(raw: string): string | null {
  const s = raw.toLowerCase().replace(/\s+/g, " ").trim();

  const orLess = s.match(/(\d+(?:\.\d+)?)\s*(oz|lb)\s+or\s+less/);
  if (orLess) return `${+orLess[1]} ${orLess[2]} or less`;

  const upTo = s.match(/(?:up to|≤|<=)\s*(\d+(?:\.\d+)?)\s*(oz|lb)/);
  if (upTo) return `${+upTo[1]} ${upTo[2]} or less`;

  const range = s.match(
    /(\d+(?:\.\d+)?)\s*\+?\s*(oz|lb)?\s*\+?\s*(?:to|through|thru|–|—|-)\s*(\d+(?:\.\d+)?)\s*(oz|lb)/,
  );
  if (range) {
    const unit = range[4] || range[2];
    return `${+range[1]}+ to ${+range[3]} ${unit}`;
  }

  // Open-ended top band, spelled "150+ lb" so it reads like the "N+ to M unit"
  // of every other band and the fee lookup can take the lower bound the same
  // way. Tested after `range` so "50+ to 70 lb" can never land here.
  const openEnded = s.match(
    /(?:(?:over|above)\s+)?(\d+(?:\.\d+)?)\s*(?:\+\s*(oz|lb)|\s*(oz|lb)\s+(?:and|or)\s+(?:over|above|greater))/,
  );
  if (openEnded) return `${+openEnded[1]}+ ${openEnded[2] || openEnded[3]}`;

  const orMore = s.match(/(\d+(?:\.\d+)?)\s*(oz|lb)?\s+or\s+more(?:\s+(oz|lb))?/);
  if (orMore && (orMore[2] || orMore[3])) return `${+orMore[1]}+ ${orMore[2] || orMore[3]}`;

  return null;
}

function moneyOn(line: string): number[] {
  return [...line.matchAll(MONEY_RE)].map((m) => parseFloat(m[1]));
}

function stripHtml(input: string): string {
  if (!/<[a-z!/]/i.test(input)) return input;
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    // Source newlines inside a <tr> would otherwise split one table row across
    // several lines, separating the weight band from its fee. In HTML only the
    // tags define row boundaries, so flatten existing whitespace first.
    .replace(/\s+/g, " ")
    // keep table structure as line/cell breaks so rows stay on one line
    .replace(/<\/(tr|table|div|p|h\d|li)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, "\t")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

/**
 * Did a fetch land on an Amazon sign-in / consent wall rather than the page we
 * asked for?
 *
 * Amazon serves these with HTTP 200, so `res.ok` says nothing — without this
 * check the login page reaches the parser and the user is told their fee table
 * has no fee rows in it, which is true but useless.
 *
 * Detection leans on language-independent markers (the redirect path and the
 * sign-in form's field names) because the wall is served in the locale of
 * whoever is fetching, which need not be English.
 */
export function looksLikeAuthWall(html: string, finalUrl?: string): boolean {
  if (finalUrl && /\/ap\/(signin|mfa|cvf|forgotpassword)|\/gp\/sign-in/i.test(finalUrl)) {
    return true;
  }
  // Sign-in form fields — identical in every locale.
  if (/name=["']?(ap_email|ap_password|signInSubmit)\b/i.test(html)) return true;
  if (/id=["']?(ap_signin_form|authportal-main-section)\b/i.test(html)) return true;
  // Cookie/consent interstitials, which also block the real page.
  if (/Enable Cookies to continue|请激活Cookies以继续/i.test(html)) return true;
  return false;
}

/** Why a parse produced what it did — surfaced when it finds nothing. */
export interface ParseDiagnostics {
  lines: number;
  /** Lines that looked like a weight band. */
  weightRows: number;
  /** Lines carrying a dollar amount. */
  moneyLines: number;
  tiersSeen: string[];
  /** Head of the input, so a failure can be diagnosed from the message alone. */
  sample: string[];
  /** Every fee table found, and what was taken from each. */
  coverage: SectionCoverage[];
}

export interface ParsedRateCard {
  fuelSurchargeRate: number | null;
  rows: RateCardRow[];
  /** Rows read from a Ships in Product Packaging discount table. */
  sipp: RateCardRow[];
  /** Rows read from the packaging-fee table for bulky units NOT in SIPP. */
  nonSippPackaging: RateCardRow[];
  unparsedSample: string[];
  diagnostics: ParseDiagnostics;
}

/**
 * Parse a published rate card.
 *
 * Tolerant by design — accepts raw HTML, a clipboard paste of the rendered
 * table, or tab-separated text. Tier is tracked as a heading and carried down
 * the rows beneath it, since Amazon's tables name the tier once per section;
 * a row that names its own tier overrides that.
 *
 * Copying a rendered table often yields ONE CELL PER LINE, so a band and its
 * price arrive on different lines. When a weight row carries no price we look
 * ahead a few lines for one, stopping at the next band so a priceless row can
 * never borrow the next row's figures.
 *
 * The first money value on a row is the non-peak fee. A second, larger value
 * is taken as the peak (holiday) fee; pages that omit it get peak = nonPeak.
 */
export function parseRateCard(input: string): ParsedRateCard {
  const text = stripHtml(input);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\t/g, "  ").trim())
    .filter((l) => l.length > 0);

  let currentTier: string | null = null;
  /**
   * When one row names several tiers ("Small Bulky and Large Bulky"), every
   * band beneath it applies to all of them until a row names a single tier.
   */
  let currentTiers: string[] | null = null;
  /**
   * Which money column to read when a table has columns other than price bands.
   * The SIPP discount table is "non-apparel | apparel": reading the first by
   * default is right only by accident of column order, so it's chosen by name.
   */
  let valueColumn = 0;
  let bandColumns: Band[] | null = null;
  let hazmatSection = false;
  // Amazon's page stacks six tables: non-peak / peak, each for general,
  // apparel and dangerous goods. Track which one we're inside so peak rates
  // land on the right row and apparel rates don't overwrite general ones.
  let section: Section = {
    label: "(before any heading)",
    hazmat: false,
    apparel: false,
    peak: false,
    sipp: null,
  };
  const coverage: SectionCoverage[] = [];
  const covFor = (sec: Section): SectionCoverage => {
    let c = coverage.find((x) => x.label === sec.label);
    if (!c) {
      c = {
        label: sec.label,
        kind:
          (sec.sipp === "discount"
            ? "SIPP discount"
            : sec.sipp === "packaging"
              ? "non-SIPP packaging fee"
              : sec.apparel
                ? "apparel"
                : sec.hazmat
                  ? "dangerous goods"
                  : "general") + (sec.peak ? ", peak" : ", non-peak"),
        taken: 0,
        merged: 0,
        skipped: 0,
      };
      coverage.push(c);
    }
    return c;
  };
  const byKey = new Map<string, RateCardRow>();
  let fuelSurchargeRate: number | null = null;
  const rows: RateCardRow[] = [];
  const sippRows: RateCardRow[] = [];
  const packagingRows: RateCardRow[] = [];
  const unparsed: string[] = [];
  const tiersSeen = new Set<string>();
  let weightRows = 0;
  let moneyLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (moneyOn(line).length > 0 || BARE_MONEY_RE.test(line)) moneyLines++;

    const sur = line.match(SURCHARGE_RE);
    if (sur && fuelSurchargeRate == null) {
      const pct = parseFloat(sur[1]);
      if (pct > 0 && pct < 50) fuelSurchargeRate = pct / 100;
    }

    const hdr = parseBandHeader(line);
    if (hdr && !matchWeight(line)) {
      bandColumns = hdr;
      valueColumn = 0;
      continue;
    }

    // A column header ("Size tier | Shipping weight | SIPP discount for
    // non-apparel | SIPP discount for apparel"). It names the columns, not a
    // section - read as a heading, the word "apparel" in it opened an apparel
    // section and every SIPP discount row below was skipped as apparel.
    if (/\bsize tier\b/i.test(line) && moneyOn(line).length === 0 && !matchWeight(line)) {
      const cells = line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
      const valueCells = cells.filter((c) => !/size tier|weight/i.test(c));
      const nonApparel = valueCells.findIndex((c) => /non-?apparel/i.test(c));
      valueColumn = nonApparel >= 0 ? nonApparel : 0;
      // A plain column header resets any price-band layout from a previous table.
      if (!parseBandHeader(line)) bandColumns = null;
      continue;
    }

    const w = matchWeight(line);
    if (!w) {
      // A heading line: pick up tier and whether we're in a hazmat table.
      const t = line.match(TIER_LINE_RE);
      if (t) {
        const n = normaliseTier(t[0]);
        if (n && line.length < 120) {
          currentTier = n;
          tiersSeen.add(n);
        }
      }
      // Hazmat is a property of the SECTION, and the only reliable markers are
      // the "... fulfillment fees ..." headings. Keying off any line mentioning
      // dangerous goods would latch onto the table-of-contents entry near the
      // top and mark the whole page hazmat.
      // A heading, not a sentence about the fees. Prose like "Effective
      // January 15, 2026, fulfillment fees will revert to non-peak." matches
      // the same words and would open a phantom section that then collects
      // every nearby prose line as skipped rows.
      const isHeading = line.length < 160 && !/[.:]\s*$/.test(line);
      if (isHeading && (SECTION_RE.test(line) || sippKindOf(line) !== null)) {
        // The SIPP page's own headings needn't say "fulfillment fees", so a
        // SIPP heading opens a section on its own. Any heading replaces the
        // section wholesale, which is what closes a SIPP table again.
        hazmatSection = HAZMAT_RE.test(line);
        section = {
          label: line.slice(0, 70),
          hazmat: hazmatSection,
          apparel: APPAREL_RE.test(line),
          // "Non-Peak" contains "peak", so the negative has to be tested first.
          peak: !NONPEAK_RE.test(line) && PEAK_RE.test(line),
          sipp: sippKindOf(line),
        };
      } else if (HAZMAT_RE.test(line) && line.length < 120) {
        // A hazmat table headed something like "Dangerous goods — Large
        // standard-size" never says "fulfillment fees". Entering a hazmat
        // section on any short heading that mentions it is safe because only
        // a section heading can turn it back off, so a contents entry near the
        // top is undone by the first real section heading below it.
        hazmatSection = true;
      }
      // A line that names a tier AND carries prices is a rate row, not a
      // heading — we simply failed to read its weight band. Falling through
      // to `continue` is how the open-ended "150+ lb" row disappeared without
      // showing up anywhere in the diagnostics. Record it, so the next
      // wording Amazon invents is reported instead of silently lost.
      if (t && moneyOn(line).length > 0) {
        unparsed.push(line);
        covFor(section).skipped++;
      }
      continue;
    }
    weightRows++;

    // Amazon names the tier on the FIRST data row of each section, not on a
    // heading of its own, and leaves it off every row after. So an inline tier
    // must become the running tier — otherwise only the first row of each
    // section parses and the rest are dropped for having no tier at all.
    const inline = line.match(TIER_LINE_RE);
    const inlineTier = inline ? normaliseTier(inline[0]) : null;
    if (inlineTier) {
      currentTier = inlineTier;
      tiersSeen.add(inlineTier);
      const named = tiersNamedOn(line);
      currentTiers = named.length > 1 ? named : null;
      for (const n of named) tiersSeen.add(n);
    }
    const tier = inlineTier || currentTier;
    const weightRange = canonicalWeight(w);
    if (!tier || !weightRange) {
      unparsed.push(line);
      continue;
    }

    const money = moneyOn(line);
    // Look ahead ONLY for a genuine cell-per-line paste, where the line is
    // nothing but the weight band. Prose such as "Shipping weight range: 1.5+
    // to 1.75 lb" in the page's size-examples section would otherwise reach
    // forward and collect an unrelated "$10" as if it were a fee.
    const isBareBand = line.replace(w, "").replace(/[\s:|,.–-]/g, "").length === 0;
    if (money.length === 0 && isBareBand && !bandColumns) {
      for (let j = i + 1; j < Math.min(lines.length, i + 1 + LOOKAHEAD_LINES); j++) {
        if (matchWeight(lines[j])) break;
        const found = moneyOn(lines[j]);
        if (found.length > 0) {
          money.push(...found);
        } else {
          const bare = lines[j].match(BARE_MONEY_RE);
          if (bare) money.push(parseFloat(bare[1]));
        }
        if (money.length >= 2) break;
      }
    }
    if (money.length === 0) {
      unparsed.push(line);
      continue;
    }
    // A banded table is strictly rectangular. A row whose money count doesn't
    // match the columns is either prose, or a bulky/extra-large row stating
    // "$8.84 + $0.38/lb interval above first lb" per column — two figures per
    // cell. Try the formula shape before rejecting it.
    let formula: FormulaCell[] | null = null;
    if (bandColumns && money.length !== bandColumns.length) {
      const cells = parseFormulaCells(line);
      if (cells.length === bandColumns.length) {
        formula = cells;
      } else {
        unparsed.push(line);
        covFor(section).skipped++;
        continue;
      }
    }

    const hazmat = hazmatSection || HAZMAT_RE.test(line);
    const cov = covFor(section);
    // Apparel rates are a separate schedule for a different kind of product.
    // Merging them into the general table would silently mis-rate everything,
    // so they're skipped — and counted, so the UI can say they were.
    if (section.apparel) {
      cov.skipped++;
      continue;
    }
    // With a band header, columns mean specific price bands; take the LAST
    // occurrence of each so the current period wins over the superseded one.
    // For a formula row the per-column figure is the cell's BASE; the per-lb
    // surcharge is identical across columns, so it is read once.
    const values = formula ? formula.map((f) => f.base) : money;
    // Without price bands, read the named column (non-apparel on the SIPP page)
    // rather than whichever figure happens to come first.
    let mid = !bandColumns && valueColumn < values.length ? values[valueColumn] : values[0];
    let low: number | null = null;
    let high: number | null = null;
    if (bandColumns && bandColumns.length === values.length) {
      const lastOf = (b: Band) => {
        const i = bandColumns!.lastIndexOf(b);
        return i >= 0 ? values[i] : null;
      };
      low = lastOf("low");
      high = lastOf("high");
      mid = lastOf("mid") ?? values[0];
    }
    const midIdx = bandColumns ? bandColumns.lastIndexOf("mid") : -1;
    const surcharge = formula ? formula[midIdx >= 0 ? midIdx : 0] : null;

    // One row per tier the line applies to - usually one; "Small Bulky and
    // Large Bulky" is two.
    for (const rowTier of currentTiers ?? [tier]) {
      // SIPP adjustments share tier/band keys with the fee rows, so they need a
      // namespace of their own or a $0.11 discount would collide with - and be
      // skipped as a repeat of - the regular rate for the same band.
      const key = `${section.sipp ?? "fee"}|${rowTier}|${weightRange}|${hazmat}`;
      const target =
        section.sipp === "discount" ? sippRows : section.sipp === "packaging" ? packagingRows : rows;

      // Peak rates come from their own table further down the page. Merge them
      // onto the row the non-peak table already created rather than discarding
      // them as a duplicate — otherwise `peak` is just a copy of `nonPeak`.
      const existing = byKey.get(key);
      if (section.peak) {
        if (existing) {
          existing.peak = mid;
          if (low != null) existing.peakLow = low;
          if (high != null) existing.peakHigh = high;
          cov.merged++;
        } else {
          cov.skipped++;
        }
        continue;
      }
      if (existing) {
        cov.skipped++; // a repeat of a band we already have from an earlier table
        continue;
      }

      const row: RateCardRow = {
        tier: rowTier,
        weightRange,
        nonPeak: mid,
        // Real peak rates arrive from the peak table below; until then the
        // non-peak rate stands in.
        // A table whose extra columns aren't price bands (SIPP's apparel column)
        // carries no peak rate, so the value read stands for both.
        peak: bandColumns || section.sipp ? mid : values.length > 1 ? Math.max(...values) : values[0],
        weightBasis:
          // Amazon sizes the packaging fee by dimensional weight alone - the box
          // it has to wrap - not by the shipping weight fees normally use.
          section.sipp === "packaging"
            ? "Dimensional weight"
            : rowTier === "small standard"
              ? "Unit weight"
              : "Greater of unit or dimensional weight",
        hazmat,
        ...(low != null ? { lowPrice: low } : {}),
        ...(high != null ? { highPrice: high } : {}),
        ...(surcharge
          ? {
              surchargePerInterval: surcharge.perInterval,
              surchargeIntervalLb: surcharge.intervalLb,
              surchargeAboveLb: surcharge.aboveLb,
            }
          : {}),
      };
      byKey.set(key, row);
      target.push(row);
      cov.taken++;
    }
  }

  return {
    fuelSurchargeRate,
    rows,
    sipp: sippRows,
    nonSippPackaging: packagingRows,
    unparsedSample: unparsed.slice(0, 12),
    diagnostics: {
      lines: lines.length,
      weightRows,
      moneyLines,
      tiersSeen: [...tiersSeen],
      sample: lines.slice(0, 15).map((l) => (l.length > 90 ? l.slice(0, 90) + "…" : l)),
      coverage,
    },
  };
}

// ── comparison ─────────────────────────────────────────────────────────────

export interface RateCardDiff {
  tier: string;
  weightRange: string;
  hazmat: boolean;
  /** What the built-in table in @platform/calc holds. */
  builtIn: number | null;
  /** What the published card says. */
  published: number;
  delta: number | null;
}

/** Can this card be re-parsed, and by which route? */
export function reparseSource(c: RateCard | null): "url" | "raw" | null {
  if (!c) return null;
  if (/^https?:\/\//i.test(c.source)) return "url";
  if (c.raw && c.raw.length > 0) return "raw";
  return null;
}

/**
 * Compare two sets of parsed rows. Used both against the built-in table and
 * against the previously stored card, so a reparse can report what actually
 * moved rather than just claiming success.
 */
export function diffRows(
  next: ReadonlyArray<{ tier: string; weightRange: string; hazmat: boolean; nonPeak: number }>,
  prev: ReadonlyArray<{ tier: string; weightRange: string; hazmat: boolean; nonPeak: number }>,
): { added: number; removed: number; changed: RateCardDiff[] } {
  const key = (r: { tier: string; weightRange: string; hazmat: boolean }) =>
    `${r.tier}|${r.weightRange}|${r.hazmat}`;
  const prevIdx = new Map(prev.map((r) => [key(r), r.nonPeak]));
  const nextKeys = new Set(next.map(key));

  const changed: RateCardDiff[] = [];
  let added = 0;
  for (const r of next) {
    const before = prevIdx.get(key(r));
    if (before == null) {
      added++;
      continue;
    }
    if (Math.abs(before - r.nonPeak) > 0.005) {
      changed.push({
        tier: r.tier,
        weightRange: r.weightRange,
        hazmat: r.hazmat,
        builtIn: before,
        published: r.nonPeak,
        delta: +(r.nonPeak - before).toFixed(4),
      });
    }
  }
  const removed = prev.filter((r) => !nextKeys.has(key(r))).length;
  changed.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));
  return { added, removed, changed };
}

/**
 * Compare a parsed card against the built-in table. Rows the built-in table
 * doesn't have come back with builtIn = null — those are additions, not drift.
 */
export function diffRateCard(
  parsed: RateCardRow[],
  builtIn: ReadonlyArray<{ tier: string; weightRange: string; nonPeak: number }>,
  builtInHazmat: ReadonlyArray<{ tier: string; weightRange: string; nonPeak: number }>,
): RateCardDiff[] {
  const idx = new Map<string, number>();
  for (const r of builtIn) idx.set(`${r.tier}|${r.weightRange}|false`, r.nonPeak);
  for (const r of builtInHazmat) idx.set(`${r.tier}|${r.weightRange}|true`, r.nonPeak);

  const out: RateCardDiff[] = [];
  for (const r of parsed) {
    const b = idx.get(`${r.tier}|${r.weightRange}|${r.hazmat}`) ?? null;
    out.push({
      tier: r.tier,
      weightRange: r.weightRange,
      hazmat: r.hazmat,
      builtIn: b,
      published: r.nonPeak,
      delta: b == null ? null : +(r.nonPeak - b).toFixed(4),
    });
  }
  // Biggest disagreements first — that's what the user needs to look at.
  out.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));
  return out;
}

// ── store ──────────────────────────────────────────────────────────────────

export function getRateCard(): RateCard | null {
  try {
    if (!fs.existsSync(FILE)) return null;
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as RateCard;
  } catch {
    return null;
  }
}

export function storeRateCard(c: RateCard) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(c), "utf8");
}

export function clearRateCard() {
  try {
    if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
  } catch {
    /* ignore */
  }
}

/** Result of turning published SIPP rows into per-unit discounts. */
export interface ResolvedSipp {
  /** Discount per unit, by band - always a positive amount to subtract. */
  discounts: RateCardRow[];
  /** How many rows stated the lowered fee rather than the discount. */
  fromLoweredFee: number;
  /** Rows that stated a fee with no regular row to subtract it from. */
  unresolved: string[];
}

/**
 * The SIPP page may state the discount ("$0.11") or the lowered fee ("$5.46").
 * A discount is cents; a fulfilment fee is dollars, so any value at least half
 * the regular rate for the same band is a lowered fee, and the discount is the
 * difference. The two are an order of magnitude apart, so the test can't be
 * fooled by an ordinary rate change.
 *
 * A lowered fee with no regular row to compare against can't be turned into a
 * discount honestly, so it is reported rather than guessed at.
 */
export function resolveSippDiscounts(
  sipp: ReadonlyArray<RateCardRow>,
  regular: ReadonlyArray<RateCardRow>,
): ResolvedSipp {
  const idx = new Map(regular.map((r) => [`${r.tier}|${r.weightRange}|${r.hazmat}`, r]));
  const discounts: RateCardRow[] = [];
  const unresolved: string[] = [];
  let fromLoweredFee = 0;

  for (const s of sipp) {
    const base = idx.get(`${s.tier}|${s.weightRange}|${s.hazmat}`);
    const isLoweredFee = base ? s.nonPeak >= base.nonPeak * 0.5 : s.nonPeak >= 1.5;
    if (!isLoweredFee) {
      discounts.push(s);
      continue;
    }
    if (!base) {
      unresolved.push(`${s.tier} ${s.weightRange}${s.hazmat ? " (hazmat)" : ""}`);
      continue;
    }
    fromLoweredFee++;
    const less = (fee: number | null | undefined, lowered: number | null | undefined) =>
      fee != null && lowered != null ? +Math.max(0, fee - lowered).toFixed(4) : null;
    discounts.push({
      ...s,
      nonPeak: less(base.nonPeak, s.nonPeak) ?? 0,
      peak: less(base.peak, s.peak) ?? less(base.nonPeak, s.nonPeak) ?? 0,
      lowPrice: less(base.lowPrice, s.lowPrice),
      highPrice: less(base.highPrice, s.highPrice),
      peakLow: less(base.peakLow, s.peakLow),
      peakHigh: less(base.peakHigh, s.peakHigh),
      // A lowered-fee row repeats the base's per-interval surcharge; the
      // discount is on the base, so the surcharge must not be subtracted too.
      surchargePerInterval: null,
      surchargeIntervalLb: null,
      surchargeAboveLb: null,
    });
  }
  return { discounts, fromLoweredFee, unresolved };
}

/**
 * The rows the audit should use, split the way @platform/calc expects.
 * Returns null when no card has been entered, so callers fall back to the
 * built-in table rather than silently auditing against nothing.
 */
export function rateCardOverride(): {
  regular: RateCardRow[];
  hazmat: RateCardRow[];
  /** Per-unit SIPP discounts, resolved against the current regular rows. */
  sipp: RateCardRow[];
  nonSippPackaging: RateCardRow[];
  sippUnresolved: string[];
  fuelSurchargeRate: number | null;
  source: string;
  savedAt: string;
} | null {
  const c = getRateCard();
  if (!c || c.rows.length === 0) return null;
  const resolved = resolveSippDiscounts(c.sipp ?? [], c.rows);
  return {
    regular: c.rows.filter((r) => !r.hazmat),
    hazmat: c.rows.filter((r) => r.hazmat),
    sipp: resolved.discounts,
    nonSippPackaging: c.nonSippPackaging ?? [],
    sippUnresolved: resolved.unresolved,
    fuelSurchargeRate: c.fuelSurchargeRate,
    source: c.source,
    savedAt: c.savedAt,
  };
}
