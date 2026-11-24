import { awdStorageCost, type AwdSetup } from "./awdFees";
import type { FeeSchedule } from "./feeSchedules";

interface StorageMetricsParams {
  cbfPerUnit: number;
  amazonFBAAVGFee: number;
  storageMonths: number;
  /** AWD storage per cubic foot per month, used when `awd` isn't given; default $0.48. */
  amazonAWDStorageFee?: number;
  /** AWD storage from Amazon's table for this location and tier (aged rate included). */
  awd?: { schedule: FeeSchedule; setup: AwdSetup };
  storageDays?: number;
  length?: number;
  width?: number;
  height?: number;
}

// Time-period based storage rates (per cubic meter per day)
const getStorageRateByDays = (days: number) => {
  if (days <= 30) return 0;
  if (days <= 60) return 0.6;
  if (days <= 90) return 0.9;
  if (days <= 180) return 1.2;
  if (days <= 365) return 2;
  return 3; // Greater than 365 days
};

export const calculateStorageMetrics = (params: StorageMetricsParams) => {
  const {
    cbfPerUnit,
    amazonFBAAVGFee,
    storageMonths,
    amazonAWDStorageFee = 0.48,
    awd,
    storageDays = 30,
    length,
    width,
    height
  } = params;

  const storageFBA = cbfPerUnit * amazonFBAAVGFee * storageMonths;
  const storageAWD = awd
    ? awdStorageCost(cbfPerUnit, storageMonths, awd.schedule, awd.setup)
    : cbfPerUnit * amazonAWDStorageFee * storageMonths;
  
  // Calculate 3PL storage fee with time-period based pricing
  let storage3PL = 0;
  if (length && width && height) {
    const cubicInches = length * width * height;
    const cubicMeters = cubicInches * 0.0000163871; // Convert to cubic meters
    const minimumVolume = Math.max(cubicMeters, 0.001); // Minimum 0.001 CBM
    const dailyRate = getStorageRateByDays(storageDays);
    storage3PL = minimumVolume * dailyRate * storageDays;
  }

  return {
    cbfPerUnit,
    storageFBA,
    storageAWD,
    storage3PL
  };
};
