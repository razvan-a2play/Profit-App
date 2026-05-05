interface FbtFeeRange {
  from: number;
  to?: number;
  singleFee: number | string;
  multiFee: number | string;
}

interface FbtStorageRange {
  fromDay: number;
  toDay?: number;
  rate: number;
}

interface FbtHubPlacementRange {
  from: number;
  to?: number;
  west: number | string;
  east: number | string;
  direct: number | string;
}

// FBT Fee lookup table based on weight ranges
const FBT_FEE_RANGES: FbtFeeRange[] = [
  { from: 0, to: 0.25, singleFee: 4.28, multiFee: 2.75 },
  { from: 0.25, to: 0.5, singleFee: 4.52, multiFee: 2.94 },
  { from: 0.5, to: 0.75, singleFee: 4.7, multiFee: 3.05 },
  { from: 0.75, to: 1, singleFee: 5.1, multiFee: 3.16 },
  { from: 1, to: 2, singleFee: 5.71, multiFee: 4.28 },
  { from: 2, to: 3, singleFee: 6.27, multiFee: 4.7 },
  { from: 3, to: 4, singleFee: 6.92, multiFee: 6.23 },
  { from: 4, to: 5, singleFee: 7.66, multiFee: 6.74 },
  { from: 5, to: 6, singleFee: 8.58, multiFee: 7.55 },
  { from: 6, to: 7, singleFee: 8.88, multiFee: 7.9 },
  { from: 7, to: 8, singleFee: 9.22, multiFee: 8.39 },
  { from: 8, to: 9, singleFee: 9.42, multiFee: 8.57 },
  { from: 9, to: 10, singleFee: 9.63, multiFee: 8.76 },
  { from: 10, to: 11, singleFee: 10.64, multiFee: 9.58 },
  { from: 11, to: 12, singleFee: 10.75, multiFee: 9.97 },
  { from: 12, to: 13, singleFee: 10.98, multiFee: 10.07 },
  { from: 13, to: 14, singleFee: 11.44, multiFee: 10.41 },
  { from: 14, to: 15, singleFee: 11.85, multiFee: 10.78 },
  { from: 15, to: 16, singleFee: 12.67, multiFee: 11.53 },
  { from: 16, to: 17, singleFee: 12.97, multiFee: 12.7 },
  { from: 17, to: 18, singleFee: 13.34, multiFee: 13.12 },
  { from: 18, to: 19, singleFee: 13.84, multiFee: 13.69 },
  { from: 19, to: 20, singleFee: 14.11, multiFee: 14 },
  { from: 20, to: 51, singleFee: "over 21", multiFee: "over 21" },
  { from: 51, singleFee: "over 51", multiFee: "over 51" }
];

// FBT Storage rates from "FBT Storage" sheet
const FBT_STORAGE_RANGES: FbtStorageRange[] = [
  { fromDay: 0, toDay: 30, rate: 0 },
  { fromDay: 31, toDay: 60, rate: 0.03 },
  { fromDay: 61, toDay: 90, rate: 0.05 },
  { fromDay: 91, toDay: 180, rate: 0.08 },
  { fromDay: 181, toDay: 365, rate: 0.16 },
  { fromDay: 366, rate: 0.32 }
];

// FBT Hub Placement Fee data from "Hub Placement" sheet
const FBT_HUB_PLACEMENT_RANGES: FbtHubPlacementRange[] = [
  { from: 0, to: 0.25, west: 0.13, east: 0.09, direct: "free" },
  { from: 0.25, to: 0.5, west: 0.19, east: 0.13, direct: "free" },
  { from: 0.5, to: 0.75, west: 0.24, east: 0.17, direct: "free" },
  { from: 0.75, to: 1, west: 0.3, east: 0.2, direct: "free" },
  { from: 1, to: 2, west: 0.43, east: 0.29, direct: "free" },
  { from: 2, to: 3, west: 0.73, east: 0.5, direct: "free" },
  { from: 3, to: 4, west: 1.19, east: 0.82, direct: "free" },
  { from: 4, to: 5, west: 1.53, east: 1.06, direct: "free" },
  { from: 5, to: 6, west: 1.61, east: 1.11, direct: "free" },
  { from: 6, to: 7, west: 1.94, east: 1.34, direct: "free" },
  { from: 7, to: 8, west: 2.53, east: 1.74, direct: "free" },
  { from: 8, to: 9, west: 2.76, east: 1.9, direct: "free" },
  { from: 9, to: 10, west: 2.99, east: 2.06, direct: "free" },
  { from: 10, to: 11, west: 3.22, east: 2.22, direct: "free" },
  { from: 11, to: 12, west: 3.46, east: 2.38, direct: "free" },
  { from: 12, to: 13, west: 3.69, east: 2.54, direct: "free" },
  { from: 13, to: 14, west: 3.92, east: 2.7, direct: "free" },
  { from: 14, to: 15, west: 4.16, east: 2.86, direct: "free" },
  { from: 15, to: 16, west: 4.5, east: 3.1, direct: "free" },
  { from: 16, to: 17, west: 4.7, east: 3.24, direct: "free" },
  { from: 17, to: 18, west: 4.91, east: 3.38, direct: "free" },
  { from: 18, to: 19, west: 5.13, east: 3.53, direct: "free" },
  { from: 19, to: 20, west: 5.28, east: 3.64, direct: "free" },
  { from: 20, west: "5.43 + $0.60/lb over 21lbs", east: "3.74 + $0.60/lb over 21lbs", direct: "free" }
];

/**
 * Calculates the FBT Storage Cost using storage ranges
 * @param cubicFeet Volume per unit (cu.ft)
 * @param storageDays Days stored
 * @returns Total storage cost
 */
export function calculateFbtStorageCost(cubicFeet: number, storageDays: number): number {
  if (!cubicFeet || !storageDays) {
    return 0;
  }

  const minVolume = 0.001;
  const cf = Math.max(cubicFeet, minVolume);

  for (const range of FBT_STORAGE_RANGES) {
    const isMatch = storageDays >= range.fromDay && 
                   (range.toDay === undefined || storageDays <= range.toDay);

    if (isMatch) {
      return Math.round(cf * storageDays * range.rate * 10000) / 10000;
    }
  }

  return 0;
}

/**
 * Returns breakdown information for FBT storage calculation
 * @param storageDays Days stored
 * @returns Object with day range and rate, or null if no match
 */
export function getFbtStorageBreakdown(storageDays: number): { fromDay: number; toDay?: number; rate: number } | null {
  if (!storageDays) {
    return null;
  }

  for (const range of FBT_STORAGE_RANGES) {
    const isMatch = storageDays >= range.fromDay && 
                   (range.toDay === undefined || storageDays <= range.toDay);

    if (isMatch) {
      return { fromDay: range.fromDay, toDay: range.toDay, rate: range.rate };
    }
  }

  return null;
}

/**
 * Calculates FBT Fulfillment Fee based on weight and order type
 * @param weight Chargeable weight in lbs
 * @param orderType "single" or "multiple"
 * @returns FBT fee amount
 */
export function calculateFbtFee(weight: number, orderType: string): number {
  if (!weight || !orderType) {
    return 0;
  }

  for (const range of FBT_FEE_RANGES) {
    const match = weight >= range.from && (range.to === undefined || weight < range.to);

    if (match) {
      const rawFee = orderType === "single" ? range.singleFee : range.multiFee;

      // Handle dynamic fee logic
      if (typeof rawFee === 'string') {
        if (rawFee.toLowerCase().includes('over 21')) {
          const base = 18.00;
          const extra = 0.40 * Math.max(0, weight - 21);
          return Math.round((base + extra) * 100) / 100;
        }
        if (rawFee.toLowerCase().includes('over 51')) {
          const base = 41.32;
          const extra = 0.75 * Math.max(0, weight - 51);
          return Math.round((base + extra) * 100) / 100;
        }
      }

      return typeof rawFee === 'number' ? rawFee : 0;
    }
  }

  return 0;
}

/**
 * Returns breakdown information for FBT fee calculation
 * @param weight Chargeable weight in lbs
 * @param orderType "single" or "multiple"
 * @returns Object with bracket range and fee, or null if no match
 */
export function getFbtFeeBreakdown(weight: number, orderType: string): { from: number; to?: number; fee: number | string } | null {
  if (!weight || !orderType) {
    return null;
  }

  for (const range of FBT_FEE_RANGES) {
    const match = weight >= range.from && (range.to === undefined || weight < range.to);

    if (match) {
      const rawFee = orderType === "single" ? range.singleFee : range.multiFee;
      
      // Handle dynamic fee logic
      if (typeof rawFee === 'string') {
        if (rawFee.toLowerCase().includes('over 21')) {
          const base = 18.00;
          const extra = 0.40 * Math.max(0, weight - 21);
          return { from: range.from, to: range.to, fee: Math.round((base + extra) * 100) / 100 };
        }
        if (rawFee.toLowerCase().includes('over 51')) {
          const base = 41.32;
          const extra = 0.75 * Math.max(0, weight - 51);
          return { from: range.from, to: range.to, fee: Math.round((base + extra) * 100) / 100 };
        }
      }

      return { from: range.from, to: range.to, fee: rawFee };
    }
  }

  return null;
}

/**
 * Calculates FBT Hub Placement Fee based on weight and destination
 * @param weight Chargeable weight in lbs  
 * @param destination "west", "east", or "direct"
 * @returns Hub placement fee amount
 */
export function calculateFbtHubPlacementFee(weight: number, destination: string): number {
  if (!weight || !destination) {
    return 0;
  }

  for (const range of FBT_HUB_PLACEMENT_RANGES) {
    const match = weight >= range.from && (range.to === undefined || weight < range.to);

    if (match) {
      let fee: number | string;
      
      if (destination.toLowerCase() === "west") fee = range.west;
      else if (destination.toLowerCase() === "east") fee = range.east;  
      else if (destination.toLowerCase() === "direct") fee = range.direct;
      else return 0;

      // Return 0 if fee is "free"
      if (typeof fee === "string" && fee.toLowerCase().includes("free")) {
        return 0;
      }

      // Handle formula like "5.43 + $0.60/lb over 21lbs"
      if (typeof fee === "string" && fee.includes("+ $")) {
        const base = parseFloat(fee.split("+")[0].trim());
        const overMatch = fee.match(/\$([0-9.]+)/);
        if (overMatch) {
          const over = parseFloat(overMatch[1]);
          const threshold = fee.includes("over 21") ? 21 : 0;
          return Math.round((base + over * Math.max(0, weight - threshold)) * 100) / 100;
        }
      }

      return typeof fee === 'number' ? fee : 0;
    }
  }

  return 0;
}

/**
 * Returns breakdown information for FBT hub placement fee
 * @param weight Chargeable weight in lbs
 * @param destination "west", "east", or "direct"
 * @returns Object with weight range and fee, or null if no match
 */
export function getFbtPlacementBreakdown(weight: number, destination: string): { from: number; to?: number; fee: number | string } | null {
  if (!weight || !destination) {
    return null;
  }

  for (const range of FBT_HUB_PLACEMENT_RANGES) {
    const match = weight >= range.from && (range.to === undefined || weight < range.to);

    if (match) {
      let fee: number | string;
      
      if (destination.toLowerCase() === "west") fee = range.west;
      else if (destination.toLowerCase() === "east") fee = range.east;  
      else if (destination.toLowerCase() === "direct") fee = range.direct;
      else return null;

      // Handle formula like "5.43 + $0.60/lb over 21lbs"
      if (typeof fee === "string" && fee.includes("+ $")) {
        const base = parseFloat(fee.split("+")[0].trim());
        const overMatch = fee.match(/\$([0-9.]+)/);
        if (overMatch) {
          const over = parseFloat(overMatch[1]);
          const threshold = fee.includes("over 21") ? 21 : 0;
          fee = Math.round((base + over * Math.max(0, weight - threshold)) * 100) / 100;
        }
      }

      return { from: range.from, to: range.to, fee };
    }
  }

  return null;
}