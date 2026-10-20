import { describe, it, expect } from "vitest";
import {
  parseRateCard,
  diffRateCard,
  diffRows,
  reparseSource,
  looksLikeAuthWall,
  rateForPrice,
  resolveSippDiscounts,
} from "./rateCard";

// Shaped like Amazon's published US fulfilment table: tier as a section
// heading, weight bands beneath it, non-peak and peak columns.
const PASTED = `
2026 US FBA fulfillment fees

A 3.5% Fuel and Logistics-related surcharge is applied to the base per-unit fee.

Small standard-size
2 oz or less	$2.43	$3.25
2+ to 4 oz	$2.49	$3.34
4+ to 6 oz	$2.56	$3.44

Large standard-size
4 oz or less	$3.31	$4.42
4+ to 8 oz	$3.95	$5.33
8+ to 12 oz	$4.28	$5.70
12+ to 16 oz	$4.52	$5.95
1+ to 1.25 lb	$5.02	$6.48

Dangerous goods (hazmat) — Large standard-size
4 oz or less	$4.20	$5.60
4+ to 8 oz	$4.55	$5.98
`;

describe("parseRateCard", () => {
  it("reads tier headings, weight bands and both fee columns", () => {
    const r = parseRateCard(PASTED);
    const ls = r.rows.filter((x) => x.tier === "large standard" && !x.hazmat);
    expect(ls).toHaveLength(5);

    // The band SPBATH0034 actually ships in.
    const band = ls.find((x) => x.weightRange === "4+ to 8 oz");
    expect(band?.nonPeak).toBe(3.95);
    expect(band?.peak).toBe(5.33);
    expect(band?.weightBasis).toBe("Greater of unit or dimensional weight");
  });

  it("keeps the hazmat table separate from the regular one", () => {
    const r = parseRateCard(PASTED);
    const haz = r.rows.filter((x) => x.hazmat);
    expect(haz).toHaveLength(2);
    expect(haz.find((x) => x.weightRange === "4+ to 8 oz")?.nonPeak).toBe(4.55);
    // and the regular row for the same band is untouched
    expect(
      r.rows.find((x) => !x.hazmat && x.weightRange === "4+ to 8 oz")?.nonPeak,
    ).toBe(3.95);
  });

  it("uses unit weight as the basis for small standard", () => {
    const r = parseRateCard(PASTED);
    const s = r.rows.find((x) => x.tier === "small standard");
    expect(s?.weightBasis).toBe("Unit weight");
  });

  it("picks up the fuel surcharge rate stated on the page", () => {
    expect(parseRateCard(PASTED).fuelSurchargeRate).toBeCloseTo(0.035, 5);
  });

  it("parses raw HTML tables, not just clipboard text", () => {
    const html = `<h3>Large standard-size</h3><table><tr><td>4+ to 8 oz</td>
      <td>$3.95</td><td>$5.33</td></tr></table>`;
    const r = parseRateCard(html);
    expect(r.rows[0]).toMatchObject({
      tier: "large standard",
      weightRange: "4+ to 8 oz",
      nonPeak: 3.95,
    });
  });

  it("returns no rows rather than guessing when the input has no fee table", () => {
    expect(parseRateCard("just some prose about returns").rows).toHaveLength(0);
  });
});

describe("diffRateCard", () => {
  it("surfaces the stale built-in rate that caused the false hazmat flag", () => {
    const parsed = parseRateCard(PASTED).rows;
    // What packages/calc held before this change.
    const builtIn = [
      { tier: "large standard", weightRange: "4+ to 8 oz", nonPeak: 3.13 },
    ];
    const builtInHaz = [
      { tier: "large standard", weightRange: "4+ to 8 oz", nonPeak: 3.94 },
    ];
    const d = diffRateCard(parsed, builtIn, builtInHaz);

    const reg = d.find((x) => x.weightRange === "4+ to 8 oz" && !x.hazmat);
    expect(reg?.builtIn).toBe(3.13);
    expect(reg?.published).toBe(3.95);
    expect(reg?.delta).toBeCloseTo(0.82, 2);

    // Rows the built-in table never had are additions, not drift.
    expect(d.some((x) => x.builtIn === null)).toBe(true);
    // Biggest disagreement sorts first.
    expect(Math.abs(d[0].delta ?? 0)).toBeGreaterThanOrEqual(Math.abs(d[1].delta ?? 0));
  });
});

