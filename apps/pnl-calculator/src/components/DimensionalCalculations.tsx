"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@platform/ui";
import { ChevronDown } from 'lucide-react';
import { Button } from "@platform/ui";
import { calculateDimensionalWeight } from "@platform/calc";

interface DimensionalCalculationsProps {
  length: number; // in cm
  width: number;  // in cm
  height: number; // in cm
  weight: number; // in kg
}

const DimensionalCalculations: React.FC<DimensionalCalculationsProps> = ({ 
  length, 
  width, 
  height, 
  weight 
}) => {
  // Use centralized dimensional weight calculation
  const dimCalc = calculateDimensionalWeight(length, width, height, weight);
  
  // Extract values from centralized calculation
  const {
    dimWeightLbs,
    dimWeightKg, 
    dimWeightOz,
    shippingWeightLbs,
    shippingWeightOz,
    chargeableWeightLbs,
    cubicInches,
    formula
  } = dimCalc;
  
  // Convert cm to inches for display
  const lengthIn = length / 2.54;
  const widthIn = width / 2.54;
  const heightIn = height / 2.54;
  
  // Convert kg to pounds and ounces for display
  const weightLbs = weight * 2.20462;
  const weightOz = weightLbs * 16;
  
  // Calculate volumes for display
  const cubicFeet = cubicInches / 1728; // 1728 cubic inches in a cubic foot
  const cbm = (length / 100) * (width / 100) * (height / 100); // Convert cm to meters first
  const cubicCentimeters = length * width * height; // For display purposes

  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <Card className="shadow-lg">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <CardTitle className="text-accent flex items-center justify-between">
              <span>Dimensional Calculations</span>
              <Button variant="ghost" size="sm" className="p-1">
                <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </Button>
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              
              {/* Dimensions Section */}
              <div className="space-y-3">
                <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                  Dimensions (inches)
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">Length:</span>
                    <span className="font-mono">{lengthIn.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Width:</span>
                    <span className="font-mono">{widthIn.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Height:</span>
                    <span className="font-mono">{heightIn.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Weight Section */}
              <div className="space-y-3">
                <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                  Actual Weight
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">Weight (lbs):</span>
                    <span className="font-mono">{weightLbs.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Weight (oz):</span>
                    <span className="font-mono">{weightOz.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Volume Section */}
              <div className="space-y-3">
                <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                  Volume Calculations
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">CBM (m³):</span>
                    <span className="font-mono">{cbm.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">CBF (ft³):</span>
                    <span className="font-mono">{cubicFeet.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Cubic Centimeters (cm³):</span>
                    <span className="font-mono">{cubicCentimeters.toFixed(0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Cubic Inches (in³):</span>
                    <span className="font-mono">{cubicInches.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Dimensional Weight Section */}
              <div className="space-y-3">
                <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                  Dimensional Weight (Divisor 139 from in³)
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Formula: {formula}</span>
                    <span></span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Dim Weight (kg):</span>
                    <span className="font-mono">{dimWeightKg.toFixed(3)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Dim Weight (lbs):</span>
                    <span className="font-mono">{dimWeightLbs.toFixed(3)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Dim Weight (oz):</span>
                    <span className="font-mono">{dimWeightOz.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Shipping Weight Section */}
              <div className="space-y-3">
                <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                  Shipping Weight
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">Shipping Weight (lb):</span>
                    <span className="font-mono font-semibold">{shippingWeightLbs.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Shipping Weight (oz):</span>
                    <span className="font-mono">{shippingWeightOz.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Chargeable Weight Section */}
              <div className="space-y-3">
                <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                  Chargeable Weight
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">Chargeable Weight (lb):</span>
                    <span className="font-mono font-semibold text-accent">{chargeableWeightLbs.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Summary Note */}
            <div className="mt-6 p-3 bg-muted/50 rounded-md">
              <p className="text-xs text-muted-foreground">
                <strong>Note:</strong> Shipping weight is the greater of actual weight ({weightLbs.toFixed(2)} lbs) 
                or dimensional weight ({dimWeightLbs.toFixed(3)} lbs). 
                Dimensional weight calculated using divisor of 139 from cubic inches (L×W×H in inches ÷ 139 = lbs).
              </p>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

export default DimensionalCalculations;