import { awdStorageCost } from "./awdFees";
import type { FeeSchedule } from "./feeSchedules";

interface StorageMetricsParams {
  cbfPerUnit: number;
  amazonFBAAVGFee: number;
  storageMonths: number;
  /** AWD storage per cubic foot per month; $0.48 (Amazon's East base rate) when not given. */
  amazonAWDStorageFee?: number;
  /** Applies the schedule's aged-inventory AWD rate past 12 months. */
  schedule?: FeeSchedule;
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
    schedule,
    storageDays = 30,
    length,
    width,
    height
  } = params;

  const storageFBA = cbfPerUnit * amazonFBAAVGFee * storageMonths;
  const storageAWD = schedule
    ? awdStorageCost(cbfPerUnit, amazonAWDStorageFee, storageMonths, schedule)
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
