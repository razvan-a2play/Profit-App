/**
 * Centralized dimensional weight calculations using 139 divisor
 * This ensures consistent calculations across all components
 */

export interface DimensionalWeightResult {
  dimWeightLbs: number;
  dimWeightKg: number;
  dimWeightOz: number;
  shippingWeightLbs: number;
  shippingWeightOz: number;
  chargeableWeightLbs: number;
  cubicInches: number;
  formula: string;
}

/**
 * Calculate dimensional weight using 139 divisor from cubic inches
 * @param length - Length in cm
 * @param width - Width in cm  
 * @param height - Height in cm
 * @param weight - Weight in kg
 * @returns Dimensional weight calculation results
 */
export function calculateDimensionalWeight(
  length: number, 
  width: number, 
  height: number, 
  weight: number
): DimensionalWeightResult {
  // Convert cm to inches
  const lengthIn = length / 2.54;
  const widthIn = width / 2.54;
  const heightIn = height / 2.54;
  
  // Convert kg to pounds
  const weightLbs = weight * 2.20462;
  
  // Calculate cubic inches
  const cubicInches = lengthIn * widthIn * heightIn;
  
  // Calculate dimensional weight using 139 divisor from inches
  const dimWeightLbs = cubicInches / 139;
  const dimWeightKg = dimWeightLbs / 2.20462;
  const dimWeightOz = dimWeightLbs * 16;
  
  // Shipping weight is the greater of actual weight or dimensional weight
  const shippingWeightLbs = Math.max(weightLbs, dimWeightLbs);
  const shippingWeightOz = shippingWeightLbs * 16;
  
  // Chargeable weight (same as shipping weight in most cases)
  const chargeableWeightLbs = shippingWeightLbs;
  
  // Formula string for display
  const formula = `${cubicInches.toFixed(2)} in³ ÷ 139`;
  
  return {
    dimWeightLbs,
    dimWeightKg,
    dimWeightOz,
    shippingWeightLbs,
    shippingWeightOz,
    chargeableWeightLbs,
    cubicInches,
    formula
  };
}

/**
 * Calculate dimensional weight per unit for carton calculations
 * @param length - Unit length in cm
 * @param width - Unit width in cm
 * @param height - Unit height in cm
 * @param weight - Unit weight in kg
 * @param unitsPerCarton - Number of units per carton
 * @returns Dimensional weight per unit in lbs
 */
export function calculateDimensionalWeightPerUnit(
  length: number,
  width: number, 
  height: number,
  weight: number,
  unitsPerCarton: number
): number {
  if (unitsPerCarton <= 0) return 0;
  
  const result = calculateDimensionalWeight(length, width, height, weight);
  return result.dimWeightLbs / unitsPerCarton;
}

/**
 * Get the greater weight between actual and dimensional weight
 * @param length - Length in cm
 * @param width - Width in cm
 * @param height - Height in cm
 * @param weight - Weight in kg
 * @returns Greater weight in lbs
 */
export function getGreaterWeight(
  length: number,
  width: number,
  height: number,
  weight: number
): number {
  const result = calculateDimensionalWeight(length, width, height, weight);
  return result.shippingWeightLbs;
}