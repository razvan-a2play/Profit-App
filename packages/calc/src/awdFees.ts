// Amazon Warehousing and Distribution (AWD) fees for the P&L, from a dated
// fee schedule (feeSchedules.ts). A box sent to AWD pays processing when AWD
// receives it and again when AWD sends it on to FBA, transportation to FBA per
// cubic foot (plus the fuel surcharge from Feb 1, 2027), and monthly storage.

import type { FeeSchedule } from "./feeSchedules";

export interface AwdFeeRates {
  /** Inbound + outbound processing, per box. */
  processingPerBox: number;
  inboundPerBox: number;
  outboundPerBox: number;
  /** AWD to FBA transportation per cubic foot, fuel surcharge included. */
  transportationPerCuft: number;
  transportationBasePerCuft: number;
  transportationSurchargeRate: number;
}

export function awdFeeRates(schedule: FeeSchedule): AwdFeeRates {
  const a = schedule.awd;
  return {
    processingPerBox: a.inboundProcessingPerBox + a.outboundProcessingPerBox,
    inboundPerBox: a.inboundProcessingPerBox,
    outboundPerBox: a.outboundProcessingPerBox,
    transportationPerCuft: a.transportationPerCuft * (1 + a.transportationSurchargeRate),
    transportationBasePerCuft: a.transportationPerCuft,
    transportationSurchargeRate: a.transportationSurchargeRate,
  };
}

/**
 * AWD storage for one unit kept `months` months at `ratePerCuftMonth` (the
 * seller's own rate: region and discount tier). Under a schedule with an aged
 * tier, months past the threshold pay the multiplier.
 */
export function awdStorageCost(
  cbfPerUnit: number,
  ratePerCuftMonth: number,
  months: number,
  schedule: FeeSchedule,
): number {
  if (!(cbfPerUnit > 0) || !(ratePerCuftMonth > 0) || !(months > 0)) return 0;
  const aged = schedule.awd.agedStorage;
  if (!aged || months <= aged.afterMonths) return cbfPerUnit * ratePerCuftMonth * months;
  const standard = aged.afterMonths;
  const older = months - aged.afterMonths;
  return cbfPerUnit * ratePerCuftMonth * (standard + older * aged.multiplier);
}