describe("reparseSource", () => {
  const base = { savedAt: "", fuelSurchargeRate: null, rows: [], unparsedSample: [] };
  it("re-fetches when the card came from a URL", () => {
    expect(reparseSource({ ...base, source: "https://example.com/fees" })).toBe("url");
  });
  it("re-parses the kept text when the card was pasted", () => {
    expect(reparseSource({ ...base, source: "pasted", raw: "Large standard-size\n4+ to 8 oz $3.95" })).toBe("raw");
  });
  it("reports nothing to reparse for an old paste with no text kept", () => {
    expect(reparseSource({ ...base, source: "pasted" })).toBeNull();
  });
  it("handles no card at all", () => {
    expect(reparseSource(null)).toBeNull();
  });
});

describe("diffRows", () => {
  const row = (weightRange: string, nonPeak: number, hazmat = false) => ({
    tier: "large standard", weightRange, nonPeak, hazmat,
  });
  it("reports nothing moved when a reparse yields the same rates", () => {
    const rows = [row("4+ to 8 oz", 3.95), row("8+ to 12 oz", 4.28)];
    const d = diffRows(rows, rows);
    expect(d.changed).toHaveLength(0);
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
  });
  it("catches a rate Amazon changed since the card was saved", () => {
    const d = diffRows([row("4+ to 8 oz", 4.15)], [row("4+ to 8 oz", 3.95)]);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].delta).toBeCloseTo(0.2, 2);
  });
  it("counts added and dropped bands separately from changed ones", () => {
    const d = diffRows(
      [row("4+ to 8 oz", 3.95), row("1+ to 1.25 lb", 5.02)],
      [row("4+ to 8 oz", 3.95), row("8+ to 12 oz", 4.28)],
    );
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.changed).toHaveLength(0);
  });
  it("does not confuse a hazmat row with the regular row for the same band", () => {
    const d = diffRows([row("4+ to 8 oz", 4.55, true)], [row("4+ to 8 oz", 3.95, false)]);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.changed).toHaveLength(0);
  });
});

// Copying Amazon's rendered fee table usually yields one CELL per line, so the
// band and its price arrive separately. This is the shape that failed first.
const CELL_PER_LINE = `
Large standard-size
4 oz or less
$3.31
$4.42
4+ to 8 oz
$3.95
$5.33
8+ to 12 oz
$4.28
$5.70
`;

describe("parseRateCard, cell-per-line paste", () => {
  it("pairs a band with the price on the following lines", () => {
    const r = parseRateCard(CELL_PER_LINE);
    expect(r.rows).toHaveLength(3);
    const b = r.rows.find((x) => x.weightRange === "4+ to 8 oz");
    expect(b?.nonPeak).toBe(3.95);
    expect(b?.peak).toBe(5.33);
    expect(b?.tier).toBe("large standard");
  });

  it("never lets a priceless band borrow the next band's price", () => {
    const r = parseRateCard(`Large standard-size\n4 oz or less\n4+ to 8 oz\n$3.95`);
    // The first band has no price before the next band starts, so it's dropped.
    expect(r.rows.map((x) => x.weightRange)).toEqual(["4+ to 8 oz"]);
    expect(r.rows[0].nonPeak).toBe(3.95);
  });

  it("reads bare prices with no dollar sign", () => {
    const r = parseRateCard(`Large standard-size\n4+ to 8 oz\n3.95\n5.33`);
    expect(r.rows[0]?.nonPeak).toBe(3.95);
    expect(r.rows[0]?.peak).toBe(5.33);
  });
});

