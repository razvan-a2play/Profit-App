"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { Input } from "@platform/ui";
import { Label } from "@platform/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui";
import { calculateFbtFee, calculateFbtStorageCost, calculateFbtHubPlacementFee, getFbtFeeBreakdown, getFbtStorageBreakdown, getFbtPlacementBreakdown } from "@platform/calc";
import { calculateShippingCosts } from "@platform/calc";
import { calculateCBMPerUnit } from "@platform/calc";
import { calculateDimensionalWeight } from "@platform/calc";

interface TikTokFBTBreakdown {
  fbtFee: number;
  storageCost: number;
  placementFee: number;
  shippingCost: number;
  subtotal: number;
}

interface TikTokFBTCalculationProps {
  length: number;
  width: number;
  height: number;
  weight: number;
  masterCartonLength: number;
  masterCartonWidth: number;
  masterCartonHeight: number;
  masterCartonUnits: number;
  cbmCost: number;
  awdTransportationCost: number;
  shippingToAMZFromChina: number; // Already calculated: cbmPerUnit × cbmCost
  awdReceivingCost: number;
  additionalCosts?: number;
  onSubtotalChange?: (subtotal: number) => void;
  onBreakdownChange?: (breakdown: TikTokFBTBreakdown) => void;
}

const TikTokFBTCalculation: React.FC<TikTokFBTCalculationProps> = ({
  length,
  width,
  height,
  weight,
  masterCartonLength,
  masterCartonWidth,
  masterCartonHeight,
  masterCartonUnits,
  cbmCost,
  awdTransportationCost,
  shippingToAMZFromChina,
  awdReceivingCost,
  additionalCosts = 0,
  onSubtotalChange,
  onBreakdownChange
}) => {
  const [orderType, setOrderType] = useState<string>('single');
  const [fbtFee, setFbtFee] = useState<number>(5.71);
  const [storageDays, setStorageDays] = useState<number>(90);
  const [storageCostDuration, setStorageCostDuration] = useState<number>(0.2718);
  const [destination, setDestination] = useState<string>('direct');
  const [placementFee, setPlacementFee] = useState<number>(0);
  const [shippingOption, setShippingOption] = useState<string>('china');
  const [shippingCost, setShippingCost] = useState<number>(1.23);
  const [mcdCost, setMcdCost] = useState<number>(0.36);
  const [subtotal, setSubtotal] = useState<number>(0);

  // Calculate shipping weight based on TikTok FBT rules
  const shippingWeightCalc = useMemo(() => {
    // Convert dimensions from cm to inches
    const lengthIn = length / 2.54;
    const widthIn = width / 2.54;
    const heightIn = height / 2.54;
    
    // Calculate volume in cubic inches
    const volumeIn3 = lengthIn * widthIn * heightIn;
    
    // Calculate dimensional weight (divisor 166)
    const dimWeight = volumeIn3 / 166;
    
    // Determine shipping weight based on TikTok rules:
    // If actual weight ≤ 1 lb AND volume ≤ 166 in³ → use actual weight
    // Otherwise → use max(actual weight, dimensional weight)
    const useActualOnly = weight <= 1 && volumeIn3 <= 166;
    const shippingWeight = useActualOnly ? weight : Math.max(weight, dimWeight);
    
    return {
      lengthIn,
      widthIn,
      heightIn,
      volumeIn3,
      dimWeight,
      useActualOnly,
      shippingWeight
    };
  }, [length, width, height, weight]);

  useEffect(() => {
    // Calculate FBT Fee based on shipping weight and order type
    const calculatedFbtFee = calculateFbtFee(shippingWeightCalc.shippingWeight, orderType);
    setFbtFee(calculatedFbtFee);
  }, [shippingWeightCalc.shippingWeight, orderType]);

  useEffect(() => {
    // Calculate storage cost based on cubic feet and storage days
    const lengthIn = length / 2.54; // Convert cm to inches
    const widthIn = width / 2.54;
    const heightIn = height / 2.54;
    const cubicInches = lengthIn * widthIn * heightIn;
    const cubicFeet = cubicInches / 1728; // Convert to cubic feet
    
    const calculatedStorageCost = calculateFbtStorageCost(cubicFeet, storageDays);
    setStorageCostDuration(calculatedStorageCost);
  }, [length, width, height, storageDays]);

  useEffect(() => {
    // Calculate placement fee based on weight and destination
    const calculatedPlacementFee = calculateFbtHubPlacementFee(weight, destination);
    setPlacementFee(calculatedPlacementFee);
  }, [weight, destination]);

  useEffect(() => {
    if (shippingOption === 'awd') {
      // AWD Shipping Calculation: Greater of Actual Weight and Dim Weight per Unit (lbs) - Divisor 139
      let greaterWeight = weight; // Default to actual weight
      
      // Check if Master Carton Final Packing values are available
      if (masterCartonLength > 0 && masterCartonWidth > 0 && masterCartonHeight > 0 && masterCartonUnits > 0) {
        // Use Master Carton Final Packing - calculate dimensional weight per unit
        const dimCalc = calculateDimensionalWeight(masterCartonLength, masterCartonWidth, masterCartonHeight, 0);
        const dimWeightPerUnit = dimCalc.dimWeightLbs / masterCartonUnits;
        
        // Use the greater of actual weight or dimensional weight per unit
        greaterWeight = Math.max(weight, dimWeightPerUnit);
      } else if (length > 0 && width > 0 && height > 0 && weight > 0) {
        // Use individual product dimensions for dimensional weight
        const dimCalc = calculateDimensionalWeight(length, width, height, 0);
        const dimWeightPerUnit = dimCalc.dimWeightLbs; // Already per unit since using individual product dimensions
        
        // Use the greater of actual weight or dimensional weight per unit
        greaterWeight = Math.max(weight, dimWeightPerUnit);
      }
      
      // Calculate shipping cost: (Greater Weight × MCD Cost) + Shipping to AMZ from China + AWD Receiving cost
      const calculatedShippingCost = (greaterWeight * mcdCost) + shippingToAMZFromChina + awdReceivingCost;
      
      setShippingCost(Math.round(calculatedShippingCost * 100) / 100);
    } else if (shippingOption === 'china') {
      // For China, use the already-calculated shipping cost directly
      setShippingCost(Math.round(shippingToAMZFromChina * 100) / 100);
    }
  }, [shippingOption, length, width, height, weight, masterCartonLength, masterCartonWidth, masterCartonHeight, masterCartonUnits, cbmCost, awdTransportationCost, shippingToAMZFromChina, awdReceivingCost, mcdCost]);

  useEffect(() => {
    // Calculate subtotal (excluding MCD Cost)
    const total = fbtFee + storageCostDuration + placementFee + shippingCost;
    setSubtotal(Math.round(total * 100) / 100);
    
    // Notify parent component of subtotal change
    if (onSubtotalChange) {
      onSubtotalChange(Math.round(total * 100) / 100);
    }
    
    // Notify parent component of breakdown change
    if (onBreakdownChange) {
      onBreakdownChange({
        fbtFee: Math.round(fbtFee * 100) / 100,
        storageCost: Math.round(storageCostDuration * 100) / 100,
        placementFee: Math.round(placementFee * 100) / 100,
        shippingCost: Math.round(shippingCost * 100) / 100,
        subtotal: Math.round(total * 100) / 100
      });
    }
  }, [fbtFee, storageCostDuration, placementFee, shippingCost, onSubtotalChange, onBreakdownChange]);

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">TikTok FBT Calculation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Order Type */}
          <div className="space-y-2">
            <Label htmlFor="orderType">Order Type</Label>
            <Select value={orderType} onValueChange={setOrderType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single</SelectItem>
                <SelectItem value="multiple">Multiple</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* FBT Fee */}
          <div className="space-y-2">
            <Label htmlFor="fbtFee">FBT Fee ($)</Label>
            <Input
              id="fbtFee"
              type="number"
              step="0.01"
              value={fbtFee}
              readOnly
              className="bg-muted"
            />
            {(() => {
              const { lengthIn, widthIn, heightIn, volumeIn3, dimWeight, useActualOnly, shippingWeight } = shippingWeightCalc;
              const breakdown = getFbtFeeBreakdown(shippingWeight, orderType);
              const orderLabel = orderType === 'single' ? 'Single' : 'Multi';
              
              return (
                <div className="text-xs text-muted-foreground space-y-1">
                  {/* Shipping Weight Calculation */}
                  <p><strong>Shipping Weight Calc:</strong></p>
                  <p>Volume: {lengthIn.toFixed(2)} × {widthIn.toFixed(2)} × {heightIn.toFixed(2)} = {volumeIn3.toFixed(2)} in³</p>
                  <p>Dim Weight: {volumeIn3.toFixed(2)} ÷ 166 = {dimWeight.toFixed(2)} lbs</p>
                  {useActualOnly ? (
                    <p className="text-green-600">Actual ≤ 1 lb & Vol ≤ 166 in³ → <strong>Use Actual: {shippingWeight.toFixed(2)} lbs</strong></p>
                  ) : (
                    <p>max({weight.toFixed(2)}, {dimWeight.toFixed(2)}) = <strong>{shippingWeight.toFixed(2)} lbs</strong></p>
                  )}
                  
                  {/* FBT Fee Calculation */}
                  {!breakdown ? (
                    <p>No matching weight bracket</p>
                  ) : shippingWeight >= 21 && shippingWeight < 51 ? (
                    <>
                      <p><strong>Fee (21-51 lbs):</strong> $18.00 + $0.40 × ({shippingWeight.toFixed(2)} - 21) = <strong>${fbtFee.toFixed(2)}</strong></p>
                    </>
                  ) : shippingWeight >= 51 ? (
                    <>
                      <p><strong>Fee (51+ lbs):</strong> $41.32 + $0.75 × ({shippingWeight.toFixed(2)} - 51) = <strong>${fbtFee.toFixed(2)}</strong></p>
                    </>
                  ) : (
                    <p><strong>Fee:</strong> [{breakdown.from}-{breakdown.to ?? '∞'}] lbs → {orderLabel} = <strong>${breakdown.fee}</strong></p>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Storage Days */}
          <div className="space-y-2">
            <Label htmlFor="storageDays">Storage Days</Label>
            <Input
              id="storageDays"
              type="number"
              value={storageDays}
              onChange={(e) => setStorageDays(parseInt(e.target.value) || 0)}
            />
          </div>

          {/* Storage Cost/Duration */}
          <div className="space-y-2">
            <Label htmlFor="storageCostDuration">Storage Cost/Duration ($)</Label>
            <Input
              id="storageCostDuration"
              type="number"
              step="0.0001"
              value={storageCostDuration}
              readOnly
              className="bg-muted"
            />
            {(() => {
              const lengthIn = length / 2.54;
              const widthIn = width / 2.54;
              const heightIn = height / 2.54;
              const cubicFeet = (lengthIn * widthIn * heightIn) / 1728;
              const breakdown = getFbtStorageBreakdown(storageDays);
              return breakdown ? (
                <p className="text-xs text-muted-foreground">
                  {cubicFeet.toFixed(4)} cu.ft × {storageDays} days × ${breakdown.rate}/day (days {breakdown.fromDay}-{breakdown.toDay ?? '∞'}) = ${storageCostDuration.toFixed(4)}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">cu.ft from product dimensions × days × rate</p>
              );
            })()}
          </div>

          {/* Destination */}
          <div className="space-y-2">
            <Label htmlFor="destination">Destination</Label>
            <Select value={destination} onValueChange={setDestination}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">Direct</SelectItem>
                <SelectItem value="west">West Hub</SelectItem>
                <SelectItem value="east">East Hub</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Placement Fee */}
          <div className="space-y-2">
            <Label htmlFor="placementFee">Placement Fee ($)</Label>
            <Input
              id="placementFee"
              type="number"
              step="0.01"
              value={placementFee}
              readOnly
              className="bg-muted"
            />
            {(() => {
              const breakdown = getFbtPlacementBreakdown(weight, destination);
              if (destination === 'direct') {
                return <p className="text-xs text-muted-foreground">Direct shipping = Free</p>;
              }
              return breakdown ? (
                <p className="text-xs text-muted-foreground">
                  Weight {weight.toFixed(2)} lbs in [{breakdown.from}-{breakdown.to ?? '∞'}] → {destination.charAt(0).toUpperCase() + destination.slice(1)} = ${typeof breakdown.fee === 'number' ? breakdown.fee.toFixed(2) : breakdown.fee}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Based on weight and destination hub</p>
              );
            })()}
          </div>

          {/* Shipping Option */}
          <div className="space-y-2">
            <Label htmlFor="shippingOption">Shipping From</Label>
            <Select value={shippingOption} onValueChange={setShippingOption}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="awd">AWD</SelectItem>
                <SelectItem value="china">China</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Shipping Cost */}
          <div className="space-y-2">
            <Label htmlFor="shippingCost">Shipping Cost ($)</Label>
            <Input
              id="shippingCost"
              type="number"
              step="0.01"
              value={shippingCost}
              readOnly
              className="bg-muted"
            />
            {(() => {
              if (shippingOption === 'china') {
                return (
                  <p className="text-xs text-muted-foreground">
                    CBM per unit × CBM Cost = ${shippingToAMZFromChina.toFixed(2)}
                  </p>
                );
              } else {
                // AWD calculation
                let dimWeightPerUnit = 0;
                if (masterCartonLength > 0 && masterCartonWidth > 0 && masterCartonHeight > 0 && masterCartonUnits > 0) {
                  const dimCalc = calculateDimensionalWeight(masterCartonLength, masterCartonWidth, masterCartonHeight, 0);
                  dimWeightPerUnit = dimCalc.dimWeightLbs / masterCartonUnits;
                } else if (length > 0 && width > 0 && height > 0) {
                  const dimCalc = calculateDimensionalWeight(length, width, height, 0);
                  dimWeightPerUnit = dimCalc.dimWeightLbs;
                }
                const greaterWeight = Math.max(weight, dimWeightPerUnit);
                return (
                  <p className="text-xs text-muted-foreground">
                    max({weight.toFixed(2)}, {dimWeightPerUnit.toFixed(2)}) × ${mcdCost} + ${shippingToAMZFromChina.toFixed(2)} + ${awdReceivingCost.toFixed(2)} = ${shippingCost.toFixed(2)}
                  </p>
                );
              }
            })()}
          </div>

          {/* MCD Cost */}
          <div className="space-y-2">
            <Label htmlFor="mcdCost">MCD Cost ($)</Label>
            <Input
              id="mcdCost"
              type="number"
              step="0.01"
              value={mcdCost}
              onChange={(e) => setMcdCost(e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>

        {/* Subtotal */}
        <div className="mt-6 pt-4 border-t">
          <div className="flex justify-between items-center">
            <Label className="text-lg font-semibold">SUBTOTAL:</Label>
            <span className="text-lg font-semibold">${subtotal.toFixed(2)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default TikTokFBTCalculation;