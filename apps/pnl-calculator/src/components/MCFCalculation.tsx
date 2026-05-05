"use client";

import React, { useState, useEffect } from 'react';
import { Input } from "@platform/ui";
import { Label } from "@platform/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import {
  calculateCBMPerUnit,
  calculateDimensionalWeight,
  calculateFBATierAndFee,
  calculateShippingCosts,
} from "@platform/calc";

interface MCFCalculationProps {
  length: number;
  width: number;
  height: number;
  weight: number;
  masterCartonLength: number;
  masterCartonWidth: number;
  masterCartonHeight: number;
  masterCartonUnits: number;
  amazonFBAAVGFee: number;
  cbmCost: number;
  shippingToAWD: number;
  awdCaseReceiveCost: number;
  amazonAWDStorageFee: number;
  storageMonths: number;
  additionalCosts?: number;
  onMCFFeeChange?: (fee: number) => void;
  onStorageFeeChange?: (fee: number) => void;
  mode?: 'tiktok' | 'shopify'; // New prop to differentiate sections
}

// Updated MCF Fee Data based on STANDARD 3 business-day delivery table
const MCF_FEES = {
  'small standard': {
    'standard': {
      '≤4 oz': [7.34, 4.98, 4.10, 3.64],
      '4+ to 8 oz': [7.51, 5.09, 4.19, 3.72],
      '8+ to 12 oz': [8.17, 5.68, 4.72, 4.23],
      '12+ to 16 oz': [8.66, 5.90, 4.88, 4.38]
    }
  },
  'large standard': {
    'standard': {
      '≤4 oz': [7.56, 5.12, 4.40, 4.00],
      '4+ to 8 oz': [7.72, 5.23, 4.49, 4.08],
      '8+ to 12 oz': [8.61, 6.00, 4.90, 4.50],
      '12+ to 16 oz': [8.93, 6.26, 5.15, 4.70],
      '1+ to 2 lb': [10.64, 7.19, 5.90, 5.25],
      '2+ to 3 lb': [11.75, 8.13, 6.79, 5.95],
      '3+ lb': 'formula' // Special handling for 3+ to 20 lbs
    }
  },
  'small bulky': {
    'standard': {
      'up to 30 lb': 'formula' // Special handling
    }
  },
  'large bulky': {
    'standard': {
      'up to 30 lb': 'formula', // Special handling
      'above 30 lb': 'formula'  // Special handling
    }
  },
  'extra large': {
    'standard': {
      'up to 50 lb': 'formula',     // Special handling
      '50+ to 70 lb': 'formula',    // Special handling
      '70+ to 150 lb': 'formula',   // Special handling
      'above 150 lb': 'formula'     // Special handling
    }
  }
};

function calculateMCFFee(sizeTier: string, weightLb: number, unitCount: number, speed: string = "standard"): number {
  const normalizedSizeTier = sizeTier.toLowerCase();
  const normalizedSpeed = speed.toLowerCase();
  const weightOz = weightLb * 16;
  
  // Get the fee structure for this size tier and speed
  const sizeData = MCF_FEES[normalizedSizeTier as keyof typeof MCF_FEES];
  if (!sizeData) return 0;
  
  // If expedited is selected but no expedited pricing exists, fall back to standard
  let speedData = sizeData[normalizedSpeed as keyof typeof sizeData];
  if (!speedData && normalizedSpeed === 'expedited') {
    speedData = sizeData['standard'];
  }
  if (!speedData) return 0;
  
  // Handle special formula cases for Large Standard 3+ to 20 lbs
  if (normalizedSizeTier === 'large standard' && weightLb > 3) {
    const baseFees = [11.75, 8.13, 6.79, 5.95];
    const overageRates = [0.70, 0.65, 0.63, 0.63]; // Per lb above 3 lb
    const excessWeight = weightLb - 3;
    const unitIndex = Math.min(unitCount - 1, 3);
    return baseFees[unitIndex] + (overageRates[unitIndex] * excessWeight);
  }
  
  // Handle Small Bulky formulas (up to 30 lb)
  if (normalizedSizeTier === 'small bulky') {
    const unitIndex = Math.min(unitCount - 1, 3);
    const baseFees = [18.08, 13.32, 11.49, 9.73];
    const overageRates = [0.75, 0.70, 0.70, 0.70]; // Per lb above 2 lb
    const excessWeight = Math.max(0, weightLb - 2);
    return baseFees[unitIndex] + (overageRates[unitIndex] * excessWeight);
  }
  
  // Handle Large Bulky formulas
  if (normalizedSizeTier === 'large bulky') {
    const unitIndex = Math.min(unitCount - 1, 3);
    
    if (weightLb <= 30) {
      // Up to 30 lbs formula
      const baseFees = [18.43, 13.58, 11.72, 9.92];
      const overageRates = [0.77, 0.71, 0.71, 0.71]; // Per lb above 2 lb
      const excessWeight = Math.max(0, weightLb - 2);
      return baseFees[unitIndex] + (overageRates[unitIndex] * excessWeight);
    } else {
      // Above 30 lbs - same rate for all unit counts
      const excessWeight = weightLb - 30;
      return 39.89 + (0.77 * excessWeight);
    }
  }
  
  // Handle Extra Large formulas (same price regardless of unit count)
  if (normalizedSizeTier === 'extra large') {
    if (weightLb <= 50) {
      const excessWeight = Math.max(0, weightLb - 1);
      return 32.17 + (0.62 * excessWeight);
    } else if (weightLb <= 70) {
      const excessWeight = weightLb - 51;
      return 62.64 + (1.01 * excessWeight);
    } else if (weightLb <= 150) {
      const excessWeight = weightLb - 71;
      return 84.66 + (1.41 * excessWeight);
    } else {
      const excessWeight = weightLb - 151;
      return 253.97 + (1.69 * excessWeight);
    }
  }
  
  // Find the correct weight tier for standard pricing
  for (const [weightTier, fees] of Object.entries(speedData)) {
    if (fees !== 'formula' && matchesWeightTier(weightTier, weightLb, weightOz)) {
      const unitIndex = Math.min(unitCount - 1, 3); // Max index is 3 for 4+ units
      return (fees as number[])[unitIndex] || 0;
    }
  }
  
  return 0;
}

function matchesWeightTier(weightTier: string, weightLb: number, weightOz: number): boolean {
  const tier = weightTier.toLowerCase().trim();
  
  // Handle "≤" symbol (less than or equal)
  if (tier.includes('≤')) {
    const match = tier.match(/≤\s*([\d.]+)\s*(oz|lb)/);
    if (match) {
      const value = parseFloat(match[1]);
      const unit = match[2];
      if (unit === 'oz') return weightOz <= value;
      if (unit === 'lb') return weightLb <= value;
    }
  }
  
  // Handle "+" to range patterns (e.g., "2+ to 4 oz")
  if (tier.includes('+ to')) {
    const match = tier.match(/([\d.]+)\+\s*to\s*([\d.]+)\s*(oz|lb)/);
    if (match) {
      const min = parseFloat(match[1]);
      const max = parseFloat(match[2]);
      const unit = match[3];
      if (unit === 'oz') return weightOz > min && weightOz <= max;
      if (unit === 'lb') return weightLb > min && weightLb <= max;
    }
  }
  
  // Handle "+" only patterns (e.g., "3+ lb")
  if (tier.includes('+') && !tier.includes('to')) {
    const match = tier.match(/([\d.]+)\+\s*(oz|lb)/);
    if (match) {
      const value = parseFloat(match[1]);
      const unit = match[2];
      if (unit === 'oz') return weightOz > value;
      if (unit === 'lb') return weightLb > value;
    }
  }
  
  return false;
}

const MCFCalculation: React.FC<MCFCalculationProps> = ({ 
  length, 
  width, 
  height, 
  weight, 
  masterCartonLength,
  masterCartonWidth,
  masterCartonHeight,
  masterCartonUnits,
  amazonFBAAVGFee, 
  cbmCost,
  shippingToAWD,
  awdCaseReceiveCost,
  amazonAWDStorageFee,
  storageMonths: initialStorageMonths,
  additionalCosts = 0,
  onMCFFeeChange,
  onStorageFeeChange,
  mode = 'tiktok' // Default to tiktok mode for backward compatibility
}) => {
  const [unitCount, setUnitCount] = useState(1);
  const [speed, setSpeed] = useState('standard');
  const [storageMonths, setStorageMonths] = useState(initialStorageMonths || 1);
  const [mcfFee, setMcfFee] = useState(0);
  const [storageFee, setStorageFee] = useState(0);
  const [shippingToAMZ, setShippingToAMZ] = useState(0);
  const [shippingToAWDCost, setShippingToAWDCost] = useState(0);
  const [awdReceivingCost, setAwdReceivingCost] = useState(0);
  const [storageAWDCost, setStorageAWDCost] = useState(0);
  const [shippingStorageTotal, setShippingStorageTotal] = useState(0);

  // Get size tier from FBA calculation (sellingPrice = 0 since we only need tier classification)
  const fbaResult = calculateFBATierAndFee(length, width, height, weight, 0);
  const sizeTier = fbaResult.tier;
  
  // Calculate shipping weight (greater of actual weight or dimensional weight)
  // Add safety checks for undefined/null values
  const safeLength = length || 0;
  const safeWidth = width || 0;
  const safeHeight = height || 0;
  const safeWeight = weight || 0;
  
  // Use centralized dimensional weight calculation
  const dimCalc = calculateDimensionalWeight(safeLength, safeWidth, safeHeight, safeWeight);
  const shippingWeightLb = dimCalc.shippingWeightLbs;
  const cubicInches = dimCalc.cubicInches; // Keep for storage calculations

  useEffect(() => {
    if (sizeTier !== 'Unknown' && weight > 0) {
      const fee = calculateMCFFee(sizeTier, shippingWeightLb, unitCount, speed);
      setMcfFee(fee);
      onMCFFeeChange?.(fee);
    } else {
      setMcfFee(0);
      onMCFFeeChange?.(0);
    }
  }, [sizeTier, shippingWeightLb, unitCount, speed, weight, onMCFFeeChange]);

  useEffect(() => {
    // Calculate storage fee: months * FBA avg fee per CBF
    // Add safety checks for all values
    const safeCubicInches = cubicInches || 0;
    const safeAmazonFBAAVGFee = amazonFBAAVGFee || 0;
    const safeStorageMonths = storageMonths || 0;
    
    const cubicFeet = safeCubicInches / 1728; // Convert cubic inches to cubic feet
    const storage = safeStorageMonths * safeAmazonFBAAVGFee * cubicFeet;
    setStorageFee(storage);
    onStorageFeeChange?.(storage);
  }, [storageMonths, amazonFBAAVGFee, cubicInches, onStorageFeeChange]);

  useEffect(() => {
    // Calculate shipping costs using centralized function
    const shippingCalculation = calculateShippingCosts({
      length,
      width,
      height,
      weight,
      masterCartonLength,
      masterCartonWidth,
      masterCartonHeight,
      masterCartonUnits,
      cbmCost,
      shippingToAWD,
      awdCaseReceiveCost,
      amazonAWDStorageFee,
      storageMonths
    });
    
    const {
      shippingToAMZ: calculatedShippingToAMZ,
      shippingToAWD: calculatedShippingToAWDCost,
      awdReceivingCost: calculatedAwdReceivingCost,
      storageAWD: calculatedStorageAWDCost
    } = shippingCalculation;
    
    setShippingToAMZ(calculatedShippingToAMZ);
    setShippingToAWDCost(calculatedShippingToAWDCost);
    setAwdReceivingCost(calculatedAwdReceivingCost);
    setStorageAWDCost(calculatedStorageAWDCost);
    
    const total = calculatedShippingToAMZ + calculatedShippingToAWDCost + calculatedAwdReceivingCost + calculatedStorageAWDCost;
    setShippingStorageTotal(total);
  }, [masterCartonLength, masterCartonWidth, masterCartonHeight, masterCartonUnits, length, width, height, weight, cbmCost, shippingToAWD, awdCaseReceiveCost, amazonAWDStorageFee, storageMonths]);

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="text-accent">
          Amazon MCF Calculation
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <Label>Size Tier (from FBA)</Label>
              <Input
                value={sizeTier}
                readOnly
                className="bg-muted"
              />
            </div>
            <div>
              <Label>Unit Count</Label>
              <Input
                type="number"
                min="1"
                max="4"
                value={unitCount}
                onChange={(e) => setUnitCount(Math.max(1, Math.min(4, parseInt(e.target.value) || 1)))}
              />
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <Label>Speed</Label>
              <Select value={speed} onValueChange={setSpeed}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="expedited">Expedited</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>MCF Fee</Label>
              <Input
                value={`$${mcfFee.toFixed(2)}`}
                readOnly
                className="bg-muted font-semibold text-lg"
              />
              {speed === 'expedited' && (
                <div className="mt-1 text-xs text-amber-600">
                  * Using standard pricing (expedited rates not available)
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Storage Calculation Section */}
        <div className="mt-6 pt-6 border-t">
          <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-4">
            Storage Calculation
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Storage Months</Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={storageMonths}
                onChange={(e) => setStorageMonths(Math.max(1, parseInt(e.target.value) || 1))}
              />
            </div>
            <div>
              <Label>Amazon FBA AVG Fee (per CBF)</Label>
              <Input
                type="number"
                step="0.01"
                value={amazonFBAAVGFee}
                readOnly
                className="bg-muted"
                title="Value taken from Fees Configuration"
              />
            </div>
            <div>
              <Label>Storage Fee</Label>
              <Input
                value={`$${storageFee.toFixed(2)}`}
                readOnly
                className="bg-muted font-semibold text-lg"
              />
            </div>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Storage Fee = {storageMonths} months × ${(amazonFBAAVGFee || 0).toFixed(2)}/CBF × {((cubicInches || 0) / 1728).toFixed(4)} CBF
          </div>
        </div>

        {/* Shipping & Storage Section */}
        <div className="mt-6 pt-6 border-t">
          <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-4">
            Shipping & Storage
          </h4>
          {mode === 'shopify' ? (
            // Shopify mode: Show only Shipping to AMZ
            <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
              <div>
                <Label>Shipping to AMZ</Label>
                <Input
                  type="text"
                  value={`$${shippingToAMZ.toFixed(2)}`}
                  readOnly
                  className="bg-muted"
                  title="Value taken from Shipping & Storage section"
                />
              </div>
            </div>
          ) : (
            // TikTok mode: Show all fields
            <>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div>
                  <Label>Shipping to AMZ</Label>
                  <Input
                    type="text"
                    value={`$${shippingToAMZ.toFixed(2)}`}
                    readOnly
                    className="bg-muted"
                    title="Value taken from Shipping & Storage section"
                  />
                </div>
                <div>
                  <Label>Shipping to AWD</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={shippingToAWDCost.toFixed(2)}
                    readOnly
                    className="bg-muted"
                    title="Value calculated using CBM Cost to AWD"
                  />
                </div>
                <div>
                  <Label>AWD Receiving Cost</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={awdReceivingCost.toFixed(2)}
                    readOnly
                    className="bg-muted"
                    title="Value taken from Shipping & Storage section"
                  />
                </div>
                <div>
                  <Label>Storage AWD</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={storageAWDCost.toFixed(2)}
                    readOnly
                    className="bg-muted"
                    title="Value taken from Shipping & Storage section"
                  />
                </div>
                <div>
                  <Label>Total</Label>
                  <Input
                    value={`$${shippingStorageTotal.toFixed(2)}`}
                    readOnly
                    className="bg-muted font-semibold text-lg"
                  />
                </div>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Total = ${shippingToAMZ.toFixed(2)} (shipping to AMZ) + ${shippingToAWDCost.toFixed(2)} (shipping to AWD) + ${awdReceivingCost.toFixed(2)} (AWD receiving) + ${storageAWDCost.toFixed(2)} (storage AWD)
              </div>
            </>
          )}
        </div>
        
        {sizeTier === 'Unknown' && weight > 0 && (
          <div className="mt-4 p-3 bg-destructive/10 border border-destructive rounded-md">
            <p className="text-destructive text-sm">
              Unable to determine size tier. Please check product dimensions.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MCFCalculation;
