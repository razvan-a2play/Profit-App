/**
 * Centralized shipping cost calculations to eliminate redundancy
 * 
 * This module provides consistent shipping calculations to eliminate code duplication
 * and ensure all calculations follow the same business logic.
 */

import { calculateCBMPerUnit, type ProductDimensions } from './cbmCalculations';

export interface ShippingCalculationParams {
  // Product dimensions
  length?: number;
  width?: number;
  height?: number;
  weight?: number;
  
  // Master carton dimensions
  masterCartonLength?: number;
  masterCartonWidth?: number;
  masterCartonHeight?: number;
  masterCartonUnits?: number;
  
  // Cost parameters
  cbmCost?: number;
  shippingToAWD?: number;
  awdCaseReceiveCost?: number;
  awdTransportationCost?: number;
  amazonAWDStorageFee?: number;
  amazonFBAStorageFeeNonPeak?: number;
  amazonFBAStorageFeePeak?: number;
  storageMonths?: number;
  
  // Hazmat storage fees
  hazmat?: boolean;
  hazmatStorageFeeNonPeak?: number;
  hazmatStorageFeePeak?: number;
  hazmatOversizeStorageFeeNonPeak?: number;
  hazmatOversizeStorageFeePeak?: number;
  
  // Calculator mode
  calculatorMode?: 'pre-launch' | 'legacy' | null;
}

export interface ShippingCalculationResult {
  // CBM values
  cbmPerUnit: number;
  cbfPerUnit: number;
  units: number;
  
  // Shipping costs
  shippingToAMZ: number;
  shippingToAWD: number;
  awdReceivingCost: number;
  transferAWDToFBA: number;
  storageAWD: number;
  
  // Source information
  calculationSource: string;
}

/**
 * Calculate all shipping-related costs in one centralized function
 * 
 * @param params - Shipping calculation parameters
 * @returns Complete shipping calculation results
 */
export const calculateShippingCosts = (params: ShippingCalculationParams): ShippingCalculationResult => {
  const {
    length = 0,
    width = 0,
    height = 0,
    weight = 0,
    masterCartonLength = 0,
    masterCartonWidth = 0,
    masterCartonHeight = 0,
    masterCartonUnits = 0,
    cbmCost = 0,
    shippingToAWD = 0,
    awdCaseReceiveCost = 0,
    awdTransportationCost = 0,
    amazonAWDStorageFee = 0,
    storageMonths = 0,
    calculatorMode = null
  } = params;

  // Get CBM calculation using centralized function
  const dimensions: ProductDimensions = {
    length,
    width,
    height,
    weight,
    masterCartonLength,
    masterCartonWidth,
    masterCartonHeight,
    masterCartonUnits
  };

  const cbmResult = calculateCBMPerUnit(dimensions, calculatorMode);
  const { cbmPerUnit, cbfPerUnit, units, calculationSource } = cbmResult;

  // Calculate all shipping costs using the single CBM calculation
  const shippingToAMZ = cbmPerUnit * cbmCost;
  const shippingToAWDCost = cbmPerUnit * shippingToAWD;
  const awdReceivingCost = units > 0 ? awdCaseReceiveCost / units : 0;
  const transferAWDToFBA = cbfPerUnit * awdTransportationCost;
  const storageAWD = cbfPerUnit * amazonAWDStorageFee * storageMonths;

  return {
    cbmPerUnit,
    cbfPerUnit,
    units,
    shippingToAMZ,
    shippingToAWD: shippingToAWDCost,
    awdReceivingCost,
    transferAWDToFBA,
    storageAWD,
    calculationSource
  };
};

/**
 * Quick shipping to AMZ calculation for simple use cases
 * 
 * @param dimensions - Product dimensions
 * @param cbmCost - CBM cost
 * @param calculatorMode - Calculator mode
 * @returns Just the shipping to AMZ cost
 */
export const getShippingToAMZ = (
  dimensions: ProductDimensions, 
  cbmCost: number, 
  calculatorMode?: 'pre-launch' | 'legacy' | null
): number => {
  const cbmResult = calculateCBMPerUnit(dimensions, calculatorMode);
  return cbmResult.cbmPerUnit * cbmCost;
};

/**
 * Calculate shipping costs breakdown for different fulfillment strategies
 * 
 * @param params - Shipping calculation parameters
 * @param strategy - Fulfillment strategy ('direct', 'blended-30-70', 'blended-50-50', 'blended-70-30')
 * @returns Total shipping cost for the strategy
 */
export const calculateShippingByStrategy = (
  params: ShippingCalculationParams,
  strategy: 'direct' | 'blended-30-70' | 'blended-50-50' | 'blended-70-30'
): number => {
  const shipping = calculateShippingCosts(params);
  const { shippingToAMZ, shippingToAWD, awdReceivingCost, transferAWDToFBA, storageAWD } = shipping;

  // Determine if product is oversize for hazmat fee selection
  const lengthIn = (params.length || 0) / 2.54;
  const widthIn = (params.width || 0) / 2.54;
  const heightIn = (params.height || 0) / 2.54;
  const weightLb = (params.weight || 0) / 0.453592;
  const dims = [lengthIn, widthIn, heightIn].sort((a, b) => b - a);
  const [longest, median, shortest] = dims;
  const isOversize = weightLb > 20 || longest > 18 || median > 14 || shortest > 8;

  // Calculate Amazon FBA AVG fee properly (weighted average: 9 months non-peak + 3 months peak)
  // Use hazmat fees if hazmat is enabled
  let amazonFBAAVGFee: number;
  if (params.hazmat) {
    if (isOversize) {
      const nonPeak = params.hazmatOversizeStorageFeeNonPeak || 0.78;
      const peak = params.hazmatOversizeStorageFeePeak || 2.43;
      amazonFBAAVGFee = (nonPeak * 9 + peak * 3) / 12;
    } else {
      const nonPeak = params.hazmatStorageFeeNonPeak || 0.99;
      const peak = params.hazmatStorageFeePeak || 3.63;
      amazonFBAAVGFee = (nonPeak * 9 + peak * 3) / 12;
    }
  } else {
    const amazonFBAStorageFeeNonPeak = params.amazonFBAStorageFeeNonPeak || 0.78;
    const amazonFBAStorageFeePeak = params.amazonFBAStorageFeePeak || 2.4;
    amazonFBAAVGFee = (amazonFBAStorageFeeNonPeak * 9 + amazonFBAStorageFeePeak * 3) / 12;
  }
  const storageFBA = shipping.cbfPerUnit * amazonFBAAVGFee * (params.storageMonths || 0);

  switch (strategy) {
    case 'direct':
      return shippingToAMZ + storageFBA;
      
    case 'blended-30-70':
      return (0.3 * (shippingToAMZ + storageFBA)) + 
             (0.7 * (shippingToAWD + awdReceivingCost + transferAWDToFBA + storageAWD + storageFBA));
             
    case 'blended-50-50':
      return (0.5 * (shippingToAMZ + storageFBA)) + 
             (0.5 * (shippingToAWD + awdReceivingCost + transferAWDToFBA + storageAWD + storageFBA));
             
    case 'blended-70-30':
      return (0.7 * (shippingToAMZ + storageFBA)) + 
             (0.3 * (shippingToAWD + awdReceivingCost + transferAWDToFBA + storageAWD + storageFBA));
             
    default:
      return shippingToAMZ + storageFBA;
  }
};