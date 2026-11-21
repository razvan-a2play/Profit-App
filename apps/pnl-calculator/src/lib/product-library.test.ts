import { describe, expect, it } from "vitest";
import { mergeLibraryProducts, pickBestSpec, type LibraryProduct, type ProductInfoLike, type SpecRow } from "./product-library";

const spec = (o: Partial<SpecRow>): SpecRow => ({
  sku_id: "p1",
  spec_type: "unit",
  status: "draft",
  version_number: 1,
  length_cm: 10,
  width_cm: 5,
  height_cm: 2,
  weight_kg: 0.1,
  units_per_carton: null,
  ...o,
});

const info = (sku: string, o: Partial<ProductInfoLike> = {}): ProductInfoLike => ({
  ASIN: null,
  SKU: sku,
  "Product Name": null,
  Supplier: null,
  Category: null,
  "Product box Length": 23.5,
  "Product box Width": 20.5,
  "Product box Height": 5.5,
  "Product box weight (kg)": 1.57,
  "Carton Length": null,
  "Carton Width": null,
  "Carton Height": null,
  "Carton weight": null,
  "Units/carton": null,
  ...o,
});

const lib = (sku: string, o: Partial<LibraryProduct> = {}): LibraryProduct => ({
  sku,
  name: `${sku} name`,
  status: "ready",
  asin: `ASIN-${sku}`,
  unit: { lengthCm: 26.5, widthCm: 1.7, heightCm: 15.8, weightKg: 0.25 },
  carton: { lengthCm: 52, widthCm: 29, heightCm: 38, weightKg: 19, units: 60 },
  hazmat: false,
  containsBattery: false,
  ...o,
});

describe("pickBestSpec", () => {
  it("prefers an approved spec over a newer draft", () => {
    const approved = spec({ status: "approved", version_number: 1 });
    expect(pickBestSpec([spec({ version_number: 3 }), approved])).toBe(approved);
  });
  it("otherwise takes the highest version", () => {
    const v2 = spec({ version_number: 2 });
    expect(pickBestSpec([spec({ version_number: 1 }), v2])).toBe(v2);
    expect(pickBestSpec([])).toBeNull();
  });
});

describe("mergeLibraryProducts", () => {
  it("adds Library products the P&L table lacks, with their boxes", () => {
    const { rows, added } = mergeLibraryProducts([info("SEZ0101011")], [lib("BTBM001")]);
    expect(added).toEqual(["BTBM001"]);
    const row = rows.find((r) => r.SKU === "BTBM001")!;
    expect(row["Product Name"]).toBe("BTBM001 name");
    expect(row["Product box Length"]).toBe(26.5);
    expect(row["Units/carton"]).toBe(60);
    expect(row.libraryStatus).toBe("ready");
  });

  it("keeps the P&L table's own dims for products in both, matching SKUs case-insensitively", () => {
    const { rows, added } = mergeLibraryProducts(
      [info("sez0101011", { ASIN: null, "Product Name": "P&L name" })],
      [lib("SEZ0101011", { unit: { lengthCm: 29.7, widthCm: 20.8, heightCm: 6.2, weightKg: 2.16 } })],
    );
    expect(added).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]["Product box Length"]).toBe(23.5);
    expect(rows[0]["Product Name"]).toBe("P&L name");
    expect(rows[0].ASIN).toBe("ASIN-SEZ0101011"); // filled only because the P&L row had none
  });

  it("carries the Library's dangerous-goods flags", () => {
    const { rows } = mergeLibraryProducts([], [lib("X1", { hazmat: true, containsBattery: true })]);
    expect(rows[0].hazmat).toBe(true);
    expect(rows[0].containsBatteries).toBe(true);
  });
});