describe("parseRateCard, weight wording", () => {
  const cases: [string, string][] = [
    ["4 to 8 oz", "4+ to 8 oz"],
    ["4+ to 8 oz", "4+ to 8 oz"],
    ["4 oz to 8 oz", "4+ to 8 oz"],
    ["4 oz or less", "4 oz or less"],
    ["up to 4 oz", "4 oz or less"],
    ["1 to 1.25 lb", "1+ to 1.25 lb"],
    ["0 to 0.5 lb", "0+ to 0.5 lb"],
  ];
  for (const [written, canonical] of cases) {
    it(`normalises "${written}" to "${canonical}"`, () => {
      const r = parseRateCard(`Large standard-size\n${written}\t$3.95`);
      expect(r.rows[0]?.weightRange).toBe(canonical);
    });
  }

  it("normalises so a differently-worded band still matches the built-in table", () => {
    // "4 to 8 oz" must land on the same key as the table's "4+ to 8 oz",
    // otherwise every row would read as an addition rather than a rate change.
    const r = parseRateCard(`Large standard-size\n4 to 8 oz\t$3.95`);
    const d = diffRateCard(r.rows, [
      { tier: "large standard", weightRange: "4+ to 8 oz", nonPeak: 3.13 },
    ], []);
    expect(d[0].builtIn).toBe(3.13);
    expect(d[0].delta).toBeCloseTo(0.82, 2);
  });
});

describe("parse diagnostics", () => {
  it("explains a total miss instead of returning an empty list", () => {
    const r = parseRateCard("Fulfillment fees\nSee the table on the next page.");
    expect(r.rows).toHaveLength(0);
    expect(r.diagnostics.lines).toBe(2);
    expect(r.diagnostics.weightRows).toBe(0);
    expect(r.diagnostics.sample.length).toBeGreaterThan(0);
  });

  it("shows bands were found but prices were not", () => {
    const r = parseRateCard("Large standard-size\n4+ to 8 oz\n8+ to 12 oz");
    expect(r.rows).toHaveLength(0);
    expect(r.diagnostics.weightRows).toBe(2);
    expect(r.diagnostics.moneyLines).toBe(0);
    expect(r.diagnostics.tiersSeen).toContain("large standard");
  });
});

describe("looksLikeAuthWall", () => {
  it("catches a redirect to the sign-in path", () => {
    expect(looksLikeAuthWall("<html>anything</html>", "https://www.amazon.com/ap/signin?openid=x")).toBe(true);
  });

  it("catches the sign-in form regardless of page language", () => {
    // The wall is served in the fetcher's locale, so text matching alone is not
    // enough — this is the Chinese sign-in page that reached a real user.
    const zh = `<html><body><h1>亚马逊 登录</h1><form>
      <input name="ap_email"><input name="ap_password"></form></body></html>`;
    expect(looksLikeAuthWall(zh)).toBe(true);
  });

  it("catches a cookie-consent interstitial in either language", () => {
    expect(looksLikeAuthWall("<p>请激活Cookies以继续</p>")).toBe(true);
    expect(looksLikeAuthWall("<p>Enable Cookies to continue</p>")).toBe(true);
  });

  it("does not fire on a genuine fee page", () => {
    const page = `<h3>Large standard-size</h3><table><tr><td>4+ to 8 oz</td><td>$3.95</td></tr></table>`;
    expect(looksLikeAuthWall(page, "https://sellercentral.amazon.com/help/hub/reference/G201112670")).toBe(false);
  });

  it("does not fire on a page that merely mentions signing in", () => {
    const page = `<p>Sign in to Seller Central to see your fees.</p>
      <table><tr><td>4+ to 8 oz</td><td>$3.95</td></tr></table>`;
    expect(looksLikeAuthWall(page, "https://example.com/fees")).toBe(false);
  });
});

// The real shape of Amazon's 2026 fee page: a band header repeating three
// selling-price columns per effective period, the tier named only on the FIRST
// row of each section, and a size-examples section further down carrying weight
// ranges with no fees at all.
const REAL_PAGE = `
FBA fulfillment fees (excluding apparel)
FBA Non-Peak Fulfillment Fees (excluding apparel)
January 15, 2025 - October 14, 2025	January 15, 2026 - October 14, 2026
Size tier	Shipping weight	<$10	$10-$50	>$50	<$10	$10-$50	>$50
Small standard1	2 oz or less	$2.29	$3.06	$3.06	$2.43	$3.32	$3.58
2+ to 4 oz	$2.38	$3.15	$3.15	$2.49	$3.42	$3.68
Large standard	4 oz or less	$2.91	$3.68	$3.68	$2.91	$3.73	$3.99
4+ to 8 oz	$3.13	$3.90	$3.90	$3.13	$3.95	$4.21
8+ to 12 oz	$3.38	$4.15	$4.15	$3.38	$4.20	$4.46
Large bulky	0 to 50 lb	$8.84 + $0.38/lb interval above first lb	$9.61 + $0.38/lb interval
Product size examples
Shipping weight range: 1.5+ to 1.75 lb
Products priced between $10-$50 will see fulfillment fees increase.
Shipping weight range: 7+ to 8 lb
Products priced above $50 will see an increase.
`;

describe("parseRateCard, Amazon's real fee page", () => {
  const r = parseRateCard(REAL_PAGE);

  it("carries the tier down rows that don't repeat it", () => {
    // The tier is named only on "Large standard  4 oz or less". Without
    // persisting it, every following row is dropped for having no tier —
    // which is why a 40-row card first parsed as 13.
    const ls = r.rows.filter((x) => x.tier === "large standard");
    expect(ls.map((x) => x.weightRange)).toEqual([
      "4 oz or less",
      "4+ to 8 oz",
      "8+ to 12 oz",
    ]);
    expect(r.rows.filter((x) => x.tier === "small standard")).toHaveLength(2);
  });

  it("reads the CURRENT period's columns, not the superseded ones", () => {
    const b = r.rows.find((x) => x.weightRange === "4+ to 8 oz");
    // Columns are <$10, $10-$50, >$50 twice; the second group is in force.
    expect(b?.nonPeak).toBe(3.95);
    expect(b?.lowPrice).toBe(3.13);
    expect(b?.highPrice).toBe(4.21);
    // 3.90 is the superseded $10-$50 rate and must not win.
    expect(b?.nonPeak).not.toBe(3.90);
  });

  it("matches what Amazon actually bills, on both sides of the $10 line", () => {
    const b = r.rows.find((x) => x.weightRange === "4+ to 8 oz")!;
    const S = 1.035;
    // SPBATH0034 sells at $11.00 and is billed $4.09.
    expect(+(rateForPrice(b, 11.0) * S).toFixed(2)).toBe(4.09);
    // SPBATH0010 sells at $6.42 and is billed $3.24.
    expect(+(rateForPrice(b, 6.42) * S).toFixed(2)).toBe(3.24);
  });

  it("ignores weight ranges in the size-examples prose", () => {
    // "Shipping weight range: 1.5+ to 1.75 lb" has no fees; nearby prose
    // mentions $10 and $50, which must not be collected as rates.
    expect(r.rows.some((x) => x.nonPeak === 10 || x.nonPeak === 50)).toBe(false);
    expect(r.rows.some((x) => x.weightRange === "7+ to 8 lb")).toBe(false);
  });

  it("drops rows that aren't one fee per column", () => {
    // "$8.84 + $0.38/lb interval" is a formula, not a set of per-band fees.
    expect(r.rows.some((x) => x.tier === "large bulky")).toBe(false);
  });

  it("does not mark the page hazmat because of a contents entry", () => {
    const withToc = "Fulfillment fees for dangerous goods\n" + REAL_PAGE;
    expect(parseRateCard(withToc).rows.every((x) => !x.hazmat)).toBe(true);
  });
});

// Amazon stacks SIX tables: non-peak/peak x general/apparel/dangerous goods.
const SIX_TABLES = `
FBA Non-Peak Fulfillment Fees (excluding apparel)
Size tier	Shipping weight	<$10	$10-$50	>$50	<$10	$10-$50	>$50
Large standard	4+ to 8 oz	$3.13	$3.90	$3.90	$3.13	$3.95	$4.21
2026 Peak Fulfillment fees (excluding apparel)
Size tier	Shipping weight	<$10	$10-$50	>$50
Large standard	4+ to 8 oz	$3.39	$4.21	$4.47
FBA Non-Peak Fulfillment fees (for apparel)
Size tier	Shipping weight	<$10	$10-$50	>$50
Large standard	4+ to 8 oz	$3.68	$4.50	$4.76
FBA Non-Peak Fulfillment fees (for dangerous goods)
Size tier	Shipping weight	<$10	$10-$50	>$50
Large standard	4+ to 8 oz	$3.94	$4.76	$5.02
`;

describe("parseRateCard, the page's six stacked tables", () => {
  const r = parseRateCard(SIX_TABLES);
  const band = (hazmat: boolean) =>
    r.rows.find((x) => x.weightRange === "4+ to 8 oz" && x.hazmat === hazmat)!;

  it("takes general rates from the non-peak table, not peak or apparel", () => {
    expect(band(false).nonPeak).toBe(3.95);
    expect(band(false).nonPeak).not.toBe(4.21); // peak
    expect(band(false).nonPeak).not.toBe(4.5); // apparel
  });

  it("merges peak rates onto the row instead of discarding them", () => {
    // Before this, `peak` was just a copy of `nonPeak` and the real holiday
    // rates on the page were thrown away as duplicate rows.
    const b = band(false);
    expect(b.peak).toBe(4.21);
    expect(b.peakLow).toBe(3.39);
    expect(b.peakHigh).toBe(4.47);
    expect(b.peak).not.toBe(b.nonPeak);
  });

  it("keeps dangerous-goods rates as a separate hazmat row", () => {
    expect(band(true).nonPeak).toBe(4.76);
    expect(band(false).nonPeak).toBe(3.95);
  });

  it("skips apparel rather than letting it overwrite general rates", () => {
    const ap = r.diagnostics.coverage.find((c) => c.kind.startsWith("apparel"))!;
    expect(ap.taken).toBe(0);
    expect(ap.skipped).toBeGreaterThan(0);
  });

  it("accounts for every rate row it saw, so nothing is dropped silently", () => {
    const cov = r.diagnostics.coverage;
    const total = cov.reduce((n, c) => n + c.taken + c.merged + c.skipped, 0);
    expect(total).toBe(4); // one rate row per table, all four accounted for
    expect(cov.map((c) => c.kind)).toEqual([
      "general, non-peak",
      "general, peak",
      "apparel, non-peak",
      "dangerous goods, non-peak",
    ]);
  });
});

describe("parseRateCard, bulky and extra-large formula rows", () => {
  const FORMULAS = `
FBA Non-Peak Fulfillment Fees (excluding apparel)
Size tier\tShipping weight\t<$10\t$10-$50\t>$50\t<$10\t$10-$50\t>$50
Large bulky\t0 to 50 lb\t$8.84 + $0.38/lb interval above first lb\t$9.61 + $0.38/lb interval above first lb\t$9.61 + $0.38/lb interval above first lb\t$8.58 + $0.38/lb interval above first lb\t$9.35 + $0.38/lb interval above first lb\t$9.35 + $0.38/lb interval above first lb
Extra-large 50+ to 70 lb\t50+ to 70 lb\t$39.35 + $0.75/lb interval above 51 lb\t$40.12 + $0.75/lb interval above 51 lb\t$40.12 + $0.75/lb interval above 51 lb\t$36.55 + $0.75/lb interval above 51 lb\t$37.32 + $0.75/lb interval above 51 lb\t$37.32 + $0.75/lb interval above 51 lb
`;
  const r = parseRateCard(FORMULAS);

  it("captures rows Amazon states as a formula rather than dropping them", () => {
    expect(r.rows).toHaveLength(2);
    expect(r.diagnostics.coverage[0].skipped).toBe(0);
  });

  it("splits the cell into a base rate and a per-pound surcharge", () => {
    const lb = r.rows.find((x) => x.tier === "large bulky")!;
    expect(lb.nonPeak).toBe(9.35); // current period, $10-$50 column
    expect(lb.surchargePerInterval).toBe(0.38);
    expect(lb.surchargeAboveLb).toBe(1); // "above first lb"
    expect(lb.lowPrice).toBe(8.58);
  });

  it("reads a numeric threshold, not just 'first lb'", () => {
    const xl = r.rows.find((x) => x.tier === "extra-large")!;
    expect(xl.weightRange).toBe("50+ to 70 lb");
    expect(xl.surchargePerInterval).toBe(0.75);
    expect(xl.surchargeAboveLb).toBe(51);
  });

  it("reads the interval size, which is not always a pound", () => {
    // Large standard is stated per 4 oz and, on the hazmat table, per half-lb.
    // Assuming a pound here understates the fee fourfold.
    const PER_4OZ = `
FBA Non-Peak Fulfillment Fees (excluding apparel)
Size tier	Shipping weight	<$10	$10-$50	>$50
Large standard	3+ lb to 20 lb	$6.15 + $0.08 per 4 oz interval above first 3 lb	$6.97 + $0.08 per 4 oz interval above first 3 lb	$7.23 + $0.08 per 4 oz interval above first 3 lb
`;
    const row = parseRateCard(PER_4OZ).rows[0];
    expect(row.weightRange).toBe("3+ to 20 lb");
    expect(row.nonPeak).toBe(6.97);
    expect(row.surchargePerInterval).toBe(0.08);
    expect(row.surchargeIntervalLb).toBe(0.25);
    expect(row.surchargeAboveLb).toBe(3);
  });

  it("reads a half-lb interval, with or without the word 'interval'", () => {
    const HALF = `
FBA Non-Peak Fulfillment Fees (excluding apparel)
Size tier	Shipping weight	<$10	$10-$50	>$50
Large standard	3+ lb to 20 lb	$6.15 + $0.16/half-lb interval above first 3 lb	$6.97 + $0.16/half-lb above first 3 lb	$7.23 + $0.16/half-lb above first 3 lb
`;
    const row = parseRateCard(HALF).rows[0];
    expect(row.surchargeIntervalLb).toBe(0.5);
    expect(row.surchargePerInterval).toBe(0.16);
  });

  it("captures the open-ended top band instead of reading it as a heading", () => {
    // "150+ lb" has no upper bound. It used to parse as no weight band at all,
    // which the loop treated as a heading — losing a real rate row silently.
    const OPEN = `
FBA Non-Peak Fulfillment Fees (excluding apparel)
Size tier	Shipping weight	<$10	$10-$50	>$50
Extra-large 150+ lb	150+ lb	$194.18 + $0.19/lb interval above 151 lb	$194.95 + $0.19/lb interval above 151 lb	$195.72 + $0.19/lb interval above 151 lb
`;
    const r2 = parseRateCard(OPEN);
    expect(r2.rows).toHaveLength(1);
    expect(r2.rows[0].weightRange).toBe("150+ lb");
    expect(r2.rows[0].surchargeAboveLb).toBe(151);
    expect(r2.diagnostics.coverage[0].skipped).toBe(0);
  });

  it("does not mistake the lower bound of a closed range for an open band", () => {
    // "3+ lb to 20 lb" must not be read as "3+ lb".
    const OPEN = `
FBA Non-Peak Fulfillment Fees (excluding apparel)
Size tier	Shipping weight	<$10	$10-$50	>$50
Large standard	3+ lb to 20 lb	$6.15	$6.97	$7.23
`;
    expect(parseRateCard(OPEN).rows[0].weightRange).toBe("3+ to 20 lb");
  });

  it("reports a priced tier row it cannot read, rather than dropping it", () => {
    const WEIRD = `
FBA Non-Peak Fulfillment Fees (excluding apparel)
Size tier	Shipping weight	<$10	$10-$50	>$50
Extra-large stones-and-ounces	$1.00	$2.00	$3.00
`;
    const r2 = parseRateCard(WEIRD);
    expect(r2.rows).toHaveLength(0);
    expect(r2.unparsedSample.some((l) => l.includes("stones-and-ounces"))).toBe(true);
    expect(r2.diagnostics.coverage[0].skipped).toBe(1);
  });

  it("names extra-large the way the fee engine does, so the override applies", () => {
    // "extra large" would never match the engine's "extra-large" tier and the
    // card would silently fall back to the built-in rates.
    expect(r.rows.some((x) => x.tier === "extra-large")).toBe(true);
    expect(r.rows.some((x) => x.tier === "extra large")).toBe(false);
  });
});

describe("Ships in Product Packaging tables", () => {
  const FEE_AND_SIPP = `
FBA Non-Peak Fulfillment Fees (excluding apparel)
Size tier\tShipping weight\t<$10\t$10-$50\t>$50
Large standard\t2.75+ to 3 lb\t$5.85\t$6.67\t$6.93

Ships in Product Packaging (SIPP) discounts
Size tier\tShipping weight\t<$10\t$10-$50\t>$50
Large standard\t2.75+ to 3 lb\t$0.14\t$0.14\t$0.14
`;

  it("keeps SIPP rows out of the fee table", () => {
    // A $0.14 row in the fee table would read as a $0.14 fulfilment fee.
    const r = parseRateCard(FEE_AND_SIPP);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].nonPeak).toBe(6.67);
    expect(r.sipp).toHaveLength(1);
    expect(r.sipp[0].nonPeak).toBe(0.14);
  });

  it("reads a SIPP table pasted on its own, with no fee-table heading", () => {
    const r = parseRateCard(FEE_AND_SIPP.split("\n").slice(5).join("\n"));
    expect(r.rows).toHaveLength(0);
    expect(r.sipp).toHaveLength(1);
  });

  it("sends the non-certified packaging fee to its own list", () => {
    const r = parseRateCard(`
Packaging fee for products not enrolled in SIPP
Size tier\tShipping weight\t<$10\t$10-$50\t>$50
Large bulky\t0 to 50 lb\t$2.07\t$2.07\t$2.07
`);
    expect(r.nonSippPackaging).toHaveLength(1);
    expect(r.sipp).toHaveLength(0);
  });

  it("doesn't treat the fee page's SIPP paragraph as a table heading", () => {
    const r = parseRateCard(
      "Ships in Product Packaging - Ships in Product Packaging (SIPP) is a program in which products " +
        "are shipped to the customer in their original packaging, without any additional packaging from us.\n" +
        FEE_AND_SIPP.split("\n").slice(0, 4).join("\n"),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.sipp).toHaveLength(0);
  });
});

describe("resolveSippDiscounts", () => {
  const regular = parseRateCard(`
FBA Non-Peak Fulfillment Fees (excluding apparel)
Size tier\tShipping weight\t<$10\t$10-$50\t>$50
Large standard\t2.75+ to 3 lb\t$5.85\t$6.67\t$6.93
`).rows;
  const sippRow = (low: number, mid: number, high: number) => ({
    ...regular[0],
    lowPrice: low,
    nonPeak: mid,
    highPrice: high,
    peak: mid,
  });

  it("takes a stated discount as it is", () => {
    const r = resolveSippDiscounts([sippRow(0.14, 0.14, 0.14)], regular);
    expect(r.discounts[0].nonPeak).toBe(0.14);
    expect(r.fromLoweredFee).toBe(0);
  });

  it("turns a stated lowered fee into the discount, band by band", () => {
    const r = resolveSippDiscounts([sippRow(5.71, 6.53, 6.79)], regular);
    expect(r.fromLoweredFee).toBe(1);
    expect(r.discounts[0].lowPrice).toBeCloseTo(0.14, 4);
    expect(r.discounts[0].nonPeak).toBeCloseTo(0.14, 4);
    expect(r.discounts[0].highPrice).toBeCloseTo(0.14, 4);
  });

  it("reports a lowered fee it has no regular rate to subtract from", () => {
    const r = resolveSippDiscounts([{ ...sippRow(9, 9, 9), weightRange: "3+ to 20 lb" }], regular);
    expect(r.discounts).toHaveLength(0);
    expect(r.unresolved).toEqual(["large standard 3+ to 20 lb"]);
  });
});

describe("Amazon's SIPP help page, as pasted", () => {
  // Cut from the real page, keeping the parts that broke the first parser: an
  // apparel column in the header, one row naming two tiers, and "45 or more lb".
  const PAGE = `
Standard Size Ship in Products Packaging (SIPP) discount
Starting January 15, 2026, the following discounted rates on 2026 FBA fulfillment fees will apply for SIPP-certified units.

Discount per SIPP-certified unit
Size tier\tShipping weight*\tSIPP discount for non-apparel\tSIPP discount for apparel
Small standard\t2 oz or less\t$0.04\t$0.06
2+ to 4 oz\t$0.04\t$0.06
Large standard\t4 oz or less\t$0.04\t$0.06
8+ to 12 oz\t$0.07\t$0.06
3+ to 20 lb\t$0.23\t$0.22
*Shipping weight is the greater of unit weight or dimensional weight for determining size tiers

Note: The SIPP discount for Large Bulky ($1.32/u irrespective of size) items will be deprecated for both apparel and non-apparel, starting January 15, 2026.
Packaging fees
Starting January 15, 2026, non-enrolled SIPP products requiring packaging services will incur a packaging fee.

Packaging fees for Small and Large bulky size tiers
Size tier\tDimensional weight\tPackaging fees
Small Bulky and Large Bulky\t0 to 5 lb\t$1.51
5 to 10 lb\t$1.68
45 or more lb\t$4.04
Dimensional weight is used for calculating fees since dimension determines the packaging required for the product.
`;
  const r = parseRateCard(PAGE);

  it("reads the discount table despite the word 'apparel' in its header", () => {
    // Read as a heading, that header opened an apparel section and every row
    // below it was skipped.
    expect(r.sipp).toHaveLength(5);
    expect(r.rows).toHaveLength(0);
  });

  it("takes the non-apparel column, even where apparel is the larger figure", () => {
    const big = r.sipp.find((x) => x.weightRange === "8+ to 12 oz")!;
    expect(big.nonPeak).toBe(0.07); // apparel is $0.06
    const small = r.sipp.find((x) => x.weightRange === "2 oz or less")!;
    expect(small.nonPeak).toBe(0.04); // apparel is $0.06
    expect(small.peak).toBe(0.04);
  });

  it("applies a row naming two tiers to both", () => {
    const tiers = new Set(r.nonSippPackaging.map((x) => x.tier));
    expect([...tiers].sort()).toEqual(["large bulky", "small bulky"]);
    expect(r.nonSippPackaging).toHaveLength(6);
  });

  it("reads '45 or more lb' as the open top band", () => {
    const top = r.nonSippPackaging.filter((x) => x.weightRange === "45+ lb");
    expect(top.map((x) => x.nonPeak)).toEqual([4.04, 4.04]);
  });

  it("marks packaging rows as sized by dimensional weight", () => {
    expect(r.nonSippPackaging.every((x) => x.weightBasis === "Dimensional weight")).toBe(true);
  });
});
