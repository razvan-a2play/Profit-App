"use client";

import React from 'react';
import { DollarSign, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import {
  checkSippEligibility,
  PRICE_BAND_LABEL,
  type AmazonFbaFeeBreakdown,
  type PackagingSaving,
} from "@platform/calc";
import { describeCuts } from "@/lib/packaging-text";

interface FBACalculationProps {
  length: number;
  width: number;
  height: number;
  weight: number;
  category: string;
  additionalCosts?: number;
  sippEligibleOverride?: boolean;
  onSippOverrideChange?: (value: boolean) => void;
  hazmat?: boolean;
  /** The breakdown the P&L total uses, so the card can't disagree with it. */
  fees: AmazonFbaFeeBreakdown;
  /** Same unit without dangerous-goods rates, for the hazmat comparison. */
  regularFees?: AmazonFbaFeeBreakdown | null;
  scheduleNotes?: string[];
  /** Box trims (≤2 cm, one or two sides) that lower the FBA fee. */
  packagingSavings?: PackagingSaving[];
}

const $ = (n: number) => `$${n.toFixed(2)}`;

const FBACalculation: React.FC<FBACalculationProps> = ({
  length,
  width,
  height,
  weight,
  category,
  additionalCosts = 0,
  sippEligibleOverride = true,
  onSippOverrideChange,
  hazmat = false,
  fees,
  regularFees = null,
  scheduleNotes = [],
  packagingSavings = [],
}) => {
  const sippEligible = checkSippEligibility(length, width, height);

  // SIPP dimension checks for display
  const sortedDims = [length / 2.54, width / 2.54, height / 2.54].sort((a, b) => b - a);
  const sippDimChecks = {
    longest: sortedDims[0] > 6,
    median: sortedDims[1] > 4,
    shortest: sortedDims[2] > 0.375,
  };
  const finalSippEligible = fees.sippCertified ? "YES" : "NO";
  const surchargePct = `${(fees.fuelSurchargeRate * 100).toFixed(1)}%`;

  return (
    <div className="bg-yellow-50 p-6 rounded-lg">
      <h3 className="text-lg font-semibold text-yellow-800 mb-4 flex items-center flex-wrap gap-x-3">
        <span className="flex items-center">
          <DollarSign className="w-5 h-5 mr-2" />
          FBA Fees Calculation
        </span>
        <span className="text-sm font-normal text-yellow-700">
          {fees.scheduleLabel} · {PRICE_BAND_LABEL[fees.priceBand]} price column
          {fees.lowPriceExcluded && " (this category doesn't get Low-Price rates under $10)"}
        </span>
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
                <div className="text-xl font-bold text-yellow-600">{fees.tier}</div>
                <div className="text-sm text-gray-600">Size Tier</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-yellow-600">{fees.billableWeight.toFixed(2)} lb</div>
                <div className="text-sm text-gray-600">Billable Weight</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-yellow-600">{fees.dimWeight.toFixed(3)} lb</div>
                <div className="text-sm text-gray-600">Dimensional Weight (Divisor 139)</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-yellow-600">{(weight * 2.20462).toFixed(2)} lb</div>
                <div className="text-sm text-gray-600">Unit Weight</div>
              </div>
            </div>
          </div>

          {/* Packaging check: details live under Packaging Dimensions, where the box is entered */}
          {packagingSavings.length > 0 ? (
            <p className="text-sm text-emerald-700">
              Packaging check: {describeCuts(packagingSavings[0]).toLowerCase()} saves $
              {packagingSavings[0].savingPerUnit.toFixed(2)} per unit
              {packagingSavings.length > 1 &&
                `, up to $${packagingSavings[packagingSavings.length - 1].savingPerUnit.toFixed(2)} with a bigger cut`}
              . Details under Packaging Dimensions.
            </p>
          ) : (
            <p className="text-xs text-gray-500">
              Packaging check: no cut of up to 2 cm on one or two sides of the box lowers the FBA fee.
            </p>
          )}

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
                <div className="mt-3 ml-6 text-center">
                  <div className="text-lg font-bold text-green-600">{$(fees.sippDiscount)}</div>
                  <div className="text-sm text-gray-600">
                    {fees.sippDiscount > 0 ? "SIPP Discount" : "No SIPP discount for this tier"}
                  </div>
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
                    <span className="font-semibold">{$(fees.fulfillmentNonPeak)}</span>
                    {hazmat && regularFees && (
                      <span className="ml-2 text-xs text-gray-400 line-through">
                        {$(regularFees.fulfillmentNonPeak)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Peak Season (Oct 15 – Jan 14):</span>
                  <div className="text-right">
                    <span className="font-semibold">{$(fees.fulfillmentPeak)}</span>
                    {fees.peakEstimate && (
                      <span className="ml-1 text-xs text-amber-700 cursor-help" title={fees.peakEstimate}>
                        estimated
                      </span>
                    )}
                    {hazmat && regularFees && (
                      <span className="ml-2 text-xs text-gray-400 line-through">
                        {$(regularFees.fulfillmentPeak)}
                      </span>
                    )}
                  </div>
                </div>
                {hazmat && regularFees && (
                  <div className="mt-2 pt-2 border-t border-orange-100 text-xs text-orange-600">
                    <div className="flex justify-between">
                      <span>Hazmat surcharge (Non-Peak):</span>
                      <span>+{$(fees.fulfillmentNonPeak - regularFees.fulfillmentNonPeak)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Hazmat surcharge (Peak):</span>
                      <span>+{$(fees.fulfillmentPeak - regularFees.fulfillmentPeak)}</span>
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
                  <span className="font-semibold">{fees.referralRate}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Fee:</span>
                  <span className="font-semibold">{$(fees.referralFee)}</span>
                </div>
                {fees.referralError && (
                  <div className="flex justify-between">
                    <span className="text-red-600">Error:</span>
                    <span className="font-semibold text-red-600">{fees.referralError}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Total Summary */}
          <div className="bg-white p-4 rounded-lg border">
            <h4 className="font-semibold text-gray-800 mb-3">Total Amazon Fees Summary</h4>
            <div className="mb-4 text-sm text-gray-600 space-y-1">
              <div className="flex justify-end text-xs text-gray-400 gap-6 pr-0.5">
                <span>Non-Peak / Peak{fees.peakEstimate ? " (estimated)" : ""}</span>
              </div>
              <div className="flex justify-between">
                <span>FBA Fulfillment Fee:</span>
                <span>{$(fees.fulfillmentNonPeak)} / {$(fees.fulfillmentPeak)}</span>
              </div>
              <div className="flex justify-between">
                <span>+ Fuel &amp; Logistics Surcharge ({surchargePct}):</span>
                <span>{$(fees.surchargeNonPeak)} / {$(fees.surchargePeak)}</span>
              </div>
              {fees.sippDiscount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>- SIPP Discount:</span>
                  <span>-{$(fees.sippDiscount)}</span>
                </div>
              )}
              {fees.packagingFee > 0 && (
                <div className="flex justify-between">
                  <span>+ Packaging Fee (bulky, not SIPP-certified):</span>
                  <span>{$(fees.packagingFee)}</span>
                </div>
              )}
              {fees.handlingFee > 0 && (
                <div className="flex justify-between">
                  <span>+ Oversize Handling Fee (flat product / overhang):</span>
                  <span>{$(fees.handlingFee)}</span>
                </div>
              )}
              {fees.batteryFee > 0 && (
                <div className="flex justify-between">
                  <span>+ Battery Fee:</span>
                  <span>{$(fees.batteryFee)}</span>
                </div>
              )}
              <div className="flex justify-between font-medium text-gray-700">
                <span>= FBA Fee:</span>
                <span>{$(fees.fbaNonPeak)} / {$(fees.fbaPeak)}</span>
              </div>
              <div className="flex justify-between">
                <span>+ Referral Fee:</span>
                <span>{$(fees.referralFee)}</span>
              </div>
              {additionalCosts > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>+ Additional Costs (included in calculations):</span>
                  <span>{$(additionalCosts)}</span>
                </div>
              )}
              <hr className="my-2" />
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-red-600">{$(fees.totalNonPeak)}</div>
              <div className="text-sm text-gray-600">Total Amazon Fees (Non-Peak)</div>
              <div className="text-lg font-bold text-red-500 mt-1">{$(fees.totalPeak)}</div>
              <div className="text-xs text-gray-500">
                (Peak Season{fees.peakEstimate ? ", estimated" : ""})
              </div>
              <div className="mt-3 text-sm text-gray-700">
                Used in the P&amp;L: <span className="font-semibold">{$(fees.totalWeighted)}</span>
                <span className="text-xs text-gray-500"> (9 months non-peak + 3 months peak)</span>
              </div>
              {fees.peakEstimate && (
                <p className="mt-2 text-xs text-amber-700 max-w-md mx-auto">
                  Peak part is estimated. {fees.peakEstimate}
                </p>
              )}
            </div>
            {scheduleNotes.length > 0 && (
              <ul className="mt-4 text-xs text-gray-500 list-disc pl-5 space-y-0.5">
                {scheduleNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FBACalculation;
