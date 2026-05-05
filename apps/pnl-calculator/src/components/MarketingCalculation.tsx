"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { Input } from "@platform/ui";
import { Label } from "@platform/ui";

interface MarketingCalculationProps {
  sellingPrice: number;
  initialAffiliatePercentage?: number;
  initialAdsPercentage?: number;
  onSubtotalChange?: (subtotal: number) => void;
  onAffiliateChange?: (percentage: number, dollar: number) => void;
  onAdsChange?: (percentage: number, dollar: number) => void;
}

const MarketingCalculation: React.FC<MarketingCalculationProps> = ({
  sellingPrice,
  initialAffiliatePercentage = 5,
  initialAdsPercentage = 7,
  onSubtotalChange,
  onAffiliateChange,
  onAdsChange
}) => {
  const [affiliateDollar, setAffiliateDollar] = useState<number>(0);
  const [affiliatePercentage, setAffiliatePercentage] = useState<number>(initialAffiliatePercentage);
  const [adsDollar, setAdsDollar] = useState<number>(0);
  const [adsPercentage, setAdsPercentage] = useState<number>(initialAdsPercentage);
  const [subtotal, setSubtotal] = useState<number>(0);
  const [adsRoi, setAdsRoi] = useState<number>(0);
  const [generalRoi, setGeneralRoi] = useState<number>(0);

  // Initialize dollar values based on percentages and selling price
  useEffect(() => {
    if (sellingPrice > 0) {
      setAffiliateDollar(Math.round((sellingPrice * initialAffiliatePercentage) / 100 * 100) / 100);
      setAdsDollar(Math.round((sellingPrice * initialAdsPercentage) / 100 * 100) / 100);
    }
  }, [sellingPrice, initialAffiliatePercentage, initialAdsPercentage]);

  // Sync internal state with props when they change
  useEffect(() => {
    setAffiliatePercentage(initialAffiliatePercentage);
    setAdsPercentage(initialAdsPercentage);
  }, [initialAffiliatePercentage, initialAdsPercentage]);

  useEffect(() => {
    // Calculate subtotal
    const total = affiliateDollar + adsDollar;
    setSubtotal(Math.round(total * 100) / 100);
    
    // Notify parent component of subtotal change
    if (onSubtotalChange) {
      onSubtotalChange(Math.round(total * 100) / 100);
    }
  }, [affiliateDollar, adsDollar, onSubtotalChange]);


  // Handle affiliate dollar change and update percentage
  const handleAffiliateDollarChange = (value: number) => {
    setAffiliateDollar(value);
    if (sellingPrice > 0) {
      const calculatedPercentage = (value / sellingPrice) * 100;
      setAffiliatePercentage(Math.round(calculatedPercentage * 100) / 100);
    }
  };

  // Handle affiliate percentage change and update dollar
  const handleAffiliatePercentageChange = (value: number) => {
    console.log('Affiliate percentage change:', value);
    setAffiliatePercentage(value);
    if (sellingPrice > 0) {
      const calculatedDollar = (sellingPrice * value) / 100;
      const roundedDollar = Math.round(calculatedDollar * 100) / 100;
      setAffiliateDollar(roundedDollar);
      console.log('Calling onAffiliateChange with:', value, roundedDollar);
      // Notify parent of change
      if (onAffiliateChange) {
        onAffiliateChange(value, roundedDollar);
      }
    }
  };

  // Handle ads dollar change and update percentage
  const handleAdsDollarChange = (value: number) => {
    setAdsDollar(value);
    if (sellingPrice > 0) {
      const calculatedPercentage = (value / sellingPrice) * 100;
      setAdsPercentage(Math.round(calculatedPercentage * 100) / 100);
    }
  };

  // Handle ads percentage change and update dollar
  const handleAdsPercentageChange = (value: number) => {
    console.log('Ads percentage change:', value);
    setAdsPercentage(value);
    if (sellingPrice > 0) {
      const calculatedDollar = (sellingPrice * value) / 100;
      const roundedDollar = Math.round(calculatedDollar * 100) / 100;
      setAdsDollar(roundedDollar);
      console.log('Calling onAdsChange with:', value, roundedDollar);
      // Notify parent of change
      if (onAdsChange) {
        onAdsChange(value, roundedDollar);
      }
    }
  };

  // Calculate ROI values
  useEffect(() => {
    // ADs ROI = Selling Price / ADs ($)
    if (adsDollar > 0) {
      const calculatedAdsRoi = sellingPrice / adsDollar;
      setAdsRoi(Math.round(calculatedAdsRoi * 100) / 100);
    } else {
      setAdsRoi(0);
    }

    // General ROI = Selling Price / (Affiliate ($) + ADs ($))
    const totalMarketingCost = affiliateDollar + adsDollar;
    if (totalMarketingCost > 0) {
      const calculatedGeneralRoi = sellingPrice / totalMarketingCost;
      setGeneralRoi(Math.round(calculatedGeneralRoi * 100) / 100);
    } else {
      setGeneralRoi(0);
    }
  }, [sellingPrice, affiliateDollar, adsDollar]);

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Marketing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Affiliate ($) */}
          <div className="space-y-2">
            <Label htmlFor="affiliateDollar">Affiliate ($)</Label>
            <Input
              id="affiliateDollar"
              type="number"
              step="0.01"
              value={affiliateDollar}
              onChange={(e) => handleAffiliateDollarChange(e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
            />
          </div>

          {/* Affiliate (%) */}
          <div className="space-y-2">
            <Label htmlFor="affiliatePercentage">Affiliate (%)</Label>
            <Input
              id="affiliatePercentage"
              type="number"
              step="0.01"
              value={affiliatePercentage}
              onChange={(e) => handleAffiliatePercentageChange(e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
            />
          </div>

          {/* ADs ($) */}
          <div className="space-y-2">
            <Label htmlFor="adsDollar">ADs ($)</Label>
            <Input
              id="adsDollar"
              type="number"
              step="0.01"
              value={adsDollar}
              onChange={(e) => handleAdsDollarChange(e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
            />
          </div>

          {/* ADs (%) */}
          <div className="space-y-2">
            <Label htmlFor="adsPercentage">ADs (%)</Label>
            <Input
              id="adsPercentage"
              type="number"
              step="0.01"
              value={adsPercentage}
              onChange={(e) => handleAdsPercentageChange(e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
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

        {/* ROI Section */}
        <div className="mt-6 pt-4 border-t">
          <div className="mb-4">
            <Label className="text-lg font-semibold">ROI</Label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* ADs ROI */}
            <div className="space-y-2">
              <Label htmlFor="adsRoi">ADs ROI</Label>
              <Input
                id="adsRoi"
                type="number"
                step="0.01"
                value={adsRoi}
                readOnly
                className="bg-muted"
              />
            </div>

            {/* General ROI */}
            <div className="space-y-2">
              <Label htmlFor="generalRoi">General ROI</Label>
              <Input
                id="generalRoi"
                type="number"
                step="0.01"
                value={generalRoi}
                readOnly
                className="bg-muted"
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default MarketingCalculation;