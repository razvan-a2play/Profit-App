import { describe, it, expect } from "vitest";
import {
  parseSourcingFile,
  compareSourcingCosts,
  summarise,
  buildUploadFile,
  type SourcingFileRow,
} from "./sourcingCost";

const TSV = [
  "Asin\tFnsku\tAmazon Estimated Cost\tLatest Approved Cost\tSource of Latest Approved Cost\tCurrency\tDate of Last Updated Cost\tSeller New Cost",
  "B07MNMT3M7\tB07MNMT3M7\t7.81\t7.81\tAMAZON\tUSD\t2026-07-10T02:05:28\t",
  "B089MD9RWP\tB089MD9RWP\t2.16\t2.16\tAMAZON\tUSD\t2026-07-11T04:13:34\t",
  "B0NEWASIN1\tB0NEWASIN1\t\t\t\tUSD\t\t",
].join("\r\n");

const buf = (s: string) => Buffer.from(s, "utf8");

describe("parseSourcingFile", () => {
  it("reads Amazon's tab-delimited export", () => {
    const { rows, skipped } = parseSourcingFile(buf(TSV));
    expect(rows).toHaveLength(3);
    expect(skipped).toBe(0);
    expect(rows[0]).toMatchObject({
      asin: "B07MNMT3M7",
      amazonEstimated: 7.81,
      latestApproved: 7.81,
      approvedSource: "AMAZON",
      currency: "USD",
    });
  });

  it("leaves an empty approved cost as null rather than zero", () => {
    // Zero would read as "Amazon values this at nothing", which is a different
    // claim from "Amazon has never set a cost".
    const { rows } = parseSourcingFile(buf(TSV));
    expect(rows[2].latestApproved).toBeNull();
    expect(rows[2].amazonEstimated).toBeNull();
  });

  it("accepts comma-delimited and $-prefixed values", () => {
    const csv = "Asin,Latest Approved Cost\nB07MNMT3M7,$7.81";
    expect(parseSourcingFile(buf(csv)).rows[0].latestApproved).toBe(7.81);
  });

  it("names the report when the columns are not Amazon's", () => {
    expect(() => parseSourcingFile(buf("sku\tcost\nA\t1"))).toThrow(/Manage Your Sourcing Cost/);
  });

  it("skips a populated row with no ASIN instead of inventing one", () => {
    const { rows, skipped } = parseSourcingFile(buf(TSV + "\r\n\tB0FNSKUONLY\t1.00\t1.00"));
    expect(rows).toHaveLength(3);
    expect(skipped).toBe(1);
  });

  it("does not count a trailing blank line as a skipped row", () => {
    expect(parseSourcingFile(buf(TSV + "\r\n\r\n")).skipped).toBe(0);
  });
});

const file: SourcingFileRow[] = parseSourcingFile(buf(TSV)).rows;
const opts = {
  skuByCode: {
    b07mnmt3m7: "SEZ0101002",
    b089md9rwp: "SPBATH0001",
    b0newasin1: "SPBATH0099",
  },
  costBySku: {
    sez0101002: { cost: 3.546, versionName: "v3" }, // Amazon values it higher
    spbath0001: { cost: 4.2, versionName: "v1" }, // we cost more than Amazon pays
    spbath0099: { cost: 1.75, versionName: "v2" }, // nothing on file
  },
};

describe("compareSourcingCosts", () => {
  it("only proposes a change where Amazon is paying us short", () => {
    const rows = compareSourcingCosts(file, opts);
    const [amazonHigher, claim, missing] = rows;

    expect(amazonHigher.status).toBe("amazon_higher");
    expect(amazonHigher.suggested).toBeNull(); // submitting would CUT the payout

    expect(claim.status).toBe("amazon_lower");
    expect(claim.suggested).toBe(4.2);
    expect(claim.delta).toBeCloseTo(2.04, 2);

    expect(missing.status).toBe("no_cost_on_file");
    expect(missing.suggested).toBe(1.75);
  });

  it("rounds a proposal to the two decimals the upload page allows", () => {
    const rows = compareSourcingCosts(file, {
      ...opts,
      costBySku: { ...opts.costBySku, spbath0001: { cost: 4.2049, versionName: null } },
    });
    expect(rows[1].suggested).toBe(4.2);
  });

  it("treats a penny of drift as agreement", () => {
    const rows = compareSourcingCosts(file, {
      ...opts,
      costBySku: { ...opts.costBySku, spbath0001: { cost: 2.16, versionName: null } },
    });
    expect(rows[1].status).toBe("match");
    expect(rows[1].suggested).toBeNull();
  });

  it("separates an unmatched ASIN from a SKU with no saved cost", () => {
    const rows = compareSourcingCosts(file, {
      skuByCode: { b07mnmt3m7: "SEZ0101002" },
      costBySku: {},
    });
    expect(rows[0].status).toBe("no_pnl_version");
    expect(rows[1].status).toBe("unknown_asin");
    expect(rows.every((r) => r.suggested === null)).toBe(true);
  });

  it("falls back to the FNSKU when the ASIN is not in the Library", () => {
    const rows = compareSourcingCosts(file, {
      ...opts,
      skuByCode: { b089md9rwp: "SPBATH0001" },
    });
    expect(rows[1].sku).toBe("SPBATH0001");
  });
});

describe("summarise", () => {
  it("adds up only the shortfall that is actually claimable", () => {
    const s = summarise(compareSourcingCosts(file, opts));
    expect(s.total).toBe(3);
    expect(s.claimable).toBe(1);
    expect(s.claimableDelta).toBeCloseTo(2.04, 2);
    expect(s.amazonHigher).toBe(1);
    expect(s.noCostOnFile).toBe(1);
  });
});

describe("buildUploadFile", () => {
  const rows = compareSourcingCosts(file, opts);

  it("writes Amazon's own header, tab-delimited", () => {
    const out = buildUploadFile(rows, {});
    expect(out.split("\r\n")[0]).toBe(
      "Asin\tFnsku\tAmazon Estimated Cost\tLatest Approved Cost\t" +
        "Source of Latest Approved Cost\tCurrency\tDate of Last Updated Cost\tSeller New Cost",
    );
  });

  it("fills Seller New Cost only on the rows passed in", () => {
    const out = buildUploadFile(rows, { B089MD9RWP: 4.2 });
    const lines = out.split("\r\n");
    expect(lines[1].endsWith("\t")).toBe(true); // untouched row stays blank
    expect(lines[2].split("\t").at(-1)).toBe("4.20"); // two decimals, always
  });

  it("keeps every row so the file Amazon gets is the file it gave us", () => {
    expect(buildUploadFile(rows, { B089MD9RWP: 4.2 }).split("\r\n")).toHaveLength(4);
  });
});
