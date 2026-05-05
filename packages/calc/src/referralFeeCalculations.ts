/**
 * Centralized referral fee calculations for all platforms
 * 
 * This module provides consistent referral fee calculations to avoid
 * duplication and ensure business logic changes are made in one place.
 */

/**
 * Calculate TikTok Shop referral fee
 * 
 * @param sellingPrice - Product selling price in USD
 * @returns TikTok referral fee (6% of selling price)
 * 
 * Business Rules:
 * - TikTok Shop charges a flat 6% referral fee
 * - Applied to all product categories
 * - Calculated on selling price before other fees
 */
export const calculateTikTokReferralFee = (sellingPrice: number): number => {
  return (sellingPrice || 0) * 0.06;
};

/**
 * Calculate TikTok refund admin fee
 * 
 * @param tikTokReferralFee - The TikTok referral fee amount
 * @returns Refund admin fee (minimum of $5 or 20% of referral fee)
 * 
 * Business Rules:
 * - Admin fee for processing refunds
 * - Capped at minimum of $5 or 20% of referral fee
 * - Used in returns calculations
 */
export const calculateTikTokRefundAdminFee = (tikTokReferralFee: number): number => {
  return Math.min(5, 0.2 * tikTokReferralFee);
};

/**
 * Calculate both TikTok referral fee and refund admin fee together
 * 
 * @param sellingPrice - Product selling price in USD
 * @returns Object containing referral fee and refund admin fee
 * 
 * Convenience function for components that need both values
 */
export const calculateTikTokFees = (sellingPrice: number) => {
  const referralFee = calculateTikTokReferralFee(sellingPrice);
  const refundAdminFee = calculateTikTokRefundAdminFee(referralFee);
  
  return {
    referralFee,
    refundAdminFee,
    total: referralFee + refundAdminFee
  };
};

/**
 * TikTok Shop fee constants
 */
export const TIKTOK_REFERRAL_RATE = 0.06; // 6%
export const TIKTOK_REFUND_ADMIN_FEE_CAP = 5; // $5 maximum
export const TIKTOK_REFUND_ADMIN_FEE_RATE = 0.2; // 20%