/**
 * Centralized CBM (Cubic Meter) and CBF (Cubic Feet) calculation utilities
 * 
 * This module provides consistent volume calculations to eliminate code duplication
 * and ensure all calculations follow the same business logic hierarchy.
 */

import { optimizeCarton } from './cartonOptimization';

/**
 * Product dimension interface for calculations
 */
export interface ProductDimensions {
  // Individual product dimensions
  length?: number;
  width?: number;
  height?: number;
  weight?: number;
  
  // Master carton final packing dimensions (manual input)
  masterCartonLength?: number;
  masterCartonWidth?: number;
  masterCartonHeight?: number;
  masterCartonUnits?: number;
}

/**
 * CBM calculation result interface
 */
export interface CBMCalculationResult {
  cbmPerUnit: number;
  cbfPerUnit: number;
  units: number;
  calculationSource: 'master-carton' | 'optimization' | 'none';
  sourceDescription: string;
}

/**
 * Calculate CBM per unit following the standard hierarchy:
 * 1. Master Carton Final Packing (manual input) - Priority 1
 * 2. Master Carton Optimization (auto-calculated) - Priority 2
 * 3. Fallback to 0 - Priority 3
 * 
 * @param dimensions - Product dimensions object
 * @param calculatorMode - Optional mode for priority adjustment ('pre-launch' prefers optimization)
 * @returns CBM calculation result with source information
 */
export const calculateCBMPerUnit = (
  dimensions: ProductDimensions, 
  calculatorMode?: 'pre-launch' | 'legacy' | null
): CBMCalculationResult => {
  const {
    length = 0,
    width = 0,
    height = 0,
    weight = 0,
    masterCartonLength = 0,
    masterCartonWidth = 0,
    masterCartonHeight = 0,
    masterCartonUnits = 0
  } = dimensions;

  // Memoize carton optimization to avoid redundant calls
  let optimized = null;
  if (length > 0 && width > 0 && height > 0 && weight > 0) {
    optimized = optimizeCarton(length, width, height, weight);
  }

  // For R&D mode (pre-launch), prefer optimization over manual input
  if (calculatorMode === 'pre-launch') {
    // Try optimization first (use already calculated result)
    if (optimized) {
      return {
        cbmPerUnit: optimized.cbmPerUnit,
        cbfPerUnit: optimized.cbfPerUnit,
        units: optimized.units,
        calculationSource: 'optimization',
        sourceDescription: `Master Carton Optimization (R&D): ${optimized.l}cm × ${optimized.w}cm × ${optimized.h}cm ÷ 1,000,000 ÷ ${optimized.units} units = ${optimized.cbmPerUnit.toFixed(8)} CBM per unit`
      };
    }
    
    // Fallback to manual input
    if (masterCartonLength > 0 && masterCartonWidth > 0 && masterCartonHeight > 0 && masterCartonUnits > 0) {
      const cbmPerUnit = ((masterCartonLength * masterCartonWidth * masterCartonHeight) / 1000000) / masterCartonUnits;
      const cbfPerUnit = cbmPerUnit * 35.3147;
      
      return {
        cbmPerUnit,
        cbfPerUnit,
        units: masterCartonUnits,
        calculationSource: 'master-carton',
        sourceDescription: `Master Carton Final Packing (R&D fallback): ${masterCartonLength}cm × ${masterCartonWidth}cm × ${masterCartonHeight}cm ÷ 1,000,000 ÷ ${masterCartonUnits} units = ${cbmPerUnit.toFixed(8)} CBM per unit`
      };
    }
  } else {
    // Default priority: Master Carton Final Packing first
    if (masterCartonLength > 0 && masterCartonWidth > 0 && masterCartonHeight > 0 && masterCartonUnits > 0) {
      const cbmPerUnit = ((masterCartonLength * masterCartonWidth * masterCartonHeight) / 1000000) / masterCartonUnits;
      const cbfPerUnit = cbmPerUnit * 35.3147;
      
      return {
        cbmPerUnit,
        cbfPerUnit,
        units: masterCartonUnits,
        calculationSource: 'master-carton',
        sourceDescription: `Master Carton Final Packing (Live): ${masterCartonLength}cm × ${masterCartonWidth}cm × ${masterCartonHeight}cm ÷ 1,000,000 ÷ ${masterCartonUnits} units = ${cbmPerUnit.toFixed(8)} CBM per unit`
      };
    }
    
    // Fallback to optimization (use already calculated result)
    if (optimized) {
      return {
        cbmPerUnit: optimized.cbmPerUnit,
        cbfPerUnit: optimized.cbfPerUnit,
        units: optimized.units,
        calculationSource: 'optimization',
        sourceDescription: `Master Carton Optimization (Live fallback): ${optimized.l}cm × ${optimized.w}cm × ${optimized.h}cm ÷ 1,000,000 ÷ ${optimized.units} units = ${optimized.cbmPerUnit.toFixed(8)} CBM per unit`
      };
    }
  }

  // Final fallback
  return {
    cbmPerUnit: 0,
    cbfPerUnit: 0,
    units: 0,
    calculationSource: 'none',
    sourceDescription: 'No valid dimensions available for CBM calculation'
  };
};

/**
 * Calculate individual product CBM (not per unit, but total product volume)
 * Used for direct product volume calculations
 * 
 * @param length - Product length in centimeters
 * @param width - Product width in centimeters  
 * @param height - Product height in centimeters
 * @returns CBM value for individual product
 */
export const calculateProductCBM = (length: number, width: number, height: number): number => {
  if (length <= 0 || width <= 0 || height <= 0) return 0;
  return (length / 100) * (width / 100) * (height / 100); // Convert cm to meters
};

/**
 * Calculate individual product CBF (not per unit, but total product volume)
 * Used for direct product volume calculations
 * 
 * @param length - Product length in centimeters
 * @param width - Product width in centimeters
 * @param height - Product height in centimeters  
 * @returns CBF value for individual product
 */
export const calculateProductCBF = (length: number, width: number, height: number): number => {
  if (length <= 0 || width <= 0 || height <= 0) return 0;
  return ((length * width * height) / 1000000) * 35.3147;
};

/**
 * Quick CBM per unit calculation for simple use cases
 * Uses default priority (Master Carton > Optimization > Fallback)
 * 
 * @param dimensions - Product dimensions
 * @returns Just the CBM per unit number
 */
export const getCBMPerUnit = (dimensions: ProductDimensions): number => {
  return calculateCBMPerUnit(dimensions).cbmPerUnit;
};

/**
 * Quick CBF per unit calculation for simple use cases
 * Uses default priority (Master Carton > Optimization > Fallback)
 * 
 * @param dimensions - Product dimensions
 * @returns Just the CBF per unit number
 */
export const getCBFPerUnit = (dimensions: ProductDimensions): number => {
  return calculateCBMPerUnit(dimensions).cbfPerUnit;
};

/**
 * Constants for volume conversions
 */
export const VOLUME_CONSTANTS = {
  CBM_TO_CBF: 35.3147,
  CM3_TO_CBM: 1000000,
  CUBIC_INCHES_TO_CBM: 0.0000163871,
  CUBIC_INCHES_TO_CBF: 1728
} as const;