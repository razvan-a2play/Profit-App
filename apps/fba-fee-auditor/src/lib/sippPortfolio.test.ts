import { describe, expect, it } from "vitest";
import {
  isCertified,
  mapPortfolioToSkus,
  parseCsv,
  parseSippPortfolio,
  sippOpportunityNote,
} from "./sippPortfolio";

// Rows lifted from a real SIPP_Product_Portfolio_NA download, including the
// awkward ones: the preamble, a "" quote inside an item name, a row whose
// savings column holds Amazon's "no shipment" note, a decertified listing, and
// a row from another marketplace.
const REPORT = `"This downloadable report shows the enrollment status and opportunities for all your products eligible for the Ships in Product Packaging program. Please note that enrollment status may change while the report is updated."
"Potential savings per product are calculated as number of items shipped in past 90 days multiplied by fee rate per unit"
""
"ASIN","Item Name","Eligibility Status","Certification Status","Certification Date","Decertification Date","Region","Marketplace","Currency","Current Benefits","Current Packaging Fees","Per Unit Fee Savings","Estimated total fee savings","InEligibility Reason","Primary ASIN"
"B0BPYLXS2M","SplashEZ 89’’ Extra Large Splash Pad for Kids & Dogs","certified","Rigid (Box)","2024-06-08","N/A","NA","US","USD","0.23","N/A","0.23","566.95","N/A","B0BPYLXS2M"
"B0DJ9FHBG1","SplashEZ Lights Up Tummy Time Water Mat for Babies, 30"" X-Large | Baby Water Mat","certified","Rigid (Box)","2025-03-20","N/A","NA","US","USD","0.08","N/A","0.08","250.88","N/A","B0DJ9FHBG1"
"B0FJY54BQZ","SplashEZ Bath Color Tablets for Kids, 150 Fizzy Bath Bombs","eligible","NONE","N/A","N/A","NA","US","USD","N/A","N/A","0.06","453.47","N/A","B0FJY54BQZ"
"B0C5N4YGQT","SplashEZ Food Bath Toys for Kids & Toddlers","eligible","DECERTIFIED","N/A","2024-05-29","NA","US","USD","N/A","N/A","0.07","28.63","N/A","B0C5N4YGQT"
"B0HBWV385G","","eligible","NONE","N/A","N/A","NA","US","USD","N/A","N/A","0.09","There was no shipment in the past 90 days","N/A","B0HBWV385G"
"B0H3KWDHS8","Light Up Magnetic Fishing Toy","excluded","NONE","N/A","N/A","NA","US","USD","0.0","N/A","0.0","0.0","Package size is below 6 x 4 x 0.375 inches",""
"B0BPYKR658","SplashEZ Dog Splash Pad","certified","Rigid (Box)","2026-08-11","N/A","NA","CA","CAD","0.2","N/A","0.2","249.4","N/A","B0BPYKR658"
"B0ZZZZZZZZ","Not one of ours in the Library","certified","Rigid (Box)","2024-01-01","N/A","NA","US","USD","0.1","N/A","0.1","1.0","N/A","B0ZZZZZZZZ"
`;

describe("parseCsv", () => {
  it("keeps commas and doubled quotes inside quoted fields", () => {
    expect(parseCsv('"a, b","30"" X-Large",c\n')).toEqual([["a, b", '30" X-Large', "c"]]);
  });
});

describe("parseSippPortfolio", () => {
  const { rows, skipped } = parseSippPortfolio(REPORT);

  it("finds the header below Amazon's preamble", () => {
    expect(rows).toHaveLength(8);
    expect(skipped).toBe(0);
  });

  it("reads a quote inside an item name without shifting the columns", () => {
    const mat = rows.find((r) => r.asin === "B0DJ9FHBG1")!;
    expect(mat.itemName).toContain('30" X-Large');
    expect(mat.eligibility).toBe("certified");
    expect(mat.perUnitSavings).toBe(0.08);
  });

  it("treats Amazon's 'no shipment' note as no estimate, and keeps it as the reason", () => {
    const r = rows.find((x) => x.asin === "B0HBWV385G")!;
    expect(r.savings90d).toBeNull();
    expect(r.perUnitSavings).toBe(0.09);
    expect(r.reason).toMatch(/no shipment/);
  });

  it("reads N/A as missing rather than zero", () => {
    const r = rows.find((x) => x.asin === "B0FJY54BQZ")!;
    expect(r.currentBenefit).toBeNull();
    expect(r.certificationDate).toBeNull();
  });

  it("refuses a file that isn't the SIPP report", () => {
    expect(() => parseSippPortfolio("sku,cost\nA,1\n")).toThrow(/ASIN/);
  });
});

describe("mapPortfolioToSkus", () => {
  const { rows } = parseSippPortfolio(REPORT);
  const index = new Map<string, Set<string>>([
    ["b0bpylxs2m", new Set(["SEZ0101011"])],
    ["b0dj9fhbg1", new Set(["SEZTUM001"])],
    ["b0fjy54bqz", new Set(["BTBM001"])],
    ["b0c5n4ygqt", new Set(["SPBATH0023"])],
    ["b0hbwv385g", new Set(["BTBM008"])],
    ["b0h3kwdhs8", new Set(["LUFHSET001"])],
    ["b0bpykr658", new Set(["SEZ0101012"])],
  ]);
  const m = mapPortfolioToSkus(rows, index);

  it("uses only the US rows - a Canadian certification says nothing about the US listing", () => {
    // SEZ0101012 is certified in CA only in this extract.
    expect(m.bySku["sez0101012"]).toBeUndefined();
    expect(m.otherMarketplaceRows).toBe(1);
  });

  it("counts certified, eligible, excluded and decertified", () => {
    expect(m.counts).toEqual({ certified: 2, eligible: 3, excluded: 1, decertified: 1 });
  });

  it("lists US ASINs it couldn't tie to a SKU instead of dropping them", () => {
    expect(m.unmatchedAsins).toEqual(["B0ZZZZZZZZ"]);
  });

  it("gives a SKU on two ASINs its certified row", () => {
    const twice = new Map(index);
    twice.set("b0fjy54bqz", new Set(["SEZ0101011"])); // eligible row for the same SKU
    const r = mapPortfolioToSkus(rows, twice);
    expect(r.bySku["sez0101011"].eligibility).toBe("certified");
  });

  it("treats a decertified listing as not certified", () => {
    expect(isCertified(m.bySku["sez0101011"])).toBe(true);
    expect(isCertified(m.bySku["spbath0023"])).toBe(false);
  });
});

describe("sippOpportunityNote", () => {
  const m = mapPortfolioToSkus(
    parseSippPortfolio(REPORT).rows,
    new Map([
      ["b0fjy54bqz", new Set(["BTBM001"])],
      ["b0c5n4ygqt", new Set(["SPBATH0023"])],
      ["b0h3kwdhs8", new Set(["LUFHSET001"])],
      ["b0bpylxs2m", new Set(["SEZ0101011"])],
    ]),
  );

  it("puts Amazon's own estimate on an eligible, unenrolled SKU", () => {
    expect(sippOpportunityNote(m.bySku["btbm001"])).toMatch(/eligible but not enrolled.*\$0\.06\/unit.*\$453/);
  });

  it("says when a SKU was decertified but could re-enrol", () => {
    expect(sippOpportunityNote(m.bySku["spbath0023"])).toMatch(/decertified on 2024-05-29 but still eligible/);
  });

  it("stays quiet about an 'eligible' listing Amazon puts no saving on", () => {
    // Real rows: SPBATH0001/0007/0008 are "eligible, DECERTIFIED" with $0 and
    // a package-size reason.
    expect(
      sippOpportunityNote({
        sku: "SPBATH0001",
        asin: "B089MD9RWP",
        eligibility: "eligible",
        certificationStatus: "DECERTIFIED",
        certificationDate: null,
        decertificationDate: "2024-01-11",
        currentBenefit: 0,
        perUnitSavings: 0,
        savings90d: 0,
        reason: "Package size is below 6 x 4 x 0.375 inches",
      }),
    ).toBeNull();
  });

  it("stays quiet about excluded and already-certified SKUs", () => {
    expect(sippOpportunityNote(m.bySku["lufhset001"])).toBeNull();
    expect(sippOpportunityNote(m.bySku["sez0101011"])).toBeNull();
  });
});
