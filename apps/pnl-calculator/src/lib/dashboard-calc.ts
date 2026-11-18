/**
 * Headless P&L calculations for the dashboard portfolio view. Runs the same
 * math as ProductCard but standalone (no React, no hooks) so we can render a
 * row per SKU cheaply.
 *
 * Amazon fees come from computeAmazonFbaFees, the same function the product
 * page uses: price column, fuel surcharge, SIPP, battery fee and the 9/3
 * non-peak/peak weighting all match.
 *
 * Simplifying assumptions for V1:
 *   - Fulfillment method = 100% FBA (shipping to AMZ + storage FBA only).
 *   - No returns cost (the product page adds one).
 *   - Marketing = MAX TACOS × sellingPrice (no separate affiliate/ads columns).
 */
import {
  calculateShippingCosts,
  computeAmazonFbaFees,
  type FeeSchedule,
} from "@platform/calc";
import type { Product } from "@/types/product";

export interface DashboardMetrics {
  cogs: number;
  referralFee: number;
  fbaFee: number;
  shippingStorage: number;
  tacosDollar: number;
  totalCosts: number;
  netProfit: number;
  netProfitPercent: number;
  // Diagnostic bits
  sizeTier: string;
  cbmPerUnit: number;
}

export function computeCogs(product: Product): number {
  const parts: number[] = [];
  if (product.productCostVisible !== false) {
    parts.push((product.cost ?? 0) * (product.costQuantity ?? 1));
  }
  if (product.retailBoxCostVisible !== false) {
    parts.push((product.retailBoxCost ?? 0) * (product.retailBoxCostQuantity ?? 1));
  }
  if (product.cardCostVisible !== false) {
    parts.push((product.cardCost ?? 0) * (product.cardCostQuantity ?? 1));
  }
  if (product.userManualCostVisible !== false) {
    parts.push((product.userManualCost ?? 0) * (product.userManualCostQuantity ?? 1));
  }
  if (Array.isArray(product.additionalCosts)) {
    for (const c of product.additionalCosts) {
      parts.push((c.value ?? 0) * (c.quantity ?? 1));
    }
  }
  return round2(parts.reduce((a, b) => a + b, 0));
}

export function computeMetrics(
  product: Product,
  desiredPrice: number,
  tacosPercent: number,
  schedule: FeeSchedule,
): DashboardMetrics {
  const price = Number.isFinite(desiredPrice) ? desiredPrice : 0;

  const cogs = computeCogs(product);

  const fees = computeAmazonFbaFees(
    {
      length: product.length ?? 0,
      width: product.width ?? 0,
      height: product.height ?? 0,
      weight: product.weight ?? 0,
      sellingPrice: price,
      category: product.category ?? "",
      hazmat: !!product.hazmat,
      containsBatteries: !!product.containsBatteries,
      sippEligibleOverride: product.sippEligibleOverride ?? true,
    },
    schedule,
  );
  const referralFee = fees.referralFee;
  const fbaFee = fees.fbaWeighted;

  const shipping = calculateShippingCosts({
    length: product.length ?? 0,
    width: product.width ?? 0,
    height: product.height ?? 0,
    weight: product.weight ?? 0,
    masterCartonLength: product.masterCartonLength ?? 0,
    masterCartonWidth: product.masterCartonWidth ?? 0,
    masterCartonHeight: product.masterCartonHeight ?? 0,
    masterCartonUnits: product.masterCartonUnits ?? 0,
    cbmCost: product.cbmCost ?? 0,
    shippingToAWD: product.shippingToAWD ?? 0,
    awdCaseReceiveCost: product.awdCaseReceiveCost ?? 0,
    awdTransportationCost: product.awdTransportationCost ?? 0,
    amazonAWDStorageFee: product.amazonAWDStorageFee ?? 0,
    storageMonths: product.storageMonths ?? 0,
    calculatorMode: null,
  });

  const storageFBAPerUnit =
    shipping.cbfPerUnit * (product.amazonFBAAVGFee ?? 0) * (product.storageMonths ?? 0);
  const shippingStorage = shipping.shippingToAMZ + storageFBAPerUnit;

  const tacosDollar = price * (tacosPercent / 100);

  const totalCosts = cogs + referralFee + fbaFee + shippingStorage + tacosDollar;
  const netProfit = price - totalCosts;
  const netProfitPercent = price > 0 ? (netProfit / price) * 100 : 0;

  return {
    cogs: round2(cogs),
    referralFee: round2(referralFee),
    fbaFee: round2(fbaFee),
    shippingStorage: round2(shippingStorage),
    tacosDollar: round2(tacosDollar),
    totalCosts: round2(totalCosts),
    netProfit: round2(netProfit),
    netProfitPercent: round1(netProfitPercent),
    sizeTier: fees.tier,
    cbmPerUnit: shipping.cbmPerUnit,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
