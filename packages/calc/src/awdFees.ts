// Amazon Warehousing and Distribution (AWD) fees for the P&L, from a dated
// fee schedule (feeSchedules.ts). A box sent to AWD pays processing when AWD
// receives it and again when AWD sends it on to FBA, transportation to FBA per
// cubic foot (plus the fuel surcharge from Feb 1, 2027), and monthly storage.
// Which rates apply depends on where Amazon stores it and the seller's tier.

import type { AwdTierRates, FeeSchedule } from "./feeSchedules";

/** Where the AWD inventory is received. */
export type AwdLocation = "east-south" | "west-coast" | "wcp-carton" | "wcp-pallet";
/** Amazon's AWD rate tier. */
export type AwdRateTier = keyof AwdTierRates;

export interface AwdSetup {
  location: AwdLocation;
  tier: AwdRateTier;
}

export const AWD_LOCATION_LABEL: Record<AwdLocation, string> = {
  "east-south": "East Coast / South",
  "west-coast": "West Coast",
  "wcp-carton": "West Coast Palletizable, boxes",
  "wcp-pallet": "West Coast Palletizable, single-SKU pallets",
};

export const AWD_TIER_LABEL: Record<AwdRateTier, string> = {
  base: "Base rate",
  smart: "Smart storage (auto-replenishment)",
  managed: "Amazon managed",
};

export interface AwdFeeRates {
  /** Inbound + outbound processing, per box. */
  processingPerBox: number;
  inboundPerBox: number;
  outboundPerBox: number;
  /** AWD to FBA transportation per cubic foot, fuel surcharge included. */
  transportationPerCuft: number;
  transportationBasePerCuft: number;
  transportationSurchargeRate: number;
  /** Monthly storage per cubic foot, inventory under 12 months old. */
  storagePerCuftMonth: number;
  /** Monthly storage per cubic foot past `agedAfterMonths`; null when the schedule has no aged tier. */
  agedStoragePerCuftMonth: number | null;
  agedAfterMonths: number | null;
}

const isWestCoast = (l: AwdLocation) => l !== "east-south";

export function awdFeeRates(schedule: FeeSchedule, setup: AwdSetup): AwdFeeRates {
  const a = schedule.awd;
  const region = isWestCoast(setup.location) ? "westCoast" : "otherRegions";
  const inbound =
    setup.location === "wcp-carton"
      ? a.westCoastPalletizableInboundPerBox.carton
      : setup.location === "wcp-pallet"
        ? a.westCoastPalletizableInboundPerBox.pallet
        : a.inboundProcessingPerBox;
  const transport = a.transportationPerCuft[setup.tier];
  return {
    processingPerBox: inbound + a.outboundProcessingPerBox,
    inboundPerBox: inbound,
    outboundPerBox: a.outboundProcessingPerBox,
    transportationPerCuft: transport * (1 + a.transportationSurchargeRate),
    transportationBasePerCuft: transport,
    transportationSurchargeRate: a.transportationSurchargeRate,
    storagePerCuftMonth: a.storagePerCuftMonth[region][setup.tier],
    agedStoragePerCuftMonth: a.agedStorage ? a.agedStorage.perCuftMonth[region][setup.tier] : null,
    agedAfterMonths: a.agedStorage ? a.agedStorage.afterMonths : null,
  };
}

/**
 * AWD storage for one unit kept `months` months. Under a schedule with an
 * aged tier, months past the threshold pay the aged rate.
 */
export function awdStorageCost(
  cbfPerUnit: number,
  months: number,
  schedule: FeeSchedule,
  setup: AwdSetup,
): number {
  if (!(cbfPerUnit > 0) || !(months > 0)) return 0;
  const r = awdFeeRates(schedule, setup);
  if (r.agedStoragePerCuftMonth === null || r.agedAfterMonths === null || months <= r.agedAfterMonths) {
    return cbfPerUnit * r.storagePerCuftMonth * months;
  }
  return (
    cbfPerUnit *
    (r.storagePerCuftMonth * r.agedAfterMonths + r.agedStoragePerCuftMonth * (months - r.agedAfterMonths))
  );
}
