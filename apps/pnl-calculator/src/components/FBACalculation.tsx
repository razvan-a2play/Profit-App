"use client";

import React from 'react';
import { DollarSign, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import {
  calculateFBATierAndFee,
  calculateReferralFee,
  calculateReturnProcessingFee,
  calculateSippDiscount,
  checkSippEligibility,
} from "@platform/calc";

interface FBACalculationProps {
  length: number;
  width: number;
  height: number;
  weight: number;
  sellingPrice: number;
  category: string;
  additionalCosts?: number;
  sippEligibleOverride?: boolean;
  onSippOverrideChange?: (value: boolean) => void;
  hazmat?: boolean;
  containsBatteries?: boolean;
}

const FBACalculation: React.FC<FBACalculationProps> = ({
  length,
  width,
  height,
  weight,
  sellingPrice,
  category,
  additionalCosts = 0,
  sippEligibleOverride = true,
  onSippOverrideChange,
  hazmat = false,
  containsBatteries = false
}) => {
  const fbaData = calculateFBATierAndFee(length, width, height, weight, sellingPrice, hazmat);
  // Calculate regular (non-hazmat) fees for comparison when hazmat is enabled
  const regularFbaData = hazmat ? calculateFBATierAndFee(length, width, height, weight, sellingPrice, false) : null;
  const referralData = calculateReferralFee(category, sellingPrice);
  const sippEligible = checkSippEligibility(length, width, height);
  
  // Calculate SIPP dimension checks for display
  const lengthInches = length / 2.54;
  const widthInches = width / 2.54;
  const heightInches = height / 2.54;
  const sortedDims = [lengthInches, widthInches, heightInches].sort((a, b) => b - a);
  
  const sippDimChecks = {
    longest: sortedDims[0] > 6,
    median: sortedDims[1] > 4,
    shortest: sortedDims[2] > 0.375
  };
  
  // Apply manual override for SIPP eligibility (e.g., for fragile products)
  const finalSippEligible = (sippEligible === "YES" && sippEligibleOverride) ? "YES" : "NO";
  const sippDiscount = finalSippEligible === "YES" ? calculateSippDiscount(fbaData.tier, fbaData.billableWeight * 16) : 0;

  // Apply low price discount only in total calculations
  // $0.77 until Dec 31, 2025, then $0.86 starting Jan 1, 2026
  const effectiveDate = new Date('2026-01-01');
  const currentDate = new Date();
  const lowPriceDiscountAmount = currentDate >= effectiveDate ? 0.86 : 0.77;
  const lowPriceDiscount = sellingPrice < 10 ? lowPriceDiscountAmount : 0;
  const adjustedFBANonPeak = Math.max(0, fbaData.feeNonPeak - lowPriceDiscount);
  const adjustedFBAPeak = Math.max(0, fbaData.feePeak - lowPriceDiscount);
  
  // Battery fee
  const batteryFee = containsBatteries ? 0.11 : 0;
  
  const totalFeesNonPeak = adjustedFBANonPeak + referralData.fee - sippDiscount + batteryFee;
  const totalFeesPeak = adjustedFBAPeak + referralData.fee - sippDiscount + batteryFee;
  const netProfitNonPeak = sellingPrice - totalFeesNonPeak;
  const netProfitPeak = sellingPrice - totalFeesPeak;

  return (
    <div className="bg-yellow-50 p-6 rounded-lg">
      <h3 className="text-lg font-semibold text-yellow-800 mb-4 flex items-center">
        <DollarSign className="w-5 h-5 mr-2" />
        FBA Fees Calculation
      </h3>
      
      {!length || !width || !height || !weight ? (
        <div className="text-center text-gray-500 py-8">
          Enter product dimensions and weight to calculate FBA fees
        </div>
      ) : (
        <div className="space-y-6">
          {/* Size Tier Information */}
          <div className="bg-white p-4 rounded-lg border">
            <h4 className="font-semibold text-gray-800 mb-3">Size Tier Classification</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-xl font-bold text-yellow-600">{fbaData.tier}</div>
                <div className="text-sm text-gray-600">Size Tier</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-yellow-600">{fbaData.billableWeight.toFixed(2)} lb</div>
                <div className="text-sm text-gray-600">Billable Weight</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-yellow-600">{fbaData.dimWeight.toFixed(3)} lb</div>
                <div className="text-sm text-gray-600">Dimensional Weight (Divisor 139)</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-yellow-600">{(weight * 2.20462).toFixed(2)} lb</div>
                <div className="text-sm text-gray-600">Unit Weight</div>
              </div>
            </div>
          </div>

          {/* SIPP Eligibility */}
          <div className="bg-white p-4 rounded-lg border">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-gray-800">SIPP Eligibility</h4>
              {sippEligible === "YES" && onSippOverrideChange && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sippEligibleOverride}
                    onChange={(e) => onSippOverrideChange(e.target.checked)}
                    className="w-4 h-4 text-primary accent-primary"
                  />
                  <span className="text-sm text-gray-600">Passed (Eligible)</span>
                </label>
              )}
            </div>
            <div className="flex items-center justify-center">
              {finalSippEligible === "YES" ? (
                <div className="flex items-center text-green-600">
                  <CheckCircle className="w-8 h-8 mr-3" />
                  <div>
                    <div className="text-2xl font-bold">YES</div>
                    <div className="text-sm text-gray-600">SIPP Eligible</div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center text-red-600">
                  <XCircle className="w-8 h-8 mr-3" />
                  <div>
                    <div className="text-2xl font-bold">NO</div>
                    <div className="text-sm text-gray-600">Not SIPP Eligible</div>
                  </div>
                </div>
              )}
              {finalSippEligible === "YES" && (
                <div className="mt-3 text-center">
                  <div className="text-lg font-bold text-green-600">${sippDiscount.toFixed(2)}</div>
                  <div className="text-sm text-gray-600">SIPP Discount Available</div>
                </div>
              )}
            </div>
            <div className="mt-3 text-xs text-gray-500 text-center">
              SIPP requires: Length &gt; 6", Width &gt; 4", Height &gt; 0.375"
              {sippEligible === "NO" && (
                <div className="mt-1 text-red-600">
                  {!sippDimChecks.longest && <div>❌ Longest dimension ({sortedDims[0].toFixed(2)}") must be &gt; 6"</div>}
                  {!sippDimChecks.median && <div>❌ Median dimension ({sortedDims[1].toFixed(2)}") must be &gt; 4"</div>}
                  {!sippDimChecks.shortest && <div>❌ Shortest dimension ({sortedDims[2].toFixed(2)}") must be &gt; 0.375"</div>}
                </div>
              )}
              {sippEligible === "YES" && !sippEligibleOverride && (
                <div className="mt-1 text-amber-600">Manually marked as ineligible (e.g., fragile)</div>
              )}
            </div>
          </div>

          {/* Fee Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={`bg-white p-4 rounded-lg border ${hazmat ? 'border-orange-300 ring-1 ring-orange-200' : ''}`}>
              <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                FBA Fulfillment Fees
                {hazmat && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-700 rounded-full">
                    <AlertTriangle className="w-3 h-3" />
                    Hazmat
                  </span>
                )}
              </h4>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Non-Peak Season:</span>
                  <div className="text-right">
                    <span className="font-semibold">${fbaData.feeNonPeak.toFixed(2)}</span>
                    {hazmat && regularFbaData && (
                      <span className="ml-2 text-xs text-gray-400 line-through">
                        ${regularFbaData.feeNonPeak.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Peak Season:</span>
                  <div className="text-right">
                    <span className="font-semibold">${fbaData.feePeak.toFixed(2)}</span>
                    {hazmat && regularFbaData && (
                      <span className="ml-2 text-xs text-gray-400 line-through">
                        ${regularFbaData.feePeak.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
                {hazmat && regularFbaData && (
                  <div className="mt-2 pt-2 border-t border-orange-100 text-xs text-orange-600">
                    <div className="flex justify-between">
                      <span>Hazmat surcharge (Non-Peak):</span>
                      <span>+${(fbaData.feeNonPeak - regularFbaData.feeNonPeak).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Hazmat surcharge (Peak):</span>
                      <span>+${(fbaData.feePeak - regularFbaData.feePeak).toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white p-4 rounded-lg border">
              <h4 className="font-semibold text-gray-800 mb-3">Referral Fee</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Category:</span>
                  <span className="font-semibold capitalize">{category || 'Other'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Rate:</span>
                  <span className="font-semibold">{referralData.rate}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Fee:</span>
                  <span className="font-semibold">${referralData.fee.toFixed(2)}</span>
                </div>
                {referralData.error && (
                  <div className="flex justify-between">
                    <span className="text-red-600">Error:</span>
                    <span className="font-semibold text-red-600">{referralData.error}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Total Summary */}
          <div className="bg-white p-4 rounded-lg border">
            <h4 className="font-semibold text-gray-800 mb-3">Total Amazon Fees Summary</h4>
            <div className="mb-4 text-sm text-gray-600 space-y-1">
              <div className="flex justify-between">
                <span>FBA Fulfillment Fees Non-Peak Season / Peak Season:</span>
                <span>${adjustedFBANonPeak.toFixed(2)} / ${adjustedFBAPeak.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>+ Referral Fee:</span>
                <span>${referralData.fee.toFixed(2)}</span>
              </div>
              {sippDiscount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>- SIPP Discount:</span>
                  <span>-${sippDiscount.toFixed(2)}</span>
                </div>
              )}
              {batteryFee > 0 && (
                <div className="flex justify-between">
                  <span>+ Battery Fee:</span>
                  <span>${batteryFee.toFixed(2)}</span>
                </div>
              )}
              {lowPriceDiscount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>- Low Price Discount:</span>
                  <span>-${lowPriceDiscount.toFixed(2)}</span>
                </div>
              )}
              {additionalCosts > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>+ Additional Costs (included in calculations):</span>
                  <span>${additionalCosts.toFixed(2)}</span>
                </div>
              )}
              <hr className="my-2" />
            </div>
            <div className="text-center">
              <div>
                <div className="text-xl font-bold text-red-600">${totalFeesNonPeak.toFixed(2)}</div>
                <div className="text-sm text-gray-600">Total Amazon Fees (Non-Peak)</div>
                <div className="text-lg font-bold text-red-500 mt-1">${totalFeesPeak.toFixed(2)}</div>
                <div className="text-xs text-gray-500">(Peak Season)</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FBACalculation;
