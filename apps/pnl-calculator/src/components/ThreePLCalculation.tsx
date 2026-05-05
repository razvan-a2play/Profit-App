"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { Input } from "@platform/ui";
import { Label } from "@platform/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@platform/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@platform/ui";
import { Info } from 'lucide-react';

interface ThreePLCalculationProps {
  length?: number;
  width?: number;
  height?: number;
  weight?: number;
  sellingPrice?: number;
  cbmCost?: number;
  cbmPerUnit?: number;
  selectedWarehouse?: 'stephen' | 'inandout';
  masterCartonUnits?: number;
  onUpdateFee?: (fee: number) => void;
  onUpdateStorageFee?: (storageFee: number) => void;
  onUpdateTotalFee?: (totalFee: number) => void;
}

const ThreePLCalculation: React.FC<ThreePLCalculationProps> = ({
  length = 0,
  width = 0,
  height = 0,
  weight = 0,
  sellingPrice = 0,
  cbmCost = 0,
  cbmPerUnit = 0,
  selectedWarehouse = 'stephen',
  masterCartonUnits = 1,
  onUpdateFee,
  onUpdateStorageFee,
  onUpdateTotalFee
}) => {
  const [selectedCarrier, setSelectedCarrier] = React.useState<'UPS' | 'USPS'>('UPS');
  const [storageDays, setStorageDays] = React.useState<number>(30);
  const [avgDailyQuantity, setAvgDailyQuantity] = React.useState<number>(10);

  // UPS shipping cost tables
  const UPS_RATES_OZ = [
    { weight: 1, cost: 4.04125 },
    { weight: 2, cost: 4.08625 },
    { weight: 3, cost: 4.11875 },
    { weight: 4, cost: 4.1475 },
    { weight: 5, cost: 4.21125 },
    { weight: 6, cost: 4.24625 },
    { weight: 7, cost: 4.28375 },
    { weight: 8, cost: 4.31 },
    { weight: 9, cost: 4.59875 },
    { weight: 10, cost: 4.6325 },
    { weight: 11, cost: 4.6675 },
    { weight: 12, cost: 4.69875 },
    { weight: 13, cost: 5.04 },
    { weight: 14, cost: 5.0775 },
    { weight: 15, cost: 5.11125 },
    { weight: 15.99, cost: 5.14375 }
  ];

  const UPS_RATES_LB = [
    { weight: 1, cost: 6.01 },
    { weight: 2, cost: 6.73625 },
    { weight: 3, cost: 7.33625 },
    { weight: 4, cost: 7.93375 },
    { weight: 5, cost: 8.495 },
    { weight: 6, cost: 9.71125 },
    { weight: 7, cost: 10.4575 },
    { weight: 8, cost: 11.1425 },
    { weight: 9, cost: 11.76625 },
    { weight: 10, cost: 12.42 },
    { weight: 11, cost: 15.46625 },
    { weight: 12, cost: 16.1575 },
    { weight: 13, cost: 16.84 },
    { weight: 14, cost: 17.50125 },
    { weight: 15, cost: 18.12625 },
    { weight: 16, cost: 18.70125 },
    { weight: 17, cost: 19.16625 },
    { weight: 18, cost: 19.68875 },
    { weight: 19, cost: 20.19625 },
    { weight: 20, cost: 21.495 },
    { weight: 21, cost: 24.105 },
    { weight: 22, cost: 27.0075 },
    { weight: 23, cost: 30.71375 },
    { weight: 24, cost: 35.21875 },
    { weight: 25, cost: 39.5425 },
    { weight: 26, cost: 41.705 },
    { weight: 27, cost: 43.86875 },
    { weight: 28, cost: 45.2475 },
    { weight: 29, cost: 46.60625 },
    { weight: 30, cost: 47.94875 },
    { weight: 31, cost: 49.27625 },
    { weight: 32, cost: 50.585 },
    { weight: 33, cost: 51.88375 },
    { weight: 34, cost: 53.16 },
    { weight: 35, cost: 54.42125 },
    { weight: 36, cost: 56.665 },
    { weight: 37, cost: 57.9 },
    { weight: 38, cost: 59.1075 },
    { weight: 39, cost: 60.3075 },
    { weight: 40, cost: 61.48375 },
    { weight: 41, cost: 62.64875 },
    { weight: 42, cost: 63.7925 },
    { weight: 43, cost: 64.9225 },
    { weight: 44, cost: 66.035 },
    { weight: 45, cost: 67.13375 },
    { weight: 46, cost: 68.21125 },
    { weight: 47, cost: 69.2775 },
    { weight: 48, cost: 70.325 },
    { weight: 49, cost: 71.355 },
    { weight: 50, cost: 72.36875 }
  ];

  // USPS shipping cost tables
  const USPS_RATES_OZ = [
    { weight: 1, cost: 4.28125 },
    { weight: 2, cost: 4.28125 },
    { weight: 3, cost: 4.28125 },
    { weight: 4, cost: 4.28125 },
    { weight: 5, cost: 4.56125 },
    { weight: 6, cost: 4.56125 },
    { weight: 7, cost: 4.56125 },
    { weight: 8, cost: 4.56125 },
    { weight: 9, cost: 5.2625 },
    { weight: 10, cost: 5.2625 },
    { weight: 11, cost: 5.2625 },
    { weight: 12, cost: 5.2625 },
    { weight: 13, cost: 6.4825 },
    { weight: 14, cost: 6.4825 },
    { weight: 15, cost: 6.4825 },
    { weight: 15.99, cost: 6.4825 }
  ];

  const USPS_RATES_LB = [
    { weight: 1, cost: 7.9475 },
    { weight: 2, cost: 9.12625 },
    { weight: 3, cost: 9.94875 },
    { weight: 4, cost: 10.5025 },
    { weight: 5, cost: 10.9775 },
    { weight: 6, cost: 11.59 },
    { weight: 7, cost: 12.18625 },
    { weight: 8, cost: 12.80625 },
    { weight: 9, cost: 13.47375 },
    { weight: 10, cost: 14.1725 },
    { weight: 11, cost: 16.1925 },
    { weight: 12, cost: 16.92125 },
    { weight: 13, cost: 17.6425 },
    { weight: 14, cost: 18.3375 },
    { weight: 15, cost: 18.99625 },
    { weight: 16, cost: 19.60125 },
    { weight: 17, cost: 20.09125 },
    { weight: 18, cost: 20.645 },
    { weight: 19, cost: 21.1775 },
    { weight: 20, cost: 22.53875 },
    { weight: 21, cost: 25.26625 },
    { weight: 22, cost: 28.32 },
    { weight: 23, cost: 32.2175 },
    { weight: 24, cost: 36.96625 },
    { weight: 25, cost: 41.51625 },
    { weight: 26, cost: 43.78875 },
    { weight: 27, cost: 46.0675 },
    { weight: 28, cost: 47.51875 },
    { weight: 29, cost: 48.94625 },
    { weight: 30, cost: 50.36375 },
    { weight: 31, cost: 51.76 },
    { weight: 32, cost: 53.13875 },
    { weight: 33, cost: 54.50375 },
    { weight: 34, cost: 55.84625 },
    { weight: 35, cost: 57.175 },
    { weight: 36, cost: 59.48625 },
    { weight: 37, cost: 60.78125 },
    { weight: 38, cost: 62.05375 },
    { weight: 39, cost: 63.31375 },
    { weight: 40, cost: 64.55625 },
    { weight: 41, cost: 65.78 },
    { weight: 42, cost: 66.9875 },
    { weight: 43, cost: 68.1775 },
    { weight: 44, cost: 69.3475 },
    { weight: 45, cost: 70.50375 },
    { weight: 46, cost: 71.64125 },
    { weight: 47, cost: 72.75875 },
    { weight: 48, cost: 73.86375 },
    { weight: 49, cost: 74.95 },
    { weight: 50, cost: 72.45625 }
  ];

  // Warehouse Processing Fee rates (weight-based in kg, uses actual weight only)
  const TAKE_IT_RATES = [
    { minWeight: 0.01, maxWeight: 1, cost: 0.75 },
    { minWeight: 1.01, maxWeight: 2, cost: 0.90 },
    { minWeight: 2.01, maxWeight: 5, cost: 1.35 },
    { minWeight: 5.01, maxWeight: 10, cost: 1.70 },
    { minWeight: 10.01, maxWeight: 20, cost: 2.40 },
    { minWeight: 20.01, maxWeight: Infinity, cost: 3.50 }
  ];

  // Pick & Pack rates based on average daily quantity per UPC/SKU (22 days per month)
  const PICK_PACK_RATES = [
    { minQty: 1, maxQty: 10, cost: 2.50 },
    { minQty: 11, maxQty: 25, cost: 2.00 },
    { minQty: 26, maxQty: 50, cost: 1.50 },
    { minQty: 51, maxQty: Infinity, cost: 1.00 }
  ];

  const calculateBasicFee = () => {
    if (!length || !width || !height || !weight) return 0;
    
    // Calculate dimensional weight using 6000 divisor from cm³ (input is already in cm)
    const cubicCentimeters = length * width * height;
    const dimWeightKg = cubicCentimeters / 6000;
    const dimensionalWeight = dimWeightKg * 2.20462; // Convert kg to lbs
    const actualWeight = weight * 2.20462; // kg to lbs
    const chargeableWeight = Math.max(dimensionalWeight, actualWeight);

    // Find rate based on chargeable weight and selected carrier
    const getShippingRate = (weight: number) => {
      // For UPS/USPS, weight is in lbs
      const weightOz = weight * 16; // Convert to ounces
      
      if (selectedCarrier === 'UPS') {
        // Use ounce-based rates for packages under 1 pound (16 oz)
        if (weightOz <= 15.99) {
          const rate = UPS_RATES_OZ.find(r => r.weight >= weightOz);
          if (rate) {
            return rate.cost;
          } else {
            // If exact weight not found, use the highest ounce rate
            return UPS_RATES_OZ[UPS_RATES_OZ.length - 1].cost;
          }
        } else {
          // Use pound-based rates for packages 1 pound and above
          const roundedWeight = Math.ceil(weight);
          const rate = UPS_RATES_LB.find(r => r.weight >= roundedWeight);
          if (rate) {
            return rate.cost;
          } else {
            // For weights over 50 lbs, extrapolate based on the last rate
            const lastRate = UPS_RATES_LB[UPS_RATES_LB.length - 1];
            const extraWeight = roundedWeight - lastRate.weight;
            return lastRate.cost + (extraWeight * 1.30);
          }
        }
      } else {
        // USPS rates
        if (weightOz <= 15.99) {
          const rate = USPS_RATES_OZ.find(r => r.weight >= weightOz);
          if (rate) {
            return rate.cost;
          } else {
            return USPS_RATES_OZ[USPS_RATES_OZ.length - 1].cost;
          }
        } else {
          const roundedWeight = Math.ceil(weight);
          const rate = USPS_RATES_LB.find(r => r.weight >= roundedWeight);
          if (rate) {
            return rate.cost;
          } else {
            // For weights over 50 lbs, extrapolate based on the last rate
            const lastRate = USPS_RATES_LB[USPS_RATES_LB.length - 1];
            const extraWeight = roundedWeight - lastRate.weight;
            return lastRate.cost + (extraWeight * 1.45); // USPS extrapolation
          }
        }
      }
    };
    
    return getShippingRate(chargeableWeight);
  };

  // Calculate Warehouse Processing Fee separately (uses actual weight only in kg) - Stephen Warehouse only
  const calculateTakeItCost = () => {
    if (selectedWarehouse !== 'stephen') return 0;
    if (!weight) return 0;
    
    const rate = TAKE_IT_RATES.find(r => weight >= r.minWeight && weight <= r.maxWeight);
    return rate ? rate.cost : TAKE_IT_RATES[TAKE_IT_RATES.length - 1].cost;
  };

  // Calculate Pick & Pack cost based on average daily quantity (InAndOut only)
  const calculatePickPackCost = () => {
    if (selectedWarehouse !== 'inandout') return 0;
    const rate = PICK_PACK_RATES.find(r => avgDailyQuantity >= r.minQty && avgDailyQuantity <= r.maxQty);
    return rate ? rate.cost : PICK_PACK_RATES[PICK_PACK_RATES.length - 1].cost;
  };

  // Storage fee rates based on time periods (per cubic meter per day)
  const getStorageRate = (days: number) => {
    if (days <= 30) return 0;
    if (days <= 60) return 0.6;
    if (days <= 90) return 0.9;
    if (days <= 180) return 1.2;
    if (days <= 365) return 2;
    return 3; // Greater than 365 days
  };

  // Storage fee calculation with time-period based pricing
  const calculateStorageFee = () => {
    // InAndOut Warehouse storage pricing
    if (selectedWarehouse === 'inandout') {
      // Calculate cubic feet directly from packaging dimensions
      if (!length || !width || !height) return 0;
      const cubicCm = length * width * height;
      const cubicFeet = cubicCm * 0.0000353147; // Convert cm³ to cubic feet
      const storageDaysInMonth = storageDays / 30; // Convert days to months for monthly pricing
      
      // Shelve storage: items under 0.11 cubic feet
      if (cubicFeet < 0.11) {
        // Assuming we're calculating for 1 unit, if over 200 items use per-item rate
        // For simplicity, we'll use the per-item rate: $0.10 per month
        return 0.10 * storageDaysInMonth;
      } else {
        // Pallet storage: $0.90 per cubic foot per month
        return cubicFeet * 0.90 * storageDaysInMonth;
      }
    }
    
    // Stephen Warehouse (original) storage pricing
    if (!cbmPerUnit) return 0;
    const minimumVolume = Math.max(cbmPerUnit, 0.001); // Minimum 0.001 CBM (1 liter)
    const dailyRate = getStorageRate(storageDays);
    
    return minimumVolume * dailyRate * storageDays;
  };

  // Calculate InAndOut receiving fee (per case)
  const calculateInAndOutReceivingFee = () => {
    if (selectedWarehouse !== 'inandout') return 0;
    const feePerCase = 1.50;
    const unitsPerCarton = masterCartonUnits || 1;
    return feePerCase / unitsPerCarton; // Fee per unit
  };

  const fulfillmentFee = calculateBasicFee();
  const takeItCost = calculateTakeItCost();
  const pickPackCost = calculatePickPackCost();
  const storageFee = calculateStorageFee();
  const inandoutReceivingFee = calculateInAndOutReceivingFee();

  // Update parent component with calculated fees
  React.useEffect(() => {
    if (onUpdateFee) onUpdateFee(fulfillmentFee);
  }, [fulfillmentFee, onUpdateFee]);

  React.useEffect(() => {
    if (onUpdateStorageFee) onUpdateStorageFee(storageFee);
  }, [storageFee, onUpdateStorageFee]);

  // Calculate and update total fee
  React.useEffect(() => {
    if (onUpdateTotalFee) {
      // Use CBM per unit from Master Carton Optimization (same as detailed section)
      const cbmTotalCost = cbmPerUnit * cbmCost;
      const totalFee = fulfillmentFee + takeItCost + pickPackCost + storageFee + cbmTotalCost + inandoutReceivingFee;
      onUpdateTotalFee(totalFee);
    }
  }, [fulfillmentFee, takeItCost, pickPackCost, storageFee, inandoutReceivingFee, cbmPerUnit, cbmCost, onUpdateTotalFee]);

  return (
    <div className="space-y-6">
      {/* Carrier Selection */}
      <Card className="bg-blue-50/80 border-blue-200">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Shipping Carrier</Label>
            <Select value={selectedCarrier} onValueChange={(value: 'UPS' | 'USPS') => setSelectedCarrier(value)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="UPS">UPS</SelectItem>
                <SelectItem value="USPS">USPS</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Fulfillment Fee */}
      <Card className="bg-purple-50/80 border-purple-200">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <span>3PL Fulfillment Fee ({selectedCarrier})</span>
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-4 h-4 text-purple-500" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">
                  Third-party logistics fulfillment fee based on product dimensions and weight using {selectedCarrier} shipping rates.
                  Includes picking, packing, and shipping costs.
                </p>
              </TooltipContent>
            </Tooltip>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <Label className="text-sm font-medium">Dimensional Weight (oz)</Label>
              <div className="text-xs text-muted-foreground mb-1">
                Formula: {length && width && height ? 
                  `${(length * width * height).toFixed(0)} cm³ ÷ 6000` : 
                  '0 cm³ ÷ 6000'
                }
              </div>
              <div className="text-lg font-semibold text-purple-600">
                {length && width && height ? 
                  ((length * width * height) / 6000 * 2.20462 * 16).toFixed(2) : 
                  '0.00'
                }
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium">Dimensional Weight (lbs)</Label>
              <div className="text-lg font-semibold text-purple-600">
                {length && width && height ? 
                  ((length * width * height) / 6000 * 2.20462).toFixed(2) : 
                  '0.00'
                }
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium">Actual Weight (lbs)</Label>
              <div className="text-lg font-semibold text-purple-600">
                {weight ? (weight * 2.20462).toFixed(2) : '0.00'}
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium">Chargeable Weight (lbs)</Label>
              <div className="text-xs text-muted-foreground mb-1">
                Higher of dimensional vs actual
              </div>
              <div className="text-lg font-semibold text-purple-700">
                {(() => {
                  if (!length || !width || !height || !weight) return '0.00';
                  const cubicCentimeters = length * width * height;
                  const dimWeightKg = cubicCentimeters / 6000;
                  const dimensionalWeight = dimWeightKg * 2.20462;
                  const actualWeight = weight * 2.20462;
                  return Math.max(dimensionalWeight, actualWeight).toFixed(2);
                })()}
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium">{selectedCarrier} Fulfillment Fee</Label>
              <div className="text-xs text-muted-foreground mb-1">
                Rate: ${(() => {
                  if (!length || !width || !height || !weight) return '0.00';
                  const cubicCentimeters = length * width * height;
                  const dimWeightKg = cubicCentimeters / 6000;
                  const dimensionalWeight = dimWeightKg * 2.20462;
                  const actualWeight = weight * 2.20462;
                  const chargeableWeight = Math.max(dimensionalWeight, actualWeight);
                  
                  // Find the rate (same logic as in calculateBasicFee)
                  const weightOz = chargeableWeight * 16;
                  
                  if (selectedCarrier === 'UPS') {
                    if (weightOz <= 15.99) {
                      const rate = UPS_RATES_OZ.find(r => r.weight >= weightOz);
                      return rate ? rate.cost.toFixed(2) : UPS_RATES_OZ[UPS_RATES_OZ.length - 1].cost.toFixed(2);
                    } else {
                      const roundedWeight = Math.ceil(chargeableWeight);
                      const rate = UPS_RATES_LB.find(r => r.weight >= roundedWeight);
                      if (rate) {
                        return rate.cost.toFixed(2);
                      } else {
                        const lastRate = UPS_RATES_LB[UPS_RATES_LB.length - 1];
                        const extraWeight = roundedWeight - lastRate.weight;
                        return (lastRate.cost + (extraWeight * 1.30)).toFixed(2);
                      }
                    }
                  } else {
                    if (weightOz <= 15.99) {
                      const rate = USPS_RATES_OZ.find(r => r.weight >= weightOz);
                      return rate ? rate.cost.toFixed(2) : USPS_RATES_OZ[USPS_RATES_OZ.length - 1].cost.toFixed(2);
                    } else {
                      const roundedWeight = Math.ceil(chargeableWeight);
                      const rate = USPS_RATES_LB.find(r => r.weight >= roundedWeight);
                      if (rate) {
                        return rate.cost.toFixed(2);
                      } else {
                        const lastRate = USPS_RATES_LB[USPS_RATES_LB.length - 1];
                        const extraWeight = roundedWeight - lastRate.weight;
                        return (lastRate.cost + (extraWeight * 1.45)).toFixed(2);
                      }
                    }
                  }
                })()}
              </div>
              <div className="text-xl font-bold text-purple-700">
                ${fulfillmentFee.toFixed(2)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Warehouse Processing Fee - Stephen Warehouse Only */}
      {selectedWarehouse === 'stephen' && (
        <Card className="bg-green-50/80 border-green-200">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <span>Warehouse Processing Fee</span>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="w-4 h-4 text-green-500" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">
                    Per unit cost based on actual weight. This service includes: unloading, warehousing, labeling.
                  </p>
                </TooltipContent>
              </Tooltip>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <Label className="text-sm font-medium">Actual Weight (kg)</Label>
                <div className="text-lg font-semibold text-green-600">
                  {weight ? weight.toFixed(2) : '0.00'}
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium">Warehouse Processing Fee</Label>
                <div className="text-xl font-bold text-green-700">
                  ${takeItCost.toFixed(2)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pick & Pack Section - InAndOut Warehouse Only */}
      {selectedWarehouse === 'inandout' && (
        <Card className="bg-green-50/80 border-green-200">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <span>Warehouse Processing Fee</span>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="w-4 h-4 text-green-500" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">
                    Per unit cost based on actual weight. This service includes: unloading, warehousing, labeling.
                  </p>
                </TooltipContent>
              </Tooltip>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border-t pt-4 space-y-4">
              <div className="flex items-center gap-2">
                <Label className="text-base font-semibold">Pick & Pack per Item</Label>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="w-4 h-4 text-green-500" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="max-w-sm">
                      <p className="font-semibold mb-2">Pick & Pack rates based on average daily quantity per UPC/SKU (22 days per month):</p>
                      <ul className="text-sm space-y-1">
                        <li>• 1-10 items/day: $2.50</li>
                        <li>• 11-25 items/day: $2.00</li>
                        <li>• 26-50 items/day: $1.50</li>
                        <li>• 51+ items/day: $1.00</li>
                      </ul>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium">Avg Daily Quantity per UPC/SKU</Label>
                  <Input
                    type="number"
                    value={avgDailyQuantity}
                    onChange={(e) => setAvgDailyQuantity(Number(e.target.value) || 0)}
                    className="w-32"
                    min="1"
                  />
                  <div className="text-xs text-muted-foreground mt-1">
                    Based on 22 days/month
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium">Pick & Pack Cost</Label>
                  <div className="text-xl font-bold text-green-700">
                    ${pickPackCost.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* InAndOut Receiving Fee - Only show for InAndOut warehouse */}
      {selectedWarehouse === 'inandout' && (
        <Card className="bg-amber-50/80 border-amber-200">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <span>InAndOut Warehouse Receiving Fee</span>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="w-4 h-4 text-amber-500" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">
                    InAndOut charges $1.50 per case (master carton) received. This fee is calculated per unit based on master carton optimization.
                  </p>
                </TooltipContent>
              </Tooltip>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label className="text-sm font-medium">Fee Per Case</Label>
                <div className="text-lg font-semibold text-amber-600">
                  $1.50
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium">Units Per Carton</Label>
                <div className="text-lg font-semibold text-amber-600">
                  {masterCartonUnits}
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium">Receiving Fee Per Unit</Label>
                <div className="text-xl font-bold text-amber-700">
                  ${inandoutReceivingFee.toFixed(2)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Storage Fee */}
      <Card className="bg-indigo-50/80 border-indigo-200">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <span>{selectedWarehouse === 'inandout' ? 'InAndOut' : '3PL'} Storage Fee</span>
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-4 h-4 text-indigo-500" />
              </TooltipTrigger>
              <TooltipContent>
                <div className="max-w-xs space-y-2">
                  {selectedWarehouse === 'inandout' ? (
                    <>
                      <p className="font-semibold">InAndOut Storage Pricing:</p>
                      <p>• Shelve storage (items under 0.11 cubic feet):</p>
                      <p className="ml-2">- Starting at $20/month for up to 200 items</p>
                      <p className="ml-2">- $0.10/month per item (over 200 items)</p>
                      <p>• Pallet storage: $0.90 per cubic foot per month</p>
                    </>
                  ) : (
                    <p>Time-based storage fee calculated per cubic meter per day. Minimum billing volume is 0.001 CBM.</p>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </CardTitle>
          {selectedWarehouse !== 'inandout' && (
            <div className="text-sm text-indigo-600 font-medium mt-2">
              ℹ️ First 30 days are free
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">Storage Days</Label>
              <Input
                type="number"
                value={storageDays}
                onChange={(e) => setStorageDays(Number(e.target.value) || 0)}
                className="w-32"
                min="1"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label className="text-sm font-medium">
                  {selectedWarehouse === 'inandout' ? 'Cubic Feet' : 'Cubic Meters'}
                </Label>
                <div className="text-lg font-semibold text-indigo-600">
                  {selectedWarehouse === 'inandout' ? 
                    (length && width && height ? 
                      ((length * width * height) * 0.0000353147).toFixed(4) 
                      : '0.0000')
                    : (cbmPerUnit ? Math.max(cbmPerUnit, 0.001).toFixed(6) : '0.000001')
                  }
                </div>
              </div>
              {selectedWarehouse === 'inandout' ? (
                <>
                  <div>
                    <Label className="text-sm font-medium">Storage Type</Label>
                    <div className="text-lg font-semibold text-indigo-600">
                      {length && width && height && ((length * width * height) * 0.0000353147) < 0.11 ? 'Shelve' : 'Pallet'}
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Rate</Label>
                    <div className="text-lg font-semibold text-indigo-600">
                      {length && width && height && ((length * width * height) * 0.0000353147) < 0.11 
                        ? '$0.10/month' 
                        : '$0.90/cu.ft/month'}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Label className="text-sm font-medium">Daily Rate (USD/M3)</Label>
                    <div className="text-lg font-semibold text-indigo-600">
                      ${getStorageRate(storageDays).toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Storage Days</Label>
                    <div className="text-lg font-semibold text-indigo-600">
                      {storageDays}
                    </div>
                  </div>
                </>
              )}
              <div>
                <Label className="text-sm font-medium">Total Storage Fee</Label>
                <div className="text-xl font-bold text-indigo-700">
                  ${storageFee.toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Factory to Fulfillment Warehouse CBM */}
      <Card className="bg-violet-50/80 border-violet-200">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <span>Factory to Fulfillment Warehouse CBM</span>
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-4 h-4 text-violet-500" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">
                  Calculates shipping costs from factory to fulfillment warehouse based on cubic meter volume.
                  CBM per unit is sourced from Master Carton Optimization calculations or Final Packing dimensions if available.
                </p>
              </TooltipContent>
            </Tooltip>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {(() => {
              // Use CBM per unit from carton optimization instead of calculating from individual dimensions
              const cbm = cbmPerUnit;
              const totalCost = cbm * cbmCost;
              
              return (
                <>
                  <div className="grid grid-cols-1 gap-4 p-4 bg-violet-50/50 rounded-lg border border-violet-200/50 mb-4">
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-violet-700">Product CBM</p>
                      <p className="text-sm font-semibold text-violet-800">
                        {cbm.toFixed(8)} m³
                      </p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 p-4 bg-white/80 rounded-lg border border-violet-200/30">
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-card-foreground">CBM Cost to FBA</p>
                      <p className="text-lg font-semibold text-violet-700">
                        ${cbmCost.toFixed(2)} / m³
                      </p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-card-foreground">Total Cost</p>
                      <p className="text-lg font-bold text-violet-800">
                        ${totalCost.toFixed(2)}
                      </p>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card className="bg-slate-50/80 border-slate-200">
        <CardHeader>
          <CardTitle className="text-lg">3PL Total Fulfillment Cost</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {(() => {
              // Use CBM per unit from Master Carton Optimization (same as detailed section)
              const cbmTotalCost = cbmPerUnit * cbmCost;
              
              return (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                    <div className="flex justify-between">
                      <span>{selectedCarrier} Fulfillment:</span>
                      <span className="font-semibold">${fulfillmentFee.toFixed(2)}</span>
                    </div>
                    {selectedWarehouse === 'stephen' && (
                      <div className="flex justify-between">
                        <span>Warehouse Processing:</span>
                        <span className="font-semibold">${takeItCost.toFixed(2)}</span>
                      </div>
                    )}
                    {selectedWarehouse === 'inandout' && (
                      <>
                        <div className="flex justify-between">
                          <span>Pick & Pack:</span>
                          <span className="font-semibold">${pickPackCost.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>InAndOut Receiving:</span>
                          <span className="font-semibold">${inandoutReceivingFee.toFixed(2)}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between">
                      <span>Storage ({storageDays} days):</span>
                      <span className="font-semibold">${storageFee.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Factory to Warehouse CBM:</span>
                      <span className="font-semibold">${cbmTotalCost.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="border-t pt-4">
                    <div className="flex justify-between items-center">
                      <span className="text-lg font-semibold">Total:</span>
                      <span className="text-xl font-bold text-primary">
                        ${(fulfillmentFee + takeItCost + pickPackCost + storageFee + cbmTotalCost + inandoutReceivingFee).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ThreePLCalculation;