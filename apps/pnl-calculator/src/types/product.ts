export interface AdditionalCost {
  id: string;
  name: string;
  value: number | undefined;
  quantity?: number | undefined;
}

export interface SavedVersion {
  id: string; // Supabase UUID — canonical identity, used for all DB writes
  timestamp: string;
  name: string;
  bucket: 'live' | 'rd';
  data: Partial<Product>;
}

export interface Product {
  id: number;
  name: string;
  status: string;
  bucket?: 'live' | 'rd'; // Add bucket for new calculations
  sku: string;
  cost: number | undefined;
  costQuantity: number | undefined;
  retailBoxCost: number | undefined;
  retailBoxCostQuantity: number | undefined;
  cardCost: number | undefined;
  cardCostQuantity: number | undefined;
  userManualCost: number | undefined;
  userManualCostQuantity: number | undefined;
  additionalCosts: AdditionalCost[];
  sellingPrice: number | undefined;
  category: string;
  length: number | undefined;
  width: number | undefined;
  height: number | undefined;
  weight: number | undefined;
  masterCartonLength: number | undefined;
  masterCartonWidth: number | undefined;
  masterCartonHeight: number | undefined;
  masterCartonUnits: number | undefined;
  masterCartonWeight: number | undefined;
  marketingTacos: number;
  marketingTacosPercentage: number;
  marketingAffiliatePercentage: number;
  marketingAffiliateDollar: number;
  marketingAdsPercentage: number;
  marketingAdsDollar: number;
  fulfillmentMethod: string;
  storageMonths: number;
  estimatedReturnsPercentage: number;
  cbmCost: number;
  shippingToAWD: number;
  awdCaseReceiveCost: number;
  awdTransportationCost: number;
  amazonFBAStorageFeeNonPeak: number;
  amazonFBAStorageFeePeak: number;
  amazonAWDStorageFee: number;
  amazonFBAAVGFee: number;
  // Hazmat Storage Fees
  hazmatStorageFeeNonPeak: number;
  hazmatStorageFeePeak: number;
  hazmatOversizeStorageFeeNonPeak: number;
  hazmatOversizeStorageFeePeak: number;
  // Shopify Marketing fields
  shopifyRoas: number;
  shopifyCpa: number;
  shopifyAgencyPercentage: number;
  shopifyCreativePercentage: number;
  shopifyTransactionFeePercentage: number;
  shopifyReturnsPercentage: number;
  // Section descriptions (editable by user)
  productInfoDescription: string;
  factoryPriceDescription: string;
  dimensionsDescription: string;
  // Custom field labels (editable by user)
  productCostLabel: string;
  retailBoxCostLabel: string;
  cardCostLabel: string;
  userManualCostLabel: string;
  // Field visibility tracking
  productCostVisible: boolean;
  retailBoxCostVisible: boolean;
  cardCostVisible: boolean;
  userManualCostVisible: boolean;
  // Notes field
  notes?: string;
  // SIPP eligibility override
  sippEligibleOverride?: boolean;
  // Hazmat classification
  hazmat?: boolean;
  // Contains batteries
  containsBatteries?: boolean;
  // Versions
  savedVersions: SavedVersion[];
}
