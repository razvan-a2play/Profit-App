"use client";

import { createContext, useContext } from "react";
import { CLASS_A_SHARE, CLASS_B_SHARE, DORMANT_MONTHS, NEW_MONTHS, type SkuClass, type SkuClassInfo } from "@platform/supply-chain-data";

/** Every SKU's class, as of the newest closed month, for any table that lists SKUs. */
export const SkuClassContext = createContext<Record<string, SkuClassInfo>>({});

export const CLASS_LABEL: Record<SkuClass, string> = {
  A: "A",
  B: "B",
  C: "C",
  new: "New",
  dormant: "Dormant",
};

export const CLASS_MEANING: Record<SkuClass, string> = {
  A: `Top sellers: the first ${CLASS_A_SHARE * 100}% of the last 12 months' net sales (New and Dormant SKUs aren't ranked)`,
  B: `Steady sellers: from ${CLASS_A_SHARE * 100}% to ${CLASS_B_SHARE * 100}% of sales`,
  C: `Long tail: the last ${Math.round((1 - CLASS_B_SHARE) * 100)}% of sales`,
  new: `First sale in the last ${NEW_MONTHS} months`,
  dormant: `Holding stock with no sale in the last ${DORMANT_MONTHS} months`,
};

/** The SKU's class as a small label beside its name; nothing for a SKU with no class. */
export function ClassTag({ sku }: { sku: string }) {
  const info = useContext(SkuClassContext)[sku.toUpperCase()];
  if (!info) return null;
  const share = info.share != null ? ` · ${(info.share * 100).toFixed(1)}% of sales` : "";
  return (
    <span
      title={`${CLASS_MEANING[info.cls]}${share}`}
      className="ml-1.5 inline-block rounded border border-border px-1 align-[1px] text-[11px] font-medium leading-4 text-muted-foreground"
    >
      {CLASS_LABEL[info.cls]}
    </span>
  );
}
