"use client";

import React, { useMemo, useEffect, useState, useCallback, memo } from 'react';
import { SimpleSkuSelector } from './SimpleSKUSelector';
import { Save, Trash2, DollarSign, Package, Calculator, TrendingUp, Plus, X, Info, Briefcase, FlaskConical, AlertTriangle } from 'lucide-react';
import VersionManager from './VersionManager';
import { useProductVersions } from '@/hooks/useProductVersions';
import { useProductInfo } from '@/hooks/useProductInfo';
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';
import { Button } from "@platform/ui";
import { Input } from "@platform/ui";
import { Label } from "@platform/ui";
import { Textarea } from "@platform/ui";
import { Checkbox } from "@platform/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@platform/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@platform/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@platform/ui";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@platform/ui";
import { useToast } from "@platform/ui";

// Import new focused components
import ProductBasicInfo from './product/ProductBasicInfo';
import ProductFactoryPrice from './product/ProductFactoryPrice';
import ProductDimensions from './product/ProductDimensions';
import ProductMasterCarton from './product/ProductMasterCarton';
import FBACalculation from './FBACalculation';
import MCFCalculation from './MCFCalculation';
import ThreePLCalculation from './ThreePLCalculation';
import TikTokFBTCalculation from './TikTokFBTCalculation';
import MarketingCalculation from './MarketingCalculation';
import DimensionalCalculations from './DimensionalCalculations';
import { optimizeCarton } from "@platform/calc";
import { calculateStorageMetrics } from "@platform/calc";
import { calculateCBMPerUnit, getCBMPerUnit, getCBFPerUnit } from "@platform/calc";
import { calculateShippingCosts, calculateShippingByStrategy } from "@platform/calc";
import { calculateDimensionalWeight } from "@platform/calc";
import { calculateTikTokReferralFee, calculateTikTokRefundAdminFee, calculateTikTokFees } from "@platform/calc";
import {
  calculateReferralFee,
  calculateFBATierAndFee,
  calculateReturnProcessingFee,
  calculateSippDiscount,
} from '@platform/calc';
import SummaryBar from './SummaryBar';

// Marketing Percentage Input Component to handle controlled input with local state
interface MarketingPercentageInputProps {
  value: number;
  sellingPrice: number;
  productId: number;
  updateProduct: (id: number, field: keyof Product, value: number) => void;
  onLocalChange: (val: number) => void;
}

const MarketingPercentageInput: React.FC<MarketingPercentageInputProps> = ({
  value,
  sellingPrice,
  productId,
  updateProduct,
  onLocalChange
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value === '' ? undefined : parseFloat(e.target.value) || 0;
    onLocalChange(newValue);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const newValue = e.target.value === '' ? undefined : parseFloat(e.target.value) || 0;
    // Persist to product state on blur
    updateProduct(productId, 'marketingTacosPercentage', newValue);
    updateProduct(productId, 'marketingTacos', sellingPrice * newValue / 100);
  };

  return (
    <div className="text-center">
      <Label className="block text-sm font-medium text-card-foreground mb-1">Percentage (%)</Label>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={handleChange}
        onBlur={handleBlur}
        step="0.01"
        min="0"
        max="100"
        placeholder="Enter percentage"
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
      />
    </div>
  );
};

import type { Product, SavedVersion, AdditionalCost } from '@/types/product';

interface ProductCardProps {
  product: Product;
  updateProduct: (id: number, field: keyof Product, value: string | number | AdditionalCost[] | boolean | undefined) => void;
  batchUpdateProduct: (id: number, updates: Partial<Product>) => void;
  removeProduct: (id: number) => void;
  loadProductVersion: (id: number, version: SavedVersion) => void;
  deleteProductVersion: (id: number, versionId: string) => void;
  onCreateNewCalculation: (productId: number) => void;
  canRemove: boolean;
  showAmazonFBA?: boolean;
  showTikTokShop?: boolean;

  showShopify?: boolean;
  calculatorMode?: 'pre-launch' | 'legacy' | null;
  showSummaryBar?: boolean;
}

const categories = [
  'amazon device accessories',
  'automotive and powersports',
  'baby products',
  'backpacks, handbags, and luggage',
  'beauty',
  'books',
  'cell phone devices',
  'cell phone accessories',
  'clothing and accessories',
  'computers',
  'consumer electronics',
  'electronics accessories',
  'furniture and decor',
  'grocery and gourmet food',
  'health and personal care',
  'home and garden',
  'industrial and scientific',
  'jewelry',
  'musical instruments',
  'office products',
  'personal computers',
  'pet supplies',
  'shoes, handbags, and sunglasses',
  'sports and outdoors',
  'toys and games',
  'watches'
];

const ProductCard = memo<ProductCardProps>(({
  product,
  updateProduct,
  batchUpdateProduct,
  removeProduct,
  loadProductVersion,
  deleteProductVersion,
  onCreateNewCalculation,
  canRemove,
  showAmazonFBA = false,
  showTikTokShop = false,
  showShopify = false,
  calculatorMode,
  showSummaryBar = false,
}) => {
  // Performance monitoring
  usePerformanceMonitor('ProductCard');
  // Use Supabase hooks for data management
  const { 
    savedVersions, 
    loading: versionsLoading, 
    saveVersion, 
    deleteVersion, 
    updateVersion, 
    renameVersion,
    loadDeletedVersions,
    restoreVersion,
    permanentlyDeleteVersion
  } = useProductVersions(product.id);
  const { productInfoList, loading: productInfoLoading, getProductBySKU } = useProductInfo();

  // Debug logging removed for production
  
  // Local state for Marketing Percentage to reflect changes instantly with persistence
  const getStoredMarketingPercent = () => {
    const stored = localStorage.getItem(`marketingPercent_${product.id}`);
    return stored ? parseFloat(stored) : product.marketingTacosPercentage;
  };
  
  const [marketingPercentLocal, setMarketingPercentLocal] = useState<number>(getStoredMarketingPercent());
  
  // Persist marketing percentage to localStorage whenever it changes
  const updateMarketingPercentLocal = (value: number) => {
    setMarketingPercentLocal(value);
    localStorage.setItem(`marketingPercent_${product.id}`, value.toString());
  };
  
  // Only reset local state when product ID changes (different product)
  useEffect(() => {
    const storedValue = getStoredMarketingPercent();
    setMarketingPercentLocal(storedValue);
  }, [product.id]);
  
  // Auto-calculate marketing tacos when selling price or percentage changes
  useEffect(() => {
    const calculatedMarketingTacos = (product.sellingPrice ?? 0) * marketingPercentLocal / 100;
    if (Math.abs((product.marketingTacos ?? 0) - calculatedMarketingTacos) > 0.001) {
      updateProduct(product.id, 'marketingTacos', calculatedMarketingTacos);
    }
  }, [product.sellingPrice, marketingPercentLocal, product.id]);
  
  // Validation for mandatory fields based on calculator mode
  const isFieldRequired = (field: 'sku' | 'sellingPrice' | 'category') => {
    if (field === 'sku') return calculatorMode === 'legacy';
    if (field === 'sellingPrice' || field === 'category') return true;
    return false;
  };
  
  const isFieldEmpty = (field: 'sku' | 'sellingPrice' | 'category') => {
    if (field === 'sku') return !product.sku || product.sku === '';
    if (field === 'sellingPrice') return (product.sellingPrice ?? 0) <= 0;
    if (field === 'category') return !product.category || product.category === 'other' || product.category === '';
    return false;
  };
  
  const getFieldValidationClass = (field: 'sku' | 'sellingPrice' | 'category') => {
    if (isFieldRequired(field) && isFieldEmpty(field)) {
      return 'border-destructive focus:border-destructive';
    }
    return '';
  };
  // Render debug removed

  // State for controlling section visibility
  const [showAdvancedSections, setShowAdvancedSections] = useState(false);
  
  // State for tracking TikTok FBT, Marketing, MCF, and 3PL subtotals
  const [tikTokFBTSubtotal, setTikTokFBTSubtotal] = useState(0);
  const [tikTokFBTBreakdown, setTikTokFBTBreakdown] = useState({
    fbtFee: 0,
    storageCost: 0,
    placementFee: 0,
    shippingCost: 0,
    subtotal: 0
  });
  const [marketingSubtotal, setMarketingSubtotal] = useState(0);
  const [mcfFee, setMcfFee] = useState(0);
  const [mcfStorageFee, setMcfStorageFee] = useState(0);
  const [mcfFeeShopify, setMcfFeeShopify] = useState(0);
  const [mcfStorageFeeShopify, setMcfStorageFeeShopify] = useState(0);
  const [threePlFee, setThreePlFee] = useState(0);
  const [threePlStorageFee, setThreePlStorageFee] = useState(0);
  const [threePlTotalFee, setThreePlTotalFee] = useState(0);
  const [skuPopoverOpen, setSkuPopoverOpen] = useState(false);
  const [selectedWarehouse, setSelectedWarehouse] = useState<'stephen' | 'inandout'>('stephen');
  
  const { toast } = useToast();
  
  // Memoize heavy calculations
  const fbaData = useMemo(() => (
    calculateFBATierAndFee(product.length ?? 0, product.width ?? 0, product.height ?? 0, product.weight ?? 0, product.sellingPrice ?? 0, product.hazmat || false)
  ), [product.length, product.width, product.height, product.weight, product.sellingPrice, product.hazmat]);

  const referralData = useMemo(() => (
    calculateReferralFee(product.category, product.sellingPrice ?? 0)
  ), [product.category, product.sellingPrice]);

  // Memoize carton optimization to avoid redundant calculations
  const memoizedCartonOptimization = useMemo(() => {
    if ((product.length ?? 0) > 0 && (product.width ?? 0) > 0 && (product.height ?? 0) > 0 && (product.weight ?? 0) > 0) {
      return optimizeCarton(product.length ?? 0, product.width ?? 0, product.height ?? 0, product.weight ?? 0);
    }
    return null;
  }, [product.length, product.width, product.height, product.weight]);

  // Memoize shipping calculations to avoid redundant calculations
  const memoizedShippingCalculation = useMemo(() => {
    return calculateShippingCosts({
      length: product.length,
      width: product.width,
      height: product.height,
      weight: product.weight,
      masterCartonLength: product.masterCartonLength,
      masterCartonWidth: product.masterCartonWidth,
      masterCartonHeight: product.masterCartonHeight,
      masterCartonUnits: product.masterCartonUnits,
      cbmCost: product.cbmCost,
      shippingToAWD: product.shippingToAWD,
      awdCaseReceiveCost: product.awdCaseReceiveCost,
      awdTransportationCost: product.awdTransportationCost,
      amazonAWDStorageFee: product.amazonAWDStorageFee,
      storageMonths: product.storageMonths,
      calculatorMode
    });
  }, [product.length, product.width, product.height, product.weight, product.masterCartonLength, product.masterCartonWidth, product.masterCartonHeight, product.masterCartonUnits, product.cbmCost, product.shippingToAWD, product.awdCaseReceiveCost, product.awdTransportationCost, product.amazonAWDStorageFee, product.storageMonths, calculatorMode]);

  // Extract CBM values for backward compatibility
  const memoizedCBMResult = {
    cbmPerUnit: memoizedShippingCalculation.cbmPerUnit,
    cbfPerUnit: memoizedShippingCalculation.cbfPerUnit,
    units: memoizedShippingCalculation.units,
    calculationSource: memoizedShippingCalculation.calculationSource,
    sourceDescription: memoizedShippingCalculation.calculationSource
  };

  // Derived shipping/storage values — pure functions of inputs. Replaces the
  // previous write-during-render useEffect that stored these on parent state.
  const derivedShipping = useMemo(() => {
    const { cbmPerUnit, cbfPerUnit, units } = memoizedShippingCalculation;
    return {
      shippingToAMZ: cbmPerUnit * (product.cbmCost || 0),
      awdReceivingCost: units > 0 ? (product.awdCaseReceiveCost || 0) / units : 0,
      storageAWDCost: cbfPerUnit * (product.amazonAWDStorageFee || 0) * (product.storageMonths || 0),
    };
  }, [
    memoizedShippingCalculation,
    product.cbmCost,
    product.awdCaseReceiveCost,
    product.amazonAWDStorageFee,
    product.storageMonths,
  ]);

  // Memoize storage metrics calculation to avoid redundant calculations
  const memoizedStorageMetrics = useMemo(() => {
    const { cbfPerUnit } = memoizedShippingCalculation;
    
    // Determine if product is oversize (Large bulky or Extra-large)
    const lengthIn = (product.length || 0) / 2.54;
    const widthIn = (product.width || 0) / 2.54;
    const heightIn = (product.height || 0) / 2.54;
    const weightLb = (product.weight || 0) / 0.453592;
    const dims = [lengthIn, widthIn, heightIn].sort((a, b) => b - a);
    const [longest, median, shortest] = dims;
    
    // Check size tier - oversize is Large bulky (>20lb or dims exceed large standard) or Extra-large
    const isOversize = weightLb > 20 || longest > 18 || median > 14 || shortest > 8;
    
    // Calculate appropriate AVG fee based on hazmat status and size tier
    let amazonFBAAVGFee: number;
    if (product.hazmat) {
      if (isOversize) {
        // Use Hazmat Oversize rates
        const nonPeak = product.hazmatOversizeStorageFeeNonPeak || 0.78;
        const peak = product.hazmatOversizeStorageFeePeak || 2.43;
        amazonFBAAVGFee = (nonPeak * 9 + peak * 3) / 12;
      } else {
        // Use Hazmat Standard rates
        const nonPeak = product.hazmatStorageFeeNonPeak || 0.99;
        const peak = product.hazmatStorageFeePeak || 3.63;
        amazonFBAAVGFee = (nonPeak * 9 + peak * 3) / 12;
      }
    } else {
      // Use regular FBA rates
      amazonFBAAVGFee = (product.amazonFBAStorageFeeNonPeak * 9 + product.amazonFBAStorageFeePeak * 3) / 12;
    }
    
    return calculateStorageMetrics({
      cbfPerUnit,  
      amazonFBAAVGFee,
      storageMonths: product.storageMonths,
      storageDays: 30,
      length: product.length,
      width: product.width,
      height: product.height
    });
  }, [memoizedShippingCalculation, product.amazonFBAStorageFeeNonPeak, product.amazonFBAStorageFeePeak, product.storageMonths, product.length, product.width, product.height, product.hazmat, product.hazmatStorageFeeNonPeak, product.hazmatStorageFeePeak, product.hazmatOversizeStorageFeeNonPeak, product.hazmatOversizeStorageFeePeak]);

  // Calculate regular (non-hazmat) storage for comparison when hazmat is enabled
  const regularStorageMetrics = useMemo(() => {
    if (!product.hazmat) return null;
    
    const { cbfPerUnit } = memoizedShippingCalculation;
    const regularAVGFee = (product.amazonFBAStorageFeeNonPeak * 9 + product.amazonFBAStorageFeePeak * 3) / 12;
    
    return calculateStorageMetrics({
      cbfPerUnit,
      amazonFBAAVGFee: regularAVGFee,
      storageMonths: product.storageMonths,
      storageDays: 30,
      length: product.length,
      width: product.width,
      height: product.height
    });
  }, [memoizedShippingCalculation, product.amazonFBAStorageFeeNonPeak, product.amazonFBAStorageFeePeak, product.storageMonths, product.length, product.width, product.height, product.hazmat]);

  // Calculate hazmat-aware AVG fee for use in MCF and other calculations
  const hazmatAwareAVGFee = useMemo(() => {
    // Determine if product is oversize (Large bulky or Extra-large)
    const lengthIn = (product.length || 0) / 2.54;
    const widthIn = (product.width || 0) / 2.54;
    const heightIn = (product.height || 0) / 2.54;
    const weightLb = (product.weight || 0) / 0.453592;
    const dims = [lengthIn, widthIn, heightIn].sort((a, b) => b - a);
    const [longest, median, shortest] = dims;
    
    // Check size tier - oversize is Large bulky (>20lb or dims exceed large standard) or Extra-large
    const isOversize = weightLb > 20 || longest > 18 || median > 14 || shortest > 8;
    
    if (product.hazmat) {
      if (isOversize) {
        const nonPeak = product.hazmatOversizeStorageFeeNonPeak || 0.78;
        const peak = product.hazmatOversizeStorageFeePeak || 2.43;
        return (nonPeak * 9 + peak * 3) / 12;
      } else {
        const nonPeak = product.hazmatStorageFeeNonPeak || 0.99;
        const peak = product.hazmatStorageFeePeak || 3.63;
        return (nonPeak * 9 + peak * 3) / 12;
      }
    } else {
      return (product.amazonFBAStorageFeeNonPeak * 9 + product.amazonFBAStorageFeePeak * 3) / 12;
    }
  }, [product.length, product.width, product.height, product.weight, product.hazmat, product.amazonFBAStorageFeeNonPeak, product.amazonFBAStorageFeePeak, product.hazmatStorageFeeNonPeak, product.hazmatStorageFeePeak, product.hazmatOversizeStorageFeeNonPeak, product.hazmatOversizeStorageFeePeak]);

  // Handle SKU selection and auto-population
  const handleSKUSelect = (productData: any) => {
    const updates = {
      sku: productData.sku,
      name: productData.name,
      factoryPriceInputs: productData.factoryPriceInputs,
      length: productData.length,
      width: productData.width,
      height: productData.height,
      weight: productData.weight,
      masterCartonLength: productData.masterCartonLength,
      masterCartonWidth: productData.masterCartonWidth,
      masterCartonHeight: productData.masterCartonHeight,
      masterCartonUnits: productData.masterCartonUnits,
      masterCartonWeight: productData.masterCartonWeight
    };
    
    // Update all fields at once
    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        updateProduct(product.id, key as any, value);
      }
    });
  };

  // Handle SKU selection from dropdown and auto-populate all fields
  const handleSKUChange = (selectedSKU: string) => {
    // Get product info from Supabase data
    const productInfo = getProductBySKU(selectedSKU);
    if (productInfo) {
      // Build the batch update object
      const updates: Partial<Product> = {
        sku: selectedSKU
      };
      
      // Auto-populate product name
      if (productInfo['Product Name']) {
        updates.name = productInfo['Product Name'];
      }
      
      // Auto-populate packaging dimensions from Supabase data (only if they exist and are not null)
      if (productInfo['Product box Length'] && productInfo['Product box Length'] !== null) {
        const length = typeof productInfo['Product box Length'] === 'string' 
          ? parseFloat(productInfo['Product box Length']) 
          : productInfo['Product box Length'];
        if (length > 0) {
          updates.length = length;
        }
      }
      
      if (productInfo['Product box Width'] && productInfo['Product box Width'] !== null && productInfo['Product box Width'] > 0) {
        updates.width = productInfo['Product box Width'];
      }
      
      if (productInfo['Product box Height'] && productInfo['Product box Height'] !== null && productInfo['Product box Height'] > 0) {
        updates.height = productInfo['Product box Height'];
      }
      
      if (productInfo['Product box weight (kg)'] && productInfo['Product box weight (kg)'] !== null && productInfo['Product box weight (kg)'] > 0) {
        updates.weight = productInfo['Product box weight (kg)'];
      }
      
      // Auto-populate master carton dimensions (only if they exist and are not null)
      if (productInfo['Carton Length'] && productInfo['Carton Length'] !== null) {
        const cartonLength = typeof productInfo['Carton Length'] === 'string' 
          ? parseFloat(productInfo['Carton Length']) 
          : productInfo['Carton Length'];
        if (cartonLength > 0) {
          updates.masterCartonLength = cartonLength;
        }
      }
      
      if (productInfo['Carton Width'] && productInfo['Carton Width'] !== null && productInfo['Carton Width'] > 0) {
        updates.masterCartonWidth = productInfo['Carton Width'];
      }
      
      if (productInfo['Carton Height'] && productInfo['Carton Height'] !== null && productInfo['Carton Height'] > 0) {
        updates.masterCartonHeight = productInfo['Carton Height'];
      }
      
      if (productInfo['Units/carton'] && productInfo['Units/carton'] !== null && productInfo['Units/carton'] > 0) {
        updates.masterCartonUnits = productInfo['Units/carton'];
      }
      
      if (productInfo['Carton weight'] && productInfo['Carton weight'] !== null && productInfo['Carton weight'] > 0) {
        updates.masterCartonWeight = productInfo['Carton weight'];
      }
      
      // Apply all updates at once
      batchUpdateProduct(product.id, updates);
      
      toast({
        title: "Product Data Loaded",
        description: `Auto-populated available fields for SKU: ${selectedSKU}`,
      });
    } else {
      // Just update SKU if no product info found
      updateProduct(product.id, 'sku', selectedSKU);
    }
  };
  
  // Check if user has entered basic product information
  const hasBasicInfo = product.name || (product.sellingPrice ?? 0) > 0 || (product.length ?? 0) > 0 || (product.width ?? 0) > 0 || (product.height ?? 0) > 0 || (product.weight ?? 0) > 0;
  
  // Check if all Master Carton Final Packing fields are filled
  const isMasterCartonComplete = (product.masterCartonLength ?? 0) > 0 && 
                                (product.masterCartonWidth ?? 0) > 0 && 
                                (product.masterCartonHeight ?? 0) > 0 && 
                                (product.masterCartonUnits ?? 0) > 0 && 
                                (product.masterCartonWeight ?? 0) > 0;
  
  // Show advanced sections logic
  const shouldShowRestOfSections = showAdvancedSections;
  
  // Functions for managing additional costs
  const addAdditionalCost = () => {
    const newCost: AdditionalCost = {
      id: Date.now().toString(),
      name: '',
      value: undefined,
      quantity: 0
    };
    const updatedCosts = [...product.additionalCosts, newCost];
    updateProduct(product.id, 'additionalCosts', updatedCosts);
  };

  const updateAdditionalCost = (costId: string, field: 'name' | 'value' | 'quantity', value: string | number) => {
    const updatedCosts = product.additionalCosts.map(cost => 
      cost.id === costId ? { ...cost, [field]: value } : cost
    );
    updateProduct(product.id, 'additionalCosts', updatedCosts);
  };

  const removeAdditionalCost = (costId: string) => {
    const updatedCosts = product.additionalCosts.filter(cost => cost.id !== costId);
    updateProduct(product.id, 'additionalCosts', updatedCosts);
  };

  // Calculate total cost including additional costs with quantities
  const additionalCostsTotal = product.additionalCosts.reduce((sum, cost) => sum + ((cost.value ?? 0) * (cost.quantity ?? 1)), 0);
  
  // Helper function to calculate factory price inputs based on field visibility
  const calculateFactoryPriceInputs = (product: Product, additionalCostsTotal: number) => {
    let total = 0;
    
    // Only include costs for visible fields, multiplied by quantity
    if (product.productCostVisible !== false) {
      total += (product.cost ?? 0) * (product.costQuantity ?? 1);
    }
    if (product.retailBoxCostVisible !== false) {
      total += (product.retailBoxCost ?? 0) * (product.retailBoxCostQuantity ?? 1);
    }
    if (product.cardCostVisible !== false) {
      total += (product.cardCost ?? 0) * (product.cardCostQuantity ?? 1);
    }
    if (product.userManualCostVisible !== false) {
      total += (product.userManualCost ?? 0) * (product.userManualCostQuantity ?? 1);
    }
    
    // Always include additional costs with their quantities
    total += product.additionalCosts.reduce((sum, cost) => sum + ((cost.value ?? 0) * (cost.quantity ?? 1)), 0);
    
    return total;
  };
  
  // Centralized MCF Total Cost calculation function for Shopify
  const calculateMCFTotalCost = useCallback(() => {
    const factoryPriceInputs = calculateFactoryPriceInputs(product, additionalCostsTotal);
    
    // MCF Fee and Storage Fee (from MCF Shopify component)
    const mcfFeeValue = mcfFeeShopify;
    const storageFeeValue = mcfStorageFeeShopify;
    
    // Calculate Total Shopify Marketing
    const totalMedia = product.shopifyRoas > 0 ? (product.sellingPrice || 0) / product.shopifyRoas : 0;
    const agencyPercentage = product.shopifyAgencyPercentage || 8;
    const creativePercentage = product.shopifyCreativePercentage || 7;
    const agencyCost = totalMedia * agencyPercentage / 100;
    const creativeCost = totalMedia * creativePercentage / 100;
    const totalShopifyMarketing = totalMedia + agencyCost + creativeCost;
    
    // Calculate Transaction Fee
    const transactionFeePercentage = product.shopifyTransactionFeePercentage || 3;
    const transactionFee = (product.sellingPrice || 0) * transactionFeePercentage / 100;
    
    // Calculate Shopify Returns
    const returnsPercentage = product.shopifyReturnsPercentage || 5;
    const shopifyReturns = (product.sellingPrice || 0) * returnsPercentage / 100;
    
              // Calculate Shipping to AMZ - USE THE ACTUAL FIELD VALUE, NOT RECALCULATE
              const shippingToAMZ = derivedShipping.shippingToAMZ || 0;
    
    // Total Cost = Factory Price Inputs + MCF Fee + Storage Fee + Total Shopify Marketing + Transaction Fee + Shopify Returns + Shipping to AMZ
    const mcfTotalCost = factoryPriceInputs + mcfFeeValue + storageFeeValue + totalShopifyMarketing + transactionFee + shopifyReturns + shippingToAMZ;
    
    return mcfTotalCost;
  }, [
    product.cost, 
    product.retailBoxCost, 
    product.cardCost, 
    product.userManualCost, 
    additionalCostsTotal, 
    mcfFeeShopify, 
    mcfStorageFeeShopify, 
    product.shopifyRoas, 
    product.shopifyAgencyPercentage, 
    product.shopifyCreativePercentage, 
    product.shopifyTransactionFeePercentage, 
    product.shopifyReturnsPercentage, 
    product.sellingPrice,
    derivedShipping.shippingToAMZ
  ]);

  // TikTok MCF Total Cost calculation function
  const calculateTikTokMCFTotalCost = useCallback(() => {
    const factoryPriceInputs = calculateFactoryPriceInputs(product, additionalCostsTotal);
    
    // Shipping components
    const shippingToAMZValue = derivedShipping.shippingToAMZ || 0;
    const awdReceivingCostValue = derivedShipping.awdReceivingCost || 0;
    const storageAWDValue = derivedShipping.storageAWDCost || 0;
    const shippingComponent = (0.3 * shippingToAMZValue) + (0.7 * (shippingToAMZValue + awdReceivingCostValue + storageAWDValue));
    
    // TikTok Referral Fee
    const tikTokReferralFee = calculateTikTokReferralFee(product.sellingPrice || 0);
    
    // MCF Estimated Returns Cost
    const refundAdminFee = calculateTikTokRefundAdminFee(tikTokReferralFee);
    const mcfEstimatedReturnsCost = (product.estimatedReturnsPercentage / 100) * 
      (refundAdminFee + mcfFee + mcfStorageFee + factoryPriceInputs + shippingComponent);
    
    // Marketing Costs Total
    const marketingCostsTotal = marketingSubtotal;
    
    // Total Cost = Factory Price Inputs + MCF Fee + Shipping Component + TikTok Referral Fee + MCF Estimated Returns Cost + Marketing Costs Total
    const tikTokMcfTotalCost = factoryPriceInputs + mcfFee + shippingComponent + tikTokReferralFee + mcfEstimatedReturnsCost + marketingCostsTotal;
    
    return tikTokMcfTotalCost;
  }, [
    product.cost, 
    product.retailBoxCost, 
    product.cardCost, 
    product.userManualCost, 
    additionalCostsTotal, 
    mcfFee, 
    mcfStorageFee,
    derivedShipping.shippingToAMZ,
    derivedShipping.awdReceivingCost,
    derivedShipping.storageAWDCost,
    product.sellingPrice,
    product.estimatedReturnsPercentage,
    marketingSubtotal
  ]);
  
  
  // Calculate different total costs based on context
  let totalCost = (product.cost ?? 0) + (product.retailBoxCost ?? 0) + (product.cardCost ?? 0) + (product.userManualCost ?? 0) + additionalCostsTotal;
  
  // For Amazon FBA context, use the specified formula
  if (showAmazonFBA) {
    // Factory Price Inputs
    const factoryPriceInputs = calculateFactoryPriceInputs(product, additionalCostsTotal);
    
    // Total Amazon Fees calculation
    // Use memoized values to avoid recalculations on each render
    // fbaData and referralData are defined above with useMemo
    // Use sorted dimensions for SIPP eligibility (same as FBACalculation component)
    const dims = [(product.length ?? 0) / 2.54, (product.width ?? 0) / 2.54, (product.height ?? 0) / 2.54].sort((a, b) => b - a);
    const sippEligible = dims[0] > 6 && dims[1] > 4 && dims[2] > 0.375;
    const finalSippEligible = sippEligible && (product.sippEligibleOverride ?? true);
    const sippDiscount = finalSippEligible ? calculateSippDiscount(fbaData.tier, fbaData.billableWeight * 16) : 0;
    const lowPriceDiscount = (product.sellingPrice ?? 0) < 10 ? 0.77 : 0;
    
    const totalAmazonFeesNonPeak = Math.max(0, fbaData.feeNonPeak - lowPriceDiscount) + referralData.fee - sippDiscount;
    const totalAmazonFeesPeak = Math.max(0, fbaData.feePeak - lowPriceDiscount) + referralData.fee - sippDiscount;
    
    // Weighted average: (Non-Peak * 9 + Peak * 3) / 12
    const weightedAmazonFees = (totalAmazonFeesNonPeak * 9 + totalAmazonFeesPeak * 3) / 12;
    
    // Shipping & Storage Total calculation - includes all shipping and storage costs based on fulfillment method
    const { cbmPerUnit, cbfPerUnit, units } = memoizedCBMResult;
    const shippingToAMZCost = cbmPerUnit * product.cbmCost;
    const shippingToAWDCost = cbmPerUnit * product.shippingToAWD;
    const awdReceivingCost = units > 0 ? product.awdCaseReceiveCost / units : 0;
    const transferAWDToFBACost = cbfPerUnit * product.awdTransportationCost;
    const amazonFBAAVGFee = (product.amazonFBAStorageFeeNonPeak * 9 + product.amazonFBAStorageFeePeak * 3) / 12;
    const storageResults = calculateStorageMetrics({
      cbfPerUnit,
      amazonFBAAVGFee,
      storageMonths: product.storageMonths
    });
    const storageFBACost = storageResults.storageFBA;
    const storageAWDCost = storageResults.storageAWD;
    
    let shippingStorageTotal = 0;
    if (product.fulfillmentMethod === '100% FBA') {
      shippingStorageTotal = shippingToAMZCost + storageFBACost;
    } else if (product.fulfillmentMethod === '30% FBA - 70% AWD') {
      shippingStorageTotal = (0.3 * (shippingToAMZCost + storageFBACost)) + (0.7 * (shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + storageAWDCost + storageFBACost));
    } else if (product.fulfillmentMethod === '50% FBA - 50% AWD') {
      shippingStorageTotal = (0.5 * (shippingToAMZCost + storageFBACost)) + (0.5 * (shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + storageAWDCost + storageFBACost));
    } else if (product.fulfillmentMethod === '70% FBA - 30% AWD') {
      shippingStorageTotal = (0.7 * (shippingToAMZCost + storageFBACost)) + (0.3 * (shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + storageAWDCost + storageFBACost));
    } else if (product.fulfillmentMethod === '100% AWD') {
      shippingStorageTotal = shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + (storageAWDCost/2) + storageFBACost;
    } else {
      shippingStorageTotal = shippingToAMZCost + storageFBACost;
    }
    
    // Marketing TACOS calculation (dynamic from current percentage)
    const marketingTacos = product.sellingPrice * (marketingPercentLocal || 0) / 100;
    
    // Total Refund Cost/Unit calculation (must match the value shown in the Customer Returns card)
    const returnsRate = product.estimatedReturnsPercentage / 100;
    const refundAdminFee = Math.min(5, 0.2 * referralData.fee);
    const shippingWeightOz = fbaData.billableWeight * 16;
    const returnProcessingFee = calculateReturnProcessingFee(fbaData.tier, shippingWeightOz);

    // Use the same weighted FBA fees used for display (no low-price discount or referral fee included here)
    const returnsWeightedFBAFees = (fbaData.feeNonPeak * 9 + fbaData.feePeak * 3) / 12;

    // Factory inputs used for returns calc (align with UI: include additionalCosts to match main calculation)
    const returnsFactoryInputs = (product.cost ?? 0) + (product.retailBoxCost ?? 0) + (product.cardCost ?? 0) + (product.userManualCost ?? 0) + additionalCostsTotal;

    const totalRefundCostPerUnit = returnsRate * (
      returnsFactoryInputs +
      shippingStorageTotal +
      refundAdminFee +
      returnProcessingFee +
      returnsWeightedFBAFees -
      sippDiscount
    );
    
    // Final formula: Factory Price Inputs + Weighted Amazon Fees + Shipping & Storage Total + Marketing TACOS + Total Refund Cost/Unit
    totalCost = factoryPriceInputs + weightedAmazonFees + shippingStorageTotal + marketingTacos + totalRefundCostPerUnit;
  }
  
  const profit = (product.sellingPrice ?? 0) - totalCost;
  const profitMargin = (product.sellingPrice ?? 0) > 0 ? (profit / (product.sellingPrice ?? 0)) * 100 : 0;
  
  // Prepare debug data for UI display
  const debugData = {
    modeFlags: {
      showAmazonFBA,
      showTikTokShop,
      calculatorMode
    },
    calculation: showAmazonFBA ? {
      mode: 'Amazon FBA',
      factoryPriceInputs: calculateFactoryPriceInputs(product, additionalCostsTotal),
      additionalCostsTotal,
      totalCost,
      breakdown: {
        productCost: product.cost,
        retailBoxCost: product.retailBoxCost,
        cardCost: product.cardCost,
        userManualCost: product.userManualCost,
        additionalCosts: additionalCostsTotal
      },
      // Add detailed Amazon FBA total cost components
      totalCostComponents: {
        factoryPriceInputs: calculateFactoryPriceInputs(product, additionalCostsTotal),
        weightedAmazonFees: (() => {
          const dims = [product.length / 2.54, product.width / 2.54, product.height / 2.54].sort((a, b) => b - a);
          const sippEligible = dims[0] > 6 && dims[1] > 4 && dims[2] > 0.375;
          const finalSippEligible = sippEligible && (product.sippEligibleOverride ?? true);
          const sippDiscount = finalSippEligible ? calculateSippDiscount(fbaData.tier, fbaData.billableWeight * 16) : 0;
          const lowPriceDiscount = product.sellingPrice < 10 ? 0.77 : 0;
          
          const totalAmazonFeesNonPeak = Math.max(0, fbaData.feeNonPeak - lowPriceDiscount) + referralData.fee - sippDiscount;
          const totalAmazonFeesPeak = Math.max(0, fbaData.feePeak - lowPriceDiscount) + referralData.fee - sippDiscount;
          
          return (totalAmazonFeesNonPeak * 9 + totalAmazonFeesPeak * 3) / 12;
        })(),
        shippingStorageTotal: (() => {
          // Use memoized storage calculation instead of redundant calculation
          const { cbmPerUnit, cbfPerUnit, units } = memoizedCBMResult;
          const { storageFBA, storageAWD } = memoizedStorageMetrics;
          
          const shippingToAMZCost = cbmPerUnit * product.cbmCost;
          const shippingToAWDCost = cbmPerUnit * product.shippingToAWD;
          const awdReceivingCost = units > 0 ? product.awdCaseReceiveCost / units : 0;
          const transferAWDToFBACost = cbfPerUnit * product.awdTransportationCost;
          
          if (product.fulfillmentMethod === '100% FBA') {
            return shippingToAMZCost + storageFBA;
          } else if (product.fulfillmentMethod === '30% FBA - 70% AWD') {
            return (0.3 * (shippingToAMZCost + storageFBA)) + (0.7 * (shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + storageAWD + storageFBA));
          } else if (product.fulfillmentMethod === '50% FBA - 50% AWD') {
            return (0.5 * (shippingToAMZCost + storageFBA)) + (0.5 * (shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + storageAWD + storageFBA));
          } else if (product.fulfillmentMethod === '70% FBA - 30% AWD') {
            return (0.7 * (shippingToAMZCost + storageFBA)) + (0.3 * (shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + storageAWD + storageFBA));
          } else if (product.fulfillmentMethod === '100% AWD') {
            return shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + (storageAWD/2) + storageFBA;
          } else {
            return shippingToAMZCost + storageFBA;
          }
        })(),
        marketingTacos: product.sellingPrice * (marketingPercentLocal || 0) / 100,
        totalRefundCostPerUnit: (() => {
          const cbmResult = memoizedCBMResult;
          
          const { cbmPerUnit, cbfPerUnit, units } = cbmResult;
          
          const returnsRate = product.estimatedReturnsPercentage / 100;
          const refundAdminFee = Math.min(5, 0.2 * referralData.fee);
          const shippingWeightOz = fbaData.billableWeight * 16;
          const returnProcessingFee = calculateReturnProcessingFee(fbaData.tier, shippingWeightOz);
          const returnsWeightedFBAFees = (fbaData.feeNonPeak * 9 + fbaData.feePeak * 3) / 12;
          const dims = [(product.length ?? 0) / 2.54, (product.width ?? 0) / 2.54, (product.height ?? 0) / 2.54].sort((a, b) => b - a);
          const sippEligible = dims[0] > 6 && dims[1] > 4 && dims[2] > 0.375;
          const finalSippEligible = sippEligible && (product.sippEligibleOverride ?? true);
          const sippDiscount = finalSippEligible ? calculateSippDiscount(fbaData.tier, fbaData.billableWeight * 16) : 0;
          const returnsFactoryInputs = (product.cost ?? 0) + (product.retailBoxCost ?? 0) + (product.cardCost ?? 0) + (product.userManualCost ?? 0) + additionalCostsTotal;
          
          const shippingToAMZCost = cbmPerUnit * product.cbmCost;
          const shippingToAWDCost = cbmPerUnit * product.shippingToAWD;
          const awdReceivingCost = units > 0 ? product.awdCaseReceiveCost / units : 0;
          const transferAWDToFBACost = cbfPerUnit * product.awdTransportationCost;
          const amazonFBAAVGFee = (product.amazonFBAStorageFeeNonPeak * 9 + product.amazonFBAStorageFeePeak * 3) / 12;
          const storageResults = calculateStorageMetrics({
            cbfPerUnit,
            amazonFBAAVGFee,
            storageMonths: product.storageMonths
          });
          
          const storageFBACost = storageResults.storageFBA;
          const storageAWDCost = storageResults.storageAWD;
          
          let shippingStorageTotal = 0;
          if (product.fulfillmentMethod === '100% FBA') {
            shippingStorageTotal = shippingToAMZCost + storageFBACost;
          } else if (product.fulfillmentMethod === '30% FBA - 70% AWD') {
            shippingStorageTotal = (0.3 * (shippingToAMZCost + storageFBACost)) + (0.7 * (shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + storageAWDCost + storageFBACost));
          } else if (product.fulfillmentMethod === '50% FBA - 50% AWD') {
            shippingStorageTotal = (0.5 * (shippingToAMZCost + storageFBACost)) + (0.5 * (shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + storageAWDCost + storageFBACost));
          } else if (product.fulfillmentMethod === '70% FBA - 30% AWD') {
            shippingStorageTotal = (0.7 * (shippingToAMZCost + storageFBACost)) + (0.3 * (shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + storageAWDCost + storageFBACost));
          } else if (product.fulfillmentMethod === '100% AWD') {
            shippingStorageTotal = shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + (storageAWDCost/2) + storageFBACost;
          } else {
            shippingStorageTotal = shippingToAMZCost + storageFBACost;
          }
          
          return returnsRate * (
            returnsFactoryInputs +
            shippingStorageTotal +
            refundAdminFee +
            returnProcessingFee +
            returnsWeightedFBAFees -
            sippDiscount
          );
        })()
      }
    } : {
      mode: 'Basic/Legacy',
      factoryPriceInputs: calculateFactoryPriceInputs(product, additionalCostsTotal),
      additionalCostsTotal,
      totalCost,
      breakdown: {
        productCost: product.cost,
        retailBoxCost: product.retailBoxCost,
        cardCost: product.cardCost,
        userManualCost: product.userManualCost,
        additionalCosts: additionalCostsTotal
      },
      totalCostComponents: {
        factoryPriceInputs: calculateFactoryPriceInputs(product, additionalCostsTotal)
      }
    },
    finalCalc: {
      sellingPrice: product.sellingPrice,
      totalCost,
      profit,
      profitMargin,
      productId: product.id
    }
  };


  // (removed) The previous useEffect that wrote derived shipping/storage values
  // back to parent state has been replaced by the `derivedShipping` useMemo above.

  return (
    <Card className="shadow-elegant border-border bg-gradient-card">
      <CardHeader className="pb-6 border-b border-border/50">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center mb-2">
              <Package className="w-6 h-6 text-primary mr-3" />
              <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Product Analysis</span>
            </div>
            <Input
              value={product.name}
              onChange={(e) => updateProduct(product.id, 'name', e.target.value)}
              className="text-2xl font-bold border-2 border-transparent bg-transparent p-0 focus-visible:ring-0 focus-visible:border-primary/50 hover:border-primary/30 transition-colors"
              placeholder="Enter product name..."
            />
          </div>
          <div className="flex items-center gap-3">
            <div className={`inline-flex items-center gap-2 px-5 py-2 rounded-full text-sm font-bold shadow-lg ${
              product.bucket === 'live'
                ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white'
                : product.bucket === 'rd'
                ? 'bg-gradient-to-r from-purple-500 to-violet-600 text-white'
                : 'bg-gradient-to-r from-gray-400 to-gray-500 text-white'
            }`}>
              {product.bucket === 'live' ? (
                <>
                  <Briefcase className="w-4 h-4" />
                  <span>LIVE MODE</span>
                </>
              ) : product.bucket === 'rd' ? (
                <>
                  <FlaskConical className="w-4 h-4" />
                  <span>R&D MODE</span>
                </>
              ) : (
                <>
                  <Calculator className="w-4 h-4" />
                  <span>NEW CALCULATION</span>
                </>
              )}
            </div>
            {canRemove && (
              <Button
                onClick={() => removeProduct(product.id)}
                size="sm"
                variant="destructive"
                className="shadow-md hover:shadow-lg"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-8 p-6">
        {/* Version Management */}
        <div id="calculation-database" className="space-y-4">
          <VersionManager
            productId={product.id}
            savedVersions={savedVersions}
            loading={versionsLoading}
            currentProductData={(() => {
              const { savedVersions: _, bucket: __, ...productData } = product;
              return productData;
            })()}
            onSaveVersion={async (bucket: 'live' | 'rd', versionName: string) => {
              const { savedVersions: _, bucket: __, ...productData } = product;
              await saveVersion(versionName, productData, bucket);
            }}
            onLoadVersion={(version) => loadProductVersion(product.id, version)}
            onDeleteVersion={(versionId) => deleteVersion(versionId)}
            onUpdateVersion={async (versionId) => {
              const { savedVersions: _sv, bucket: _b, ...productData } = product;
              await updateVersion(versionId, productData);
            }}
            onRenameVersion={(versionId, newName) => renameVersion(versionId, newName)}
            onCreateNewCalculation={() => onCreateNewCalculation(product.id)}
            loadDeletedVersions={loadDeletedVersions}
            restoreVersion={restoreVersion}
            permanentlyDeleteVersion={permanentlyDeleteVersion}
          />
        </div>

        <div className="space-y-6">
          {/* Product Information */}
          <Card className="overflow-hidden bg-gradient-to-br from-blue-50/80 to-indigo-50/80 border-2 border-blue-200/60 shadow-lg hover:shadow-xl transition-all duration-300">
            <CardHeader className="pb-4 bg-gradient-to-r from-blue-600/10 to-indigo-600/10 border-b border-blue-200/30">
              <CardTitle className="text-xl font-semibold text-blue-800 flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-blue-500/15 shadow-sm">
                  <DollarSign className="w-6 h-6 text-blue-600" />
                </div>
                Product Information
              </CardTitle>
              <p className="text-sm text-blue-600/70 font-medium">
                {product.productInfoDescription || "Basic product details and configuration"}
              </p>
            </CardHeader>
            <CardContent className="p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                    Status
                  </Label>
                  <Select value={product.status} onValueChange={(value) => updateProduct(product.id, 'status', value)}>
                    <SelectTrigger className="h-11 border-2 hover:border-blue-300 focus:border-blue-500 transition-colors">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Active">✅ Active</SelectItem>
                      <SelectItem value="Inactive">⏸️ Inactive</SelectItem>
                      <SelectItem value="Draft">📝 Draft</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {!showShopify && (
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                      Category <span className="text-red-500">*</span>
                    </Label>
                    <Select value={product.category} onValueChange={(value) => updateProduct(product.id, 'category', value)}>
                      <SelectTrigger className={`h-11 border-2 hover:border-blue-300 focus:border-blue-500 transition-colors ${getFieldValidationClass('category')}`}>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((category) => (
                          <SelectItem key={category} value={category}>
                            {category.charAt(0).toUpperCase() + category.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Show SKU field for Live bucket products or legacy mode */}
              {(product.bucket === 'live' || calculatorMode === 'legacy') && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    SKU {isFieldRequired('sku') && <span className="text-red-500">*</span>}
                  </Label>
                  <Popover open={skuPopoverOpen} onOpenChange={setSkuPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={skuPopoverOpen}
                        className={`w-full h-11 justify-between border-2 hover:border-blue-300 focus:border-blue-500 transition-colors ${getFieldValidationClass('sku')}`}
                        disabled={productInfoLoading}
                      >
                        <span className="truncate">
                          {product.sku || (productInfoLoading ? "🔄 Loading SKUs..." : "Select or type SKU")}
                        </span>
                        <div className="ml-2 h-4 w-4 shrink-0 opacity-50">⌄</div>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-full p-0 border-2 border-blue-200">
                      <Command>
                        <CommandInput placeholder="🔍 Search SKUs..." className="h-11" />
                        <CommandList>
                          <CommandEmpty>No SKU found.</CommandEmpty>
                          <CommandGroup>
                            {productInfoList.map((productInfo) => (
                              <CommandItem
                                key={productInfo.SKU}
                                value={productInfo.SKU}
                                onSelect={(selectedSKU) => {
                                  handleSKUChange(selectedSKU);
                                  setSkuPopoverOpen(false);
                                }}
                                className="hover:bg-blue-50"
                              >
                                📦 {productInfo.SKU}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {!productInfoLoading && (
                    <p className="text-xs text-blue-600/60 mt-1 flex items-center gap-1">
                      📊 {productInfoList.length} SKUs loaded from database
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                  Selling Price ($) <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <Input
                    type="number"
                    value={product.sellingPrice ?? ''}
                    onChange={(e) => updateProduct(product.id, 'sellingPrice', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                    step="0.01"
                    placeholder="0.00"
                    className={`h-11 pl-8 border-2 hover:border-blue-300 focus:border-blue-500 transition-colors ${getFieldValidationClass('sellingPrice')}`}
                  />
                  <DollarSign className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                </div>
              </div>
              
              {/* Hazmat and Batteries Checkboxes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex items-center gap-3 pt-3 pb-2 px-3 rounded-md bg-muted/30 border border-border">
                  <Checkbox
                    id={`hazmat-${product.id}`}
                    checked={product.hazmat || false}
                    onCheckedChange={(checked) => updateProduct(product.id, 'hazmat', checked as boolean)}
                    className="h-5 w-5"
                  />
                  <Label 
                    htmlFor={`hazmat-${product.id}`} 
                    className="text-base font-semibold text-foreground cursor-pointer"
                  >
                    Hazmat (Dangerous Goods)
                  </Label>
                </div>
                
                <div className="flex items-center gap-3 pt-3 pb-2 px-3 rounded-md bg-muted/30 border border-border">
                  <Checkbox
                    id={`batteries-${product.id}`}
                    checked={product.containsBatteries || false}
                    onCheckedChange={(checked) => updateProduct(product.id, 'containsBatteries', checked as boolean)}
                    className="h-5 w-5"
                  />
                  <Label 
                    htmlFor={`batteries-${product.id}`} 
                    className="text-base font-semibold text-foreground cursor-pointer"
                  >
                    Contains Batteries
                  </Label>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                  Notes
                </Label>
                <Textarea
                  value={product.notes || ''}
                  onChange={(e) => updateProduct(product.id, 'notes', e.target.value)}
                  placeholder="💭 Add any notes about this product..."
                  className="min-h-[100px] border-2 hover:border-blue-300 focus:border-blue-500 transition-colors resize-none"
                />
              </div>
            </CardContent>
          </Card>

          {/* Product Factory Price Inputs */}
        <ProductFactoryPrice 
          product={product}
          updateProduct={updateProduct}
          batchUpdateProduct={batchUpdateProduct}
          additionalCostsTotal={additionalCostsTotal}
          addAdditionalCost={addAdditionalCost}
          updateAdditionalCost={updateAdditionalCost}
          removeAdditionalCost={removeAdditionalCost}
        />

          {/* Packaging Dimensions */}
          <Card className="overflow-hidden bg-gradient-to-br from-amber-50/80 to-orange-50/80 border-2 border-amber-200/60 shadow-lg hover:shadow-xl transition-all duration-300">
            <CardHeader className="pb-4 bg-gradient-to-r from-amber-500/10 to-orange-500/10 border-b border-amber-200/30">
              <CardTitle className="text-xl font-semibold text-amber-800 flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/15 shadow-sm">
                  <Package className="w-6 h-6 text-amber-600" />
                </div>
                Packaging Dimensions
              </CardTitle>
              <p className="text-sm text-amber-600/70 font-medium">
                {product.dimensionsDescription || "Product size and weight specifications"}
              </p>
            </CardHeader>
            <CardContent className="p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                    Length (cm)
                  </Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={product.length ?? ''}
                      onChange={(e) => updateProduct(product.id, 'length', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                      step="0.1"
                      placeholder="0.0"
                      className="h-11 pr-12 border-2 hover:border-amber-300 focus:border-amber-500 transition-colors"
                    />
                    <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-sm text-gray-400 font-medium">
                      cm
                    </span>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                    Width (cm)
                  </Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={product.width ?? ''}
                      onChange={(e) => updateProduct(product.id, 'width', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                      step="0.1"
                      placeholder="0.0"
                      className="h-11 pr-12 border-2 hover:border-amber-300 focus:border-amber-500 transition-colors"
                    />
                    <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-sm text-gray-400 font-medium">
                      cm
                    </span>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                    Height (cm)
                  </Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={product.height ?? ''}
                      onChange={(e) => updateProduct(product.id, 'height', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                      step="0.1"
                      placeholder="0.0"
                      className="h-11 pr-12 border-2 hover:border-amber-300 focus:border-amber-500 transition-colors"
                    />
                    <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-sm text-gray-400 font-medium">
                      cm
                    </span>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                    Weight (kg)
                  </Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={product.weight ?? ''}
                      onChange={(e) => updateProduct(product.id, 'weight', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                      step="0.001"
                      placeholder="0.000"
                      className="h-11 pr-12 border-2 hover:border-amber-300 focus:border-amber-500 transition-colors"
                    />
                    <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-sm text-gray-400 font-medium">
                      kg
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Always show basic sections when either button is active */}
        {(showAmazonFBA || showTikTokShop || showShopify) && (
        <>
        {/* Shopify Marketing Section */}
        {showShopify && (
          <Card className="bg-blue-50/80 border-2 border-blue-200/60 shadow-card hover:shadow-elegant transition-shadow duration-300 mb-8">
            <CardHeader className="pb-4 bg-gradient-to-r from-blue-500/5 to-transparent">
              <CardTitle className="text-lg text-blue-800 flex items-center">
                <div className="p-2 rounded-lg bg-blue-500/10 mr-3">
                  <TrendingUp className="w-5 h-5" />
                </div>
                Shopify Marketing
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-4 h-4 text-blue-600 cursor-help ml-2" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-lg">
                    <div className="space-y-2">
                      <p className="font-semibold">Shopify Marketing Analysis</p>
                      <p>Calculate marketing costs and performance metrics for Shopify campaigns.</p>
                      <div className="text-sm space-y-1">
                        <p><strong>Key Metrics:</strong></p>
                        <p>• ROAS = Return on Ad Spend</p>
                        <p>• CPA = Selling Price ÷ ROAS</p>
                        <p>• ADs Agency = 8% of Total Media</p>
                        <p>• Creative Agency = % of Total Media (editable)</p>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* ROAS Input */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <label className="block text-sm font-medium text-blue-700">
                      ROAS
                    </label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-4 h-4 text-blue-500" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-semibold">Return on Ad Spend (ROAS)</p>
                        <p>The ratio of revenue generated to ad spend.</p>
                        <p>Higher ROAS = better ad performance</p>
                        <p>Interconnected with CPA: ROAS = Selling Price ÷ CPA</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={product.shopifyRoas || ''}
                    onChange={(e) => {
                      const newRoas = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                      updateProduct(product.id, 'shopifyRoas', newRoas);
                    }}
                    onBlur={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      updateProduct(product.id, 'shopifyRoas', parseFloat(val.toFixed(2)));
                      // Update CPA when ROAS changes
                      if (val > 0 && product.sellingPrice) {
                        const newCpa = parseFloat((product.sellingPrice / val).toFixed(2));
                        updateProduct(product.id, 'shopifyCpa', newCpa);
                      }
                    }}
                    className="w-full px-3 py-2 border border-blue-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="0.00"
                  />
                </div>

                {/* CPA Input (Editable) */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <label className="block text-sm font-medium text-blue-700">
                      CPA
                    </label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-4 h-4 text-blue-500" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-semibold">Cost per Acquisition (CPA)</p>
                        <p>The cost to acquire one customer.</p>
                        <p>Interconnected with ROAS: CPA = Selling Price ÷ ROAS</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={product.shopifyCpa || ''}
                    onChange={(e) => {
                      const newCpa = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                      updateProduct(product.id, 'shopifyCpa', newCpa);
                    }}
                    onBlur={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      updateProduct(product.id, 'shopifyCpa', parseFloat(val.toFixed(2)));
                      // Update ROAS when CPA changes
                      if (val > 0 && product.sellingPrice) {
                        const newRoas = parseFloat((product.sellingPrice / val).toFixed(2));
                        updateProduct(product.id, 'shopifyRoas', newRoas);
                      }
                    }}
                    className="w-full px-3 py-2 border border-blue-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="0.00"
                  />
                </div>

                {/* Total Media (Editable - synced with CPA) */}
                <div>
                  <label className="block text-sm font-medium text-blue-700 mb-2">
                    Total Media
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={product.shopifyCpa || ''}
                    onChange={(e) => {
                      const newTotalMedia = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                      updateProduct(product.id, 'shopifyCpa', newTotalMedia);
                    }}
                    onBlur={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      updateProduct(product.id, 'shopifyCpa', parseFloat(val.toFixed(2)));
                      // Update ROAS when Total Media (CPA) changes
                      if (val > 0 && product.sellingPrice) {
                        const newRoas = parseFloat((product.sellingPrice / val).toFixed(2));
                        updateProduct(product.id, 'shopifyRoas', newRoas);
                      }
                    }}
                    className="w-full px-3 py-2 border border-blue-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="0.00"
                  />
                </div>

                {/* Agency Percentage Input */}
                <div>
                  <label className="block text-sm font-medium text-blue-700 mb-2">
                    ADs Agency (% of media)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={product.shopifyAgencyPercentage || 8}
                    onChange={(e) => updateProduct(product.id, 'shopifyAgencyPercentage', e.target.value === '' ? undefined : parseFloat(e.target.value) || 8)}
                    className="w-full px-3 py-2 border border-blue-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="8"
                  />
                </div>

                {/* Agency Cost (Calculated) */}
                <div>
                  <label className="block text-sm font-medium text-blue-700 mb-2">
                    ADs Agency Cost
                  </label>
                  <div className="w-full px-3 py-2 bg-blue-50 border border-blue-200 rounded-md text-blue-800 font-medium">
                    ${(() => {
                      const totalMedia = product.shopifyRoas > 0 ? (product.sellingPrice || 0) / product.shopifyRoas : 0;
                      const agencyPercentage = product.shopifyAgencyPercentage || 8;
                      return (totalMedia * agencyPercentage / 100).toFixed(2);
                    })()}
                  </div>
                </div>

                {/* Creative Percentage Input */}
                <div>
                  <label className="block text-sm font-medium text-blue-700 mb-2">
                    Creative Agency (% of media)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={product.shopifyCreativePercentage || 7}
                    onChange={(e) => updateProduct(product.id, 'shopifyCreativePercentage', e.target.value === '' ? undefined : parseFloat(e.target.value) || 7)}
                    className="w-full px-3 py-2 border border-blue-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="7"
                  />
                </div>

                {/* Creative Cost (Calculated) */}
                <div>
                  <label className="block text-sm font-medium text-blue-700 mb-2">
                    Creative Agency Cost
                  </label>
                  <div className="w-full px-3 py-2 bg-blue-50 border border-blue-200 rounded-md text-blue-800 font-medium">
                    ${(() => {
                      const totalMedia = product.shopifyRoas > 0 ? (product.sellingPrice || 0) / product.shopifyRoas : 0;
                      const creativePercentage = product.shopifyCreativePercentage || 7;
                      return (totalMedia * creativePercentage / 100).toFixed(2);
                    })()}
                  </div>
                </div>

                {/* Total Shopify Marketing (Calculated) */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-blue-700 mb-2">
                    Total Shopify Marketing
                  </label>
                  <div className="w-full px-4 py-3 bg-gradient-to-r from-blue-100 to-blue-50 border-2 border-blue-300 rounded-lg text-blue-900 font-bold text-lg text-center">
                    ${(() => {
                      const totalMedia = product.shopifyRoas > 0 ? (product.sellingPrice || 0) / product.shopifyRoas : 0;
                      const agencyPercentage = product.shopifyAgencyPercentage || 8;
                      const creativePercentage = product.shopifyCreativePercentage || 7;
                      
                      const agencyCost = totalMedia * agencyPercentage / 100;
                      const creativeCost = totalMedia * creativePercentage / 100;
                      const totalShopifyMarketing = totalMedia + agencyCost + creativeCost;
                      
                      return totalShopifyMarketing.toFixed(2);
                    })()}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Transaction Fee Section - Show only when Shopify button is active */}
        {showShopify && (
          <Card className="bg-orange-50/80 border-2 border-orange-200/60 shadow-card hover:shadow-elegant transition-shadow duration-300 mb-8">
            <CardHeader className="pb-4 bg-gradient-to-r from-orange-500/5 to-transparent">
              <CardTitle className="text-lg text-orange-800 flex items-center">
                <div className="p-2 rounded-lg bg-orange-500/10 mr-3">
                  <TrendingUp className="w-5 h-5" />
                </div>
                Transaction Fee
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Transaction Fee Percentage Input */}
                <div>
                  <label className="block text-sm font-medium text-orange-700 mb-2">
                    Transaction Fee (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={product.shopifyTransactionFeePercentage || 3}
                    onChange={(e) => updateProduct(product.id, 'shopifyTransactionFeePercentage', e.target.value === '' ? undefined : parseFloat(e.target.value) || 3)}
                    className="w-full px-3 py-2 border border-orange-200 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    placeholder="3"
                  />
                </div>

                {/* Transaction Fee Cost (Calculated) */}
                <div>
                  <label className="block text-sm font-medium text-orange-700 mb-2">
                    Transaction Fee Cost
                  </label>
                  <div className="w-full px-3 py-2 bg-orange-50 border border-orange-200 rounded-md text-orange-800 font-medium">
                    ${(() => {
                      const transactionFeePercentage = product.shopifyTransactionFeePercentage || 3;
                      const sellingPrice = product.sellingPrice || 0;
                      return (sellingPrice * transactionFeePercentage / 100).toFixed(2);
                    })()}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Returns Section - Show only when Shopify button is active */}
        {showShopify && (
          <Card className="bg-red-50/80 border-2 border-red-200/60 shadow-card hover:shadow-elegant transition-shadow duration-300 mb-8">
            <CardHeader className="pb-4 bg-gradient-to-r from-red-500/5 to-transparent">
              <CardTitle className="text-lg text-red-800 flex items-center">
                <div className="p-2 rounded-lg bg-red-500/10 mr-3">
                  <TrendingUp className="w-5 h-5" />
                </div>
                Shopify Returns
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Returns Percentage Input */}
                <div>
                  <label className="block text-sm font-medium text-red-700 mb-2">
                    Returns (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={product.shopifyReturnsPercentage || 5}
                    onChange={(e) => updateProduct(product.id, 'shopifyReturnsPercentage', e.target.value === '' ? undefined : parseFloat(e.target.value) || 5)}
                    className="w-full px-3 py-2 border border-red-200 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    placeholder="5"
                  />
                </div>

                {/* Returns Cost (Calculated) */}
                <div>
                  <label className="block text-sm font-medium text-red-700 mb-2">
                    Returns Cost
                  </label>
                  <div className="w-full px-3 py-2 bg-red-50 border border-red-200 rounded-md text-red-800 font-medium">
                    ${(() => {
                      const returnsPercentage = product.shopifyReturnsPercentage || 5;
                      const sellingPrice = product.sellingPrice || 0;
                      return (sellingPrice * returnsPercentage / 100).toFixed(2);
                    })()}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Dimensional Calculations */}
        {((product.length ?? 0) > 0 || (product.width ?? 0) > 0 || (product.height ?? 0) > 0 || (product.weight ?? 0) > 0) && (
          <div className="mb-8">
            <div className="flex items-center mb-4">
              <h2 className="text-lg font-semibold mr-2">Dimensional Calculations</h2>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-lg">
                  <div className="space-y-2">
                    <p className="font-semibold">Dimensional Calculations</p>
                    <p>Converts physical dimensions and weight to shipping metrics for logistics planning.</p>
                    <div className="text-sm space-y-1">
                      <p><strong>Formulas:</strong></p>
                      <p>• Dimensional Weight = (L × W × H in inches) ÷ 166</p>
                      <p>• Shipping Weight = Max(Actual Weight, Dimensional Weight)</p>
                      <p>• Volume (CBM) = (L × W × H in cm) ÷ 1,000,000</p>
                      <p>• Volume (CBF) = CBM × 35.3147</p>
                      <p>• Unit conversions: cm ÷ 2.54 = inches, kg × 2.20462 = lbs</p>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
            <DimensionalCalculations
              length={product.length}
              width={product.width}
              height={product.height}
              weight={product.weight}
            />
          </div>
        )}

        {/* Master Carton Optimization */}
        {(
        <Card className="bg-orange-50 border-orange-400">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg text-orange-800 flex items-center">
              <Calculator className="w-5 h-5 mr-2" />
              Master Carton Optimization
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-4 h-4 text-orange-600 cursor-help ml-2" />
                </TooltipTrigger>
                <TooltipContent className="max-w-lg">
                  <div className="space-y-2">
                    <p className="font-semibold">Master Carton Optimization</p>
                    <p>Calculates the most efficient way to pack individual products into shipping cartons.</p>
                    <div className="text-sm space-y-1">
                      <p><strong>Optimization Process:</strong></p>
                      <p>• Tests all 6 possible product orientations (L×W×H permutations)</p>
                      <p>• Tries different quantities along each dimension</p>
                      <p>• Considers maximum carton limits (dimensions, weight, units)</p>
                      <p>• Calculates dimensional weight vs actual weight</p>
                      <p><strong>Selection Criteria:</strong></p>
                      <p>• Minimizes billed CBM per unit (considers both volume and weight)</p>
                      <p>• Prefers cube-like shapes (lower dimension standard deviation)</p>
                      <p><strong>Results:</strong> Optimal carton size, units per carton, CBM/CBF per unit</p>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const optimized = memoizedCartonOptimization;
              
              if (!optimized) {
                return (
                  <div className="text-center text-muted-foreground py-8">
                    Enter product dimensions and weight to see optimization results
                  </div>
                );
              }

              return (
                <div className="space-y-6">
                  {/* Warning alerts if restrictions are overstepped */}
                  {optimized.warnings && optimized.warnings.length > 0 && (
                    <div className="space-y-2">
                      {optimized.warnings.map((warning: string, index: number) => (
                        <div key={index} className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                          <div className="flex items-start space-x-2">
                            <Info className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
                            <span className="text-sm text-destructive">{warning}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Optimized Carton Dimensions */}
                  <Card className="bg-card">
                    <CardContent className="pt-6">
                      <h4 className="font-semibold text-card-foreground mb-3">Optimized Carton Dimensions</h4>
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <div className="text-xl font-bold text-orange-600">{optimized.l.toFixed(2)}</div>
                          <div className="text-sm text-muted-foreground">Length (cm)</div>
                        </div>
                        <div>
                          <div className="text-xl font-bold text-orange-600">{optimized.w.toFixed(2)}</div>
                          <div className="text-sm text-muted-foreground">Width (cm)</div>
                        </div>
                        <div>
                          <div className="text-xl font-bold text-orange-600">{optimized.h.toFixed(2)}</div>
                          <div className="text-sm text-muted-foreground">Height (cm)</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Key Metrics */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card className="bg-card">
                      <CardContent className="pt-6 text-center">
                        <div className="text-xl font-bold text-orange-600">{optimized.units}</div>
                        <div className="text-sm text-muted-foreground">Units</div>
                      </CardContent>
                    </Card>
                    <Card className="bg-card">
                      <CardContent className="pt-6 text-center">
                        <div className="text-xl font-bold text-orange-600">{optimized.kg.toFixed(2)}</div>
                        <div className="text-sm text-muted-foreground">Total Weight (kg)</div>
                      </CardContent>
                    </Card>
                    <Card className="bg-card">
                      <CardContent className="pt-6 text-center">
                        <div className="text-xl font-bold text-orange-600">{optimized.cbm.toFixed(6)}</div>
                        <div className="text-sm text-muted-foreground">Carton CBM</div>
                      </CardContent>
                    </Card>
                    <Card className="bg-card">
                      <CardContent className="pt-6 text-center">
                        <div className="text-xl font-bold text-orange-600">{optimized.build}</div>
                        <div className="text-sm text-muted-foreground">Build (L×W×H)</div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Per Unit Metrics */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card className="bg-card">
                      <CardContent className="pt-6 text-center">
                        <div className="text-xl font-bold text-orange-600">{optimized.cbmPerUnit.toFixed(8)}</div>
                        <div className="text-sm text-muted-foreground">CBM per Unit</div>
                      </CardContent>
                    </Card>
                    <Card className="bg-card">
                      <CardContent className="pt-6 text-center">
                        <div className="text-xl font-bold text-orange-600">{optimized.cbfPerUnit.toFixed(8)}</div>
                        <div className="text-sm text-muted-foreground">CBF per Unit</div>
                      </CardContent>
                    </Card>
                    <Card className="bg-card">
                      <CardContent className="pt-6 text-center">
                        <div className="text-xl font-bold text-orange-600">
                          {(() => {
                            // Use centralized dimensional weight calculation for optimized carton
                            const dimCalc = calculateDimensionalWeight(optimized.l, optimized.w, optimized.h, optimized.kg);
                            const perUnitWeight = dimCalc.shippingWeightLbs / optimized.units;
                            return perUnitWeight.toFixed(2);
                          })()}
                        </div>
                        <div className="text-sm text-muted-foreground">Dim Weight per Unit (lbs) - Divisor 139</div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
        )}

        {/* Master Carton Final Packing */}
        {product.bucket === 'live' && (
        <Card className="bg-muted">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center">
              <Package className="w-5 h-5 mr-2" />
              Master Carton Final Packing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div>
                <Label>Length (cm)</Label>
                <Input
                  type="number"
                  value={product.masterCartonLength ?? ''}
                  onChange={(e) => updateProduct(product.id, 'masterCartonLength', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                  step="0.1"
                />
              </div>
              <div>
                <Label>Width (cm)</Label>
                <Input
                  type="number"
                  value={product.masterCartonWidth ?? ''}
                  onChange={(e) => updateProduct(product.id, 'masterCartonWidth', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                  step="0.1"
                />
              </div>
              <div>
                <Label>Height (cm)</Label>
                <Input
                  type="number"
                  value={product.masterCartonHeight ?? ''}
                  onChange={(e) => updateProduct(product.id, 'masterCartonHeight', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                  step="0.1"
                />
              </div>
              <div>
                <Label>Units</Label>
                <Input
                  type="number"
                  value={product.masterCartonUnits ?? ''}
                  onChange={(e) => updateProduct(product.id, 'masterCartonUnits', parseInt(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>Weight (KG)</Label>
                <Input
                  type="number"
                  value={product.masterCartonWeight ?? ''}
                  onChange={(e) => updateProduct(product.id, 'masterCartonWeight', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                  step="0.1"
                />
              </div>
            </div>
            
            {/* Calculated Values */}
            {(product.masterCartonLength ?? 0) > 0 && (product.masterCartonWidth ?? 0) > 0 && (product.masterCartonHeight ?? 0) > 0 && (product.masterCartonUnits ?? 0) > 0 && (
              <div className="mt-6 bg-card p-4 rounded-lg border">
                <h4 className="font-semibold text-card-foreground mb-3">Calculated Values</h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="text-xl font-bold text-primary">
                      {(() => {
                        const dimensions = {
                          masterCartonLength: product.masterCartonLength,
                          masterCartonWidth: product.masterCartonWidth,
                          masterCartonHeight: product.masterCartonHeight,
                          masterCartonUnits: product.masterCartonUnits
                        };
                         const cbmResult = memoizedCBMResult;
                         return (cbmResult.cbmPerUnit * cbmResult.units).toFixed(6);
                      })()}
                    </div>
                    <div className="text-sm text-muted-foreground">Carton CBM</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-primary">
                      {(() => {
                        const dimensions = {
                          masterCartonLength: product.masterCartonLength,
                          masterCartonWidth: product.masterCartonWidth,
                          masterCartonHeight: product.masterCartonHeight,
                          masterCartonUnits: product.masterCartonUnits
                        };
                        return getCBMPerUnit(dimensions).toFixed(8);
                      })()}
                    </div>
                    <div className="text-sm text-muted-foreground">CBM per Unit</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-primary">
                      {(() => {
                        const dimensions = {
                          masterCartonLength: product.masterCartonLength,
                          masterCartonWidth: product.masterCartonWidth,
                          masterCartonHeight: product.masterCartonHeight,
                          masterCartonUnits: product.masterCartonUnits
                        };
                        return getCBFPerUnit(dimensions).toFixed(8);
                      })()}
                    </div>
                    <div className="text-sm text-muted-foreground">CBF per Unit</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-primary">
                      {(() => {
                        // Use centralized dimensional weight calculation for master carton
                        const dimCalc = calculateDimensionalWeight(
                          product.masterCartonLength ?? 0, 
                          product.masterCartonWidth ?? 0, 
                          product.masterCartonHeight ?? 0, 
                          product.masterCartonWeight ?? 0
                        );
                        const perUnitWeight = dimCalc.shippingWeightLbs / (product.masterCartonUnits ?? 0);
                        return perUnitWeight.toFixed(2);
                      })()}
                    </div>
                    <div className="text-sm text-muted-foreground">Greater of Shipping and Dim Weight per Unit (lbs) - Divisor 139</div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        )}

        {/* Amazon MCF Calculation - Show only when TikTok Shop button is active */}
        {showTikTokShop && (
          <Card className="bg-emerald-50/80 border-2 border-emerald-200/60 shadow-card hover:shadow-elegant transition-shadow duration-300 mb-8">
            <CardHeader className="pb-4 bg-gradient-to-r from-emerald-500/5 to-transparent">
              <CardTitle className="text-lg text-emerald-800 flex items-center">
                <div className="p-2 rounded-lg bg-emerald-500/10 mr-3">
                  <Package className="w-5 h-5" />
                </div>
                Amazon MCF (Multi-Channel Fulfillment) Tik Tok
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-4 h-4 text-emerald-600 cursor-help ml-2" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-lg">
                    <div className="space-y-2">
                      <p className="font-semibold">Amazon MCF (Multi-Channel Fulfillment)</p>
                      <p>Calculates fees for shipping from Amazon warehouses to non-Amazon customers.</p>
                      <div className="text-sm space-y-1">
                        <p><strong>Components:</strong></p>
                        <p>• MCF Fulfillment Fee = Based on size tier + weight + speed</p>
                        <p>• Storage Fee = CBF per unit × storage rate × months</p>
                        <p>• Returns Cost = Returns % × (Admin Fee + MCF Fee + Storage + Cost)</p>
                        <p>• Admin Fee = Min($5, 20% of referral fee)</p>
                        <p><strong>Size Tiers:</strong> Small Standard, Large Standard, Large Bulky, Extra-Large (0-50lb, 50-70lb, 70-150lb), Special Oversize</p>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
            </CardHeader>
            <CardContent>
            <MCFCalculation
            length={product.length}
            width={product.width}
            height={product.height}
            weight={product.weight}
            masterCartonLength={product.masterCartonLength}
            masterCartonWidth={product.masterCartonWidth}
            masterCartonHeight={product.masterCartonHeight}
            masterCartonUnits={product.masterCartonUnits}
            amazonFBAAVGFee={hazmatAwareAVGFee}
            additionalCosts={additionalCostsTotal}
            cbmCost={product.cbmCost}
            shippingToAWD={product.shippingToAWD}
            awdCaseReceiveCost={product.awdCaseReceiveCost}
            amazonAWDStorageFee={product.amazonAWDStorageFee}
            storageMonths={product.storageMonths}
            onMCFFeeChange={setMcfFee}
            onStorageFeeChange={setMcfStorageFee}
          />
            </CardContent>
          </Card>
        )}

        {/* Amazon MCF Calculation for Shopify - Show only when Shopify button is active */}
        {showShopify && !showTikTokShop && (
          <Card className="bg-emerald-50/80 border-2 border-emerald-200/60 shadow-card hover:shadow-elegant transition-shadow duration-300 mb-8">
            <CardHeader className="pb-4 bg-gradient-to-r from-emerald-500/5 to-transparent">
              <CardTitle className="text-lg text-emerald-800 flex items-center">
                <div className="p-2 rounded-lg bg-emerald-500/10 mr-3">
                  <Package className="w-5 h-5" />
                </div>
                Amazon MCF (Multi-Channel Fulfillment) Shopify
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MCFCalculation
                length={product.length}
                width={product.width}
                height={product.height}
                weight={product.weight}
                masterCartonLength={product.masterCartonLength}
                masterCartonWidth={product.masterCartonWidth}
                masterCartonHeight={product.masterCartonHeight}
                masterCartonUnits={product.masterCartonUnits}
                amazonFBAAVGFee={hazmatAwareAVGFee}
                additionalCosts={additionalCostsTotal}
                cbmCost={product.cbmCost}
                shippingToAWD={product.shippingToAWD}
                awdCaseReceiveCost={product.awdCaseReceiveCost}
                amazonAWDStorageFee={product.amazonAWDStorageFee}
                storageMonths={product.storageMonths}
                onMCFFeeChange={setMcfFeeShopify}
                onStorageFeeChange={setMcfStorageFeeShopify}
                mode="shopify"
              />
            </CardContent>
          </Card>
        )}

        {/* 3PL Fulfillment Calculation - Show only when Shopify button is active (not for TikTok Shop) */}
        {showShopify && !showTikTokShop && (
          <Card className="bg-purple-50/80 border-2 border-purple-200/60 shadow-card hover:shadow-elegant transition-shadow duration-300 mb-8">
            <CardHeader className="pb-4 bg-gradient-to-r from-purple-500/5 to-transparent">
              <CardTitle className="text-xl font-bold text-purple-800 flex items-center">
                <Package className="w-6 h-6 mr-3 text-purple-600" />
                3PL Fulfillment Analysis
                <div className="ml-auto">
                  <div className="flex items-center space-x-3">
                    <Select value={selectedWarehouse} onValueChange={(value: 'stephen' | 'inandout') => setSelectedWarehouse(value)}>
                      <SelectTrigger className="w-[180px] bg-background border-purple-300 hover:border-purple-400">
                        <SelectValue placeholder="Select 3PL" />
                      </SelectTrigger>
                      <SelectContent className="bg-background z-50">
                        <SelectItem value="stephen">Stephen Warehouse</SelectItem>
                        <SelectItem value="inandout">InAndOut</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium">
                      Third-Party Logistics
                    </div>
                  </div>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                // Calculate CBM per unit using centralized utility
                const dimensions = {
                  length: product.length,
                  width: product.width,
                  height: product.height,
                  weight: product.weight,
                  masterCartonLength: product.masterCartonLength,
                  masterCartonWidth: product.masterCartonWidth,
                  masterCartonHeight: product.masterCartonHeight,
                  masterCartonUnits: product.masterCartonUnits
                };
                
                const cbmResult = memoizedCBMResult;
                const cbmPerUnit = cbmResult.cbmPerUnit;
                
                // Use optimized units from Master Carton Optimization, fallback to manual entry
                const optimizedCarton = memoizedCartonOptimization;
                const unitsPerCarton = optimizedCarton?.units || product.masterCartonUnits || 1;
                
                return (
                  <ThreePLCalculation
                    length={product.length}
                    width={product.width}
                    height={product.height}
                    weight={product.weight}
                    sellingPrice={product.sellingPrice}
                    cbmCost={product.cbmCost}
                    cbmPerUnit={cbmPerUnit}
                    selectedWarehouse={selectedWarehouse}
                    masterCartonUnits={unitsPerCarton}
                    onUpdateFee={setThreePlFee}
                    onUpdateStorageFee={setThreePlStorageFee}
                    onUpdateTotalFee={setThreePlTotalFee}
                  />
                );
              })()}
            </CardContent>
          </Card>
        )}

        {/* TikTok FBT Calculation - Show only when TikTok Shop button is active */}
        {showTikTokShop && (() => {
          // Calculate chargeable weight in lbs (same logic as DimensionalCalculations)
          const lengthIn = product.length / 2.54;
          const widthIn = product.width / 2.54;
          const heightIn = product.height / 2.54;
          const weightLbs = product.weight * 2.20462;
          const cubicInches = lengthIn * widthIn * heightIn;
          const dimWeightLbs = cubicInches / 166;
          const chargeableWeightLbs = Math.max(weightLbs, dimWeightLbs);
          
          return (
            <Card className="bg-violet-50/80 border-2 border-violet-200/60 shadow-card hover:shadow-elegant transition-shadow duration-300 mb-8">
              <CardHeader className="pb-4 bg-gradient-to-r from-violet-500/5 to-transparent">
                <CardTitle className="text-lg text-violet-800 flex items-center">
                  <div className="p-2 rounded-lg bg-violet-500/10 mr-3">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                  TikTok FBT (Fulfillment by TikTok)
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-4 h-4 text-violet-600 cursor-help ml-2" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-lg">
                      <div className="space-y-2">
                        <p className="font-semibold">TikTok FBT (Fulfillment by TikTok)</p>
                        <p>Calculates TikTok's fulfillment fees for TikTok Shop operations.</p>
                        <div className="text-sm space-y-1">
                          <p><strong>Fee Components:</strong></p>
                          <p>• FBT Fee = Weight-based tiered rates (Single/Multiple orders)</p>
                          <p>• Storage Cost = Cubic feet × daily rate × storage days</p>
                          <p>• Hub Placement = Weight-based + destination (West/East/Direct)</p>
                          <p>• TikTok Referral Fee = 6% of selling price</p>
                          <p><strong>Order Types:</strong> Single order (lower rate) vs Multiple order (higher rate)</p>
                          <p><strong>Weight Ranges:</strong> Different fee structures for 0-1lb, 1-2lb, 2-3lb, etc.</p>
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
              </CardHeader>
              <CardContent>
              <TikTokFBTCalculation
              length={product.length}
              width={product.width}
              height={product.height}
              weight={chargeableWeightLbs}
              masterCartonLength={product.masterCartonLength}
              masterCartonWidth={product.masterCartonWidth}
              masterCartonHeight={product.masterCartonHeight}
              masterCartonUnits={product.masterCartonUnits}
              cbmCost={product.cbmCost}
              additionalCosts={additionalCostsTotal}
              awdTransportationCost={product.awdTransportationCost}
              shippingToAMZFromChina={memoizedShippingCalculation.shippingToAMZ}
              awdReceivingCost={derivedShipping.awdReceivingCost}
              onSubtotalChange={setTikTokFBTSubtotal}
              onBreakdownChange={setTikTokFBTBreakdown}
            />
              </CardContent>
            </Card>
          );
        })()}

        {/* Marketing Calculation - Show only when TikTok Shop button is active */}
        {showTikTokShop && (
          <Card className="bg-amber-50/80 border-2 border-amber-200/60 shadow-card hover:shadow-elegant transition-shadow duration-300 mb-8">
            <CardHeader className="pb-4 bg-gradient-to-r from-amber-500/5 to-transparent">
              <CardTitle className="text-lg text-amber-800 flex items-center">
                <div className="p-2 rounded-lg bg-amber-500/10 mr-3">
                  <TrendingUp className="w-5 h-5" />
                </div>
                Marketing Costs
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-4 h-4 text-amber-600 cursor-help ml-2" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-lg">
                    <div className="space-y-2">
                      <p className="font-semibold">Marketing Costs</p>
                      <p>Tracks marketing expenses and calculates ROI metrics.</p>
                      <div className="text-sm space-y-1">
                        <p><strong>Calculations:</strong></p>
                        <p>• Affiliate Cost ($) = (Affiliate % ÷ 100) × Selling Price</p>
                        <p>• Ads Cost ($) = (Ads % ÷ 100) × Selling Price</p>
                        <p>• Marketing Subtotal = Affiliate Cost + Ads Cost</p>
                        <p>• Affiliate ROI = (Selling Price ÷ Affiliate Cost) × 100</p>
                        <p>• Ads ROI = (Selling Price ÷ Ads Cost) × 100</p>
                        <p><strong>Purpose:</strong> Evaluate marketing efficiency and budget allocation</p>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
            </CardHeader>
            <CardContent>
            <MarketingCalculation
            sellingPrice={product.sellingPrice}
            initialAffiliatePercentage={product.marketingAffiliatePercentage ?? 15}
            initialAdsPercentage={product.marketingAdsPercentage ?? 20}
            onSubtotalChange={setMarketingSubtotal}
            onAffiliateChange={(percentage, dollar) => {
              console.log('ProductCard: Affiliate change received:', percentage, dollar);
              updateProduct(product.id, 'marketingAffiliatePercentage', percentage);
              updateProduct(product.id, 'marketingAffiliateDollar', dollar);
            }}
            onAdsChange={(percentage, dollar) => {
              console.log('ProductCard: Ads change received:', percentage, dollar);
              updateProduct(product.id, 'marketingAdsPercentage', percentage);
              updateProduct(product.id, 'marketingAdsDollar', dollar);
            }}
          />
            </CardContent>
          </Card>
        )}

        {/* Shopify Profit Summary - Show only when Shopify button is active */}
        {showShopify && (
          <Card className="bg-gradient-to-br from-teal-50 to-emerald-50 border-2 border-teal-200/60 shadow-card hover:shadow-elegant transition-shadow duration-300 mb-8">
            <CardHeader className="pb-6 bg-gradient-to-r from-teal-500/5 to-transparent">
              <CardTitle className="text-xl font-bold text-teal-800 flex items-center">
                <TrendingUp className="w-6 h-6 mr-3 text-teal-600" />
                Profit Summary
                <div className="ml-auto">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-teal-600">Selling</span>
                    <span className="text-lg font-bold text-teal-700">
                      ${(product.sellingPrice ?? 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* MCF Profit Card */}
                <Card className="bg-emerald-50/60 border border-emerald-200">
                  <CardHeader className="pb-4">
                     <CardTitle className="text-lg font-semibold text-emerald-800 text-center">
                        Profit MCF Shopify
                     </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {(() => {
                        const factoryCosts = (product.cost ?? 0) + (product.retailBoxCost ?? 0) + (product.cardCost ?? 0) + (product.userManualCost ?? 0) + additionalCostsTotal;
                        
                        // Calculate Total Shopify Marketing
                        const totalMedia = product.shopifyRoas > 0 ? (product.sellingPrice || 0) / product.shopifyRoas : 0;
                        const agencyPercentage = product.shopifyAgencyPercentage || 8;
                        const creativePercentage = product.shopifyCreativePercentage || 7;
                        const agencyCost = totalMedia * agencyPercentage / 100;
                        const creativeCost = totalMedia * creativePercentage / 100;
                        const totalShopifyMarketing = totalMedia + agencyCost + creativeCost;
                        
                        // Calculate Transaction Fee Cost
                        const transactionFeePercentage = product.shopifyTransactionFeePercentage || 3;
                        const transactionFeeCost = (product.sellingPrice || 0) * transactionFeePercentage / 100;
                        
                        // Calculate Shopify Returns Cost
                        const returnsPercentage = product.shopifyReturnsPercentage || 5;
                        const shopifyReturnsCost = (product.sellingPrice || 0) * returnsPercentage / 100;
                        
                        // USE CENTRALIZED CALCULATION - FIXED!
                        const totalCost = calculateMCFTotalCost();
                        const profit = (product.sellingPrice ?? 0) - totalCost;
                        const margin = product.sellingPrice ? (profit / product.sellingPrice) * 100 : 0;
                        
                        return (
                          <>
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-card-foreground">Fulfilment Cost</span>
                                <Tooltip>
                                  <TooltipTrigger>
                                    <Info className="w-4 h-4 text-emerald-500" />
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs">
                                    <div className="space-y-1 text-xs">
                                      <p className="font-semibold mb-2">Fulfilment Breakdown:</p>
                                      <div className="flex justify-between">
                                        <span>MCF Fee:</span>
                                        <span>${mcfFeeShopify.toFixed(2)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>Storage Fee:</span>
                                        <span>${mcfStorageFeeShopify.toFixed(2)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>Shipping to AMZ:</span>
                                        <span>${(derivedShipping.shippingToAMZ || 0).toFixed(2)}</span>
                                      </div>
                                      <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                                        <span>Total Fulfilment:</span>
                                        <span>${(mcfFeeShopify + mcfStorageFeeShopify + (derivedShipping.shippingToAMZ || 0)).toFixed(2)}</span>
                                      </div>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <span className="text-lg font-semibold text-emerald-700">
                                ${(mcfFeeShopify + mcfStorageFeeShopify + (derivedShipping.shippingToAMZ || 0)).toFixed(2)}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-card-foreground">Total Cost</span>
                                <Tooltip>
                                  <TooltipTrigger>
                                    <Info className="w-4 h-4 text-emerald-500" />
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs">
                                    <div className="space-y-1 text-xs">
                                      <p className="font-semibold mb-2">Cost Breakdown:</p>
                                      <div className="flex justify-between">
                                        <span>Factory Price:</span>
                                        <span>${factoryCosts.toFixed(2)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>MCF Fee:</span>
                                        <span>${mcfFeeShopify.toFixed(2)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>Storage Fee:</span>
                                        <span>${mcfStorageFeeShopify.toFixed(2)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>Marketing:</span>
                                        <span>${totalShopifyMarketing.toFixed(2)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>Transaction Fee:</span>
                                        <span>${transactionFeeCost.toFixed(2)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>Returns Cost:</span>
                                        <span>${shopifyReturnsCost.toFixed(2)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>Shipping to AMZ:</span>
                                        <span>${(derivedShipping.shippingToAMZ || 0).toFixed(2)}</span>
                                      </div>
                                      <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                                        <span>Total:</span>
                                        <span>${totalCost.toFixed(2)}</span>
                                      </div>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <span className="text-lg font-semibold text-emerald-700">
                                ${totalCost.toFixed(2)}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-sm font-medium text-card-foreground">Profit</span>
                              <span className={`text-lg font-bold ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                ${profit >= 0 ? '' : '-'}${Math.abs(profit).toFixed(2)}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-sm font-medium text-card-foreground">Margin</span>
                              <span className={`text-lg font-bold ${margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                {margin.toFixed(1)}%
                              </span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </CardContent>
                </Card>

                {/* 3PL Profit Card */}
                <Card className="bg-purple-50/60 border border-purple-200">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-lg font-semibold text-purple-800 text-center">
                      Profit 3PL
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {(() => {
                        const factoryCosts = (product.cost ?? 0) + (product.retailBoxCost ?? 0) + (product.cardCost ?? 0) + (product.userManualCost ?? 0) + additionalCostsTotal;
                        
                        // Calculate 3PL Total Fulfillment Cost (use total from component)
                        const threePlTotalFulfillmentCost = threePlTotalFee;
                        
                        // Calculate Total Shopify Marketing
                        const totalMedia = product.shopifyRoas > 0 ? (product.sellingPrice || 0) / product.shopifyRoas : 0;
                        const agencyPercentage = product.shopifyAgencyPercentage || 8;
                        const creativePercentage = product.shopifyCreativePercentage || 7;
                        const agencyCost = totalMedia * agencyPercentage / 100;
                        const creativeCost = totalMedia * creativePercentage / 100;
                        const totalShopifyMarketing = totalMedia + agencyCost + creativeCost;
                        
                        // Calculate Transaction Fee Cost
                        const transactionFeePercentage = product.shopifyTransactionFeePercentage || 3;
                        const transactionFeeCost = (product.sellingPrice || 0) * transactionFeePercentage / 100;
                        
                        // Calculate Shopify Returns Cost
                        const returnsPercentage = product.shopifyReturnsPercentage || 5;
                        const shopifyReturnsCost = (product.sellingPrice || 0) * returnsPercentage / 100;
                        
                        // Total Cost = Factory Price Inputs + 3PL Total Fulfillment Cost + Total Shopify Marketing + Transaction Fee Cost + Shopify Returns Cost
                        const totalCost = factoryCosts + threePlTotalFulfillmentCost + totalShopifyMarketing + transactionFeeCost + shopifyReturnsCost;
                        const profit = (product.sellingPrice ?? 0) - totalCost;
                        const margin = product.sellingPrice ? (profit / product.sellingPrice) * 100 : 0;
                        
                        return (
                          <>
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-card-foreground">Fulfilment Cost</span>
                                <Tooltip>
                                  <TooltipTrigger>
                                    <Info className="w-4 h-4 text-purple-500" />
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs">
                                    <div className="space-y-1 text-xs">
                                      <p className="font-semibold mb-2">Fulfilment Breakdown:</p>
                                      <div className="flex justify-between">
                                        <span>3PL Total:</span>
                                        <span>${threePlTotalFulfillmentCost.toFixed(2)}</span>
                                      </div>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <span className="text-lg font-semibold text-purple-700">
                                ${threePlTotalFulfillmentCost.toFixed(2)}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-card-foreground">Total Cost</span>
                                <Tooltip>
                                  <TooltipTrigger>
                                    <Info className="w-4 h-4 text-purple-500" />
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs">
                                    <div className="space-y-1 text-xs">
                                      <p className="font-semibold mb-2">Cost Breakdown:</p>
                                      <div className="flex justify-between">
                                        <span>Factory Price:</span>
                                        <span>${factoryCosts.toFixed(2)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>3PL Fulfillment:</span>
                                        <span>${threePlTotalFulfillmentCost.toFixed(2)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>Marketing:</span>
                                        <span>${totalShopifyMarketing.toFixed(2)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>Transaction Fee:</span>
                                        <span>${transactionFeeCost.toFixed(2)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>Returns Cost:</span>
                                        <span>${shopifyReturnsCost.toFixed(2)}</span>
                                      </div>
                                      <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                                        <span>Total:</span>
                                        <span>${totalCost.toFixed(2)}</span>
                                      </div>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <span className="text-lg font-semibold text-purple-700">
                                ${totalCost.toFixed(2)}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-sm font-medium text-card-foreground">Profit</span>
                              <span className={`text-lg font-bold ${profit >= 0 ? 'text-purple-600' : 'text-red-600'}`}>
                                ${profit >= 0 ? '' : '-'}${Math.abs(profit).toFixed(2)}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-sm font-medium text-card-foreground">Margin</span>
                              <span className={`text-lg font-bold ${margin >= 0 ? 'text-purple-600' : 'text-red-600'}`}>
                                {margin.toFixed(1)}%
                              </span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Comparison Summary */}
              <div className="mt-6 p-4 bg-gradient-to-r from-teal-100/50 to-emerald-100/50 rounded-lg border border-teal-200">
                <div className="text-center">
                  <p className="text-sm font-medium text-teal-700 mb-2">Best Fulfillment Option</p>
                  {(() => {
                    // Use the same calculations as the individual profit cards
                    const mcfProfit = (() => {
                      const totalCost = calculateMCFTotalCost();
                      return (product.sellingPrice ?? 0) - totalCost;
                    })();
                    
                    const threePlProfit = (() => {
                      const factoryCosts = (product.cost ?? 0) + (product.retailBoxCost ?? 0) + (product.cardCost ?? 0) + (product.userManualCost ?? 0) + additionalCostsTotal;
                      const threePlTotalFulfillmentCost = threePlTotalFee;
                      
                      // Calculate Total Shopify Marketing
                      const totalMedia = product.shopifyRoas > 0 ? (product.sellingPrice || 0) / product.shopifyRoas : 0;
                      const agencyPercentage = product.shopifyAgencyPercentage || 8;
                      const creativePercentage = product.shopifyCreativePercentage || 7;
                      const agencyCost = totalMedia * agencyPercentage / 100;
                      const creativeCost = totalMedia * creativePercentage / 100;
                      const totalShopifyMarketing = totalMedia + agencyCost + creativeCost;
                      
                      // Calculate Transaction Fee Cost
                      const transactionFeePercentage = product.shopifyTransactionFeePercentage || 3;
                      const transactionFeeCost = (product.sellingPrice || 0) * transactionFeePercentage / 100;
                      
                      // Calculate Shopify Returns Cost
                      const returnsPercentage = product.shopifyReturnsPercentage || 5;
                      const shopifyReturnsCost = (product.sellingPrice || 0) * returnsPercentage / 100;
                      
                      const totalCost = factoryCosts + threePlTotalFulfillmentCost + totalShopifyMarketing + transactionFeeCost + shopifyReturnsCost;
                      return (product.sellingPrice ?? 0) - totalCost;
                    })();
                    
                    if (mcfProfit > threePlProfit) {
                      const savings = mcfProfit - threePlProfit;
                      return (
                        <p className="text-lg font-bold text-emerald-600">
                          MCF is ${savings.toFixed(2)} more profitable per unit
                        </p>
                      );
                    } else if (threePlProfit > mcfProfit) {
                      const savings = threePlProfit - mcfProfit;
                      return (
                        <p className="text-lg font-bold text-purple-600">
                          3PL is ${savings.toFixed(2)} more profitable per unit
                        </p>
                      );
                    } else {
                      return (
                        <p className="text-lg font-bold text-teal-600">
                          Both options have equal profitability
                        </p>
                      );
                    }
                  })()}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* TikTok Referral FEE - Show only when TikTok Shop button is active */}
        {showTikTokShop && (
          <Card className="bg-orange-50 border-orange-400">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg text-orange-800 flex items-center">
                <Calculator className="w-5 h-5 mr-2" />
                TikTok Referral FEE
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="bg-card">
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-card-foreground">Referral FEE:</span>
                        <span className="text-lg font-bold text-orange-600">
                          ${calculateTikTokReferralFee(product.sellingPrice ?? 0).toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-card-foreground">Percentage:</span>
                        <span className="text-lg font-bold text-orange-600">6%</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        )}

        {/* TikTok Refund Administration Fee - Show only when TikTok Shop button is active */}
        {showTikTokShop && (
          <Card className="bg-rose-50 border-rose-400">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg text-rose-800 flex items-center">
                <TrendingUp className="w-5 h-5 mr-2" />
                TikTok Refund Administration Fee
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-4 h-4 text-rose-600 cursor-help ml-2" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-lg">
                    <div className="space-y-2">
                      <p className="font-semibold">TikTok Refund Administration Fee</p>
                      <p>Calculates costs associated with processing refunds on TikTok Shop.</p>
                      <div className="text-sm space-y-1">
                        <p><strong>Components:</strong></p>
                        <p>• Refund Admin Fee = Min($5, 20% × TikTok Referral Fee)</p>
                        <p>• TikTok Referral Fee = 6% × Selling Price</p>
                        <p>• Estimated Returns Cost = Returns % × (Admin Fee + FBT Subtotal + Factory Costs)</p>
                        <p><strong>Total Formula:</strong></p>
                        <p>TikTok Refund Admin Fee = Refund Admin Fee + Estimated Returns Cost</p>
                        <p><strong>Purpose:</strong> Accounts for TikTok's administrative costs when processing customer refunds, including platform fees and return logistics.</p>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* FBT Section */}
                <Card className="bg-card">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold text-center">FBT</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-3">
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-card-foreground">Refund administration fee:</span>
                        <span className="text-lg font-bold text-rose-600">
                          ${(() => {
                            const referralFee = calculateTikTokReferralFee(product.sellingPrice || 0);
                            const refundAdminFee = calculateTikTokRefundAdminFee(referralFee);
                            return refundAdminFee.toFixed(2);
                          })()}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-card-foreground">Estimated Return %:</span>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            value={product.estimatedReturnsPercentage}
                             onChange={(e) => updateProduct(product.id, 'estimatedReturnsPercentage', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                            className="w-20 text-center"
                            step="0.1"
                            min="0"
                            max="100"
                          />
                          <span className="text-lg font-bold text-rose-600">%</span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center border-t pt-2 mt-2">
                        <span className="text-sm font-medium text-card-foreground">Estimated Returns Cost:</span>
                        <span className="text-lg font-bold text-rose-600">
                          ${(() => {
                            const referralFee = calculateTikTokReferralFee(product.sellingPrice);
                            const refundAdminFee = calculateTikTokRefundAdminFee(referralFee);
                              const factoryPriceInputs = calculateFactoryPriceInputs(product, additionalCostsTotal);
                            const estimatedReturnsCost = (product.estimatedReturnsPercentage / 100) * 
                              (refundAdminFee + tikTokFBTSubtotal + factoryPriceInputs);
                            return estimatedReturnsCost.toFixed(2);
                          })()}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* MCF Section */}
                <Card className="bg-card">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold text-center">MCF</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-3">
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-card-foreground">Refund administration fee:</span>
                        <span className="text-lg font-bold text-rose-600">
                          ${(() => {
                            const referralFee = calculateTikTokReferralFee(product.sellingPrice || 0);
                            const refundAdminFee = calculateTikTokRefundAdminFee(referralFee);
                            return refundAdminFee.toFixed(2);
                          })()}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-card-foreground">Estimated Return %:</span>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            value={product.estimatedReturnsPercentage}
                             onChange={(e) => updateProduct(product.id, 'estimatedReturnsPercentage', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                            className="w-20 text-center"
                            step="0.1"
                            min="0"
                            max="100"
                          />
                          <span className="text-lg font-bold text-rose-600">%</span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center border-t pt-2 mt-2">
                        <span className="text-sm font-medium text-card-foreground">Estimated Returns Cost:</span>
                        <span className="text-lg font-bold text-rose-600">
                          ${(() => {
                            const referralFee = calculateTikTokReferralFee(product.sellingPrice || 0);
                            const refundAdminFee = calculateTikTokRefundAdminFee(referralFee);
                              const factoryPriceInputs = calculateFactoryPriceInputs(product, additionalCostsTotal);
                            
                            // For MCF, get the calculated MCF values
                            const mcfFeeValue = mcfFee;
                            const storageFeeValue = mcfStorageFee;
                            
                            // Use the already calculated shipping and AWD values from the product
                            const shippingToAMZValue = derivedShipping.shippingToAMZ;
                            const awdReceivingCostValue = derivedShipping.awdReceivingCost;
                            const storageAWDValue = derivedShipping.storageAWDCost;
                            
                            // Calculate shipping to AWD (same calculation as shipping to AMZ)
                            const shippingToAWDValue = shippingToAMZValue;
                            
                            // Additional cost component: 30% * Shipping to AMZ + 70% * (Shipping to AWD + AWD Receiving Cost + Storage AWD)
                            const additionalCost = (0.3 * shippingToAMZValue) + (0.7 * (shippingToAWDValue + awdReceivingCostValue + storageAWDValue));
                            
                            const estimatedReturnsCost = (product.estimatedReturnsPercentage / 100) * 
                              (refundAdminFee + mcfFeeValue + storageFeeValue + factoryPriceInputs + additionalCost);
                            return estimatedReturnsCost.toFixed(2);
                          })()}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Profit Summary - Show only when TikTok Shop button is active */}
        {showTikTokShop && (
          <Card className="bg-gradient-to-r from-success-light to-accent-light border-success">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg text-success flex items-center">
                <TrendingUp className="w-5 h-5 mr-2" />
                Profit Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Profit MCF */}
                <div className="bg-white/50 rounded-lg p-4 border">
                  <h3 className="text-lg font-semibold text-success mb-3">
                    Profit MCF
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div>
                      <div className="text-xl font-bold text-success">
                        ${showTikTokShop ? calculateTikTokMCFTotalCost().toFixed(2) : calculateMCFTotalCost().toFixed(2)}
                      </div>
                      <div className="text-xs text-muted-foreground">Total Cost</div>
                      
                      {/* DEBUG BREAKDOWN RIGHT NEXT TO COST */}
                      <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-left">
                        <div className="text-xs font-semibold text-blue-800 mb-1">📊 Breakdown:</div>
                        <div className="text-xs space-y-0.5 text-blue-700">
                          {(() => {
                            const factoryPriceInputs = calculateFactoryPriceInputs(product, additionalCostsTotal);
                            
                            if (showTikTokShop) {
                              // TikTok Analysis breakdown
                              const shippingToAMZValue = derivedShipping.shippingToAMZ || 0;
                              const awdReceivingCostValue = derivedShipping.awdReceivingCost || 0;
                              const storageAWDValue = derivedShipping.storageAWDCost || 0;
                              const shippingComponent = (0.3 * shippingToAMZValue) + (0.7 * (shippingToAMZValue + awdReceivingCostValue + storageAWDValue));
                              const tikTokReferralFee = calculateTikTokReferralFee(product.sellingPrice || 0);
                              const refundAdminFee = calculateTikTokRefundAdminFee(tikTokReferralFee);
                              const mcfEstimatedReturnsCost = (product.estimatedReturnsPercentage / 100) * 
                                (refundAdminFee + mcfFee + mcfStorageFee + factoryPriceInputs + shippingComponent);
                              const marketingCostsTotal = marketingSubtotal;
                              
                              return (
                                <>
                                  <div className="flex justify-between">
                                    <span>Factory:</span>
                                    <span>${factoryPriceInputs.toFixed(2)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>MCF Fee:</span>
                                    <span>${mcfFee.toFixed(2)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Shipping Component:</span>
                                    <span>${shippingComponent.toFixed(2)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>TikTok Referral Fee:</span>
                                    <span>${tikTokReferralFee.toFixed(2)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>MCF Est. Returns:</span>
                                    <span>${mcfEstimatedReturnsCost.toFixed(2)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Marketing:</span>
                                    <span>${marketingCostsTotal.toFixed(2)}</span>
                                  </div>
                                </>
                              );
                            } else {
                              // Shopify Analysis breakdown
                              const totalMedia = product.shopifyRoas > 0 ? (product.sellingPrice || 0) / product.shopifyRoas : 0;
                              const agencyPercentage = product.shopifyAgencyPercentage || 8;
                              const creativePercentage = product.shopifyCreativePercentage || 7;
                              const agencyCost = totalMedia * agencyPercentage / 100;
                              const creativeCost = totalMedia * creativePercentage / 100;
                              const totalShopifyMarketing = totalMedia + agencyCost + creativeCost;
                              const transactionFeePercentage = product.shopifyTransactionFeePercentage || 3;
                              const transactionFee = (product.sellingPrice || 0) * transactionFeePercentage / 100;
                              const returnsPercentage = product.shopifyReturnsPercentage || 5;
                              const shopifyReturns = (product.sellingPrice || 0) * returnsPercentage / 100;
                              const shippingToAMZ = derivedShipping.shippingToAMZ || 0;
                              
                              return (
                                <>
                                  <div className="flex justify-between">
                                    <span>Factory:</span>
                                    <span>${factoryPriceInputs.toFixed(2)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>MCF Fee:</span>
                                    <span>${mcfFee.toFixed(2)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Storage:</span>
                                    <span>${mcfStorageFee.toFixed(2)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Marketing:</span>
                                    <span>${totalShopifyMarketing.toFixed(2)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Transaction:</span>
                                    <span>${transactionFee.toFixed(2)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Returns:</span>
                                    <span>${shopifyReturns.toFixed(2)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Shipping:</span>
                                    <span>${shippingToAMZ.toFixed(2)}</span>
                                  </div>
                                </>
                              );
                            }
                          })()}
                        </div>
                      </div>
                    </div>
                    <div>
                       <div className="text-xl font-bold text-success">${(product.sellingPrice ?? 0).toFixed(2)}</div>
                      <div className="text-xs text-muted-foreground">Selling Price</div>
                    </div>
                    <div>
                      <div className="text-xl font-bold text-success">
                        ${(() => {
                          const mcfTotalCost = showTikTokShop ? calculateTikTokMCFTotalCost() : calculateMCFTotalCost();
                          const mcfProfit = (product.sellingPrice ?? 0) - mcfTotalCost;
                          return mcfProfit.toFixed(2);
                        })()}
                      </div>
                      <div className="text-xs text-muted-foreground">Profit</div>
                    </div>
                    <div>
                      <div className="text-xl font-bold text-success">
                        {(() => {
                          const mcfTotalCost = showTikTokShop ? calculateTikTokMCFTotalCost() : calculateMCFTotalCost();
                          const mcfProfitMargin = mcfTotalCost > 0 ? (((product.sellingPrice ?? 0) - mcfTotalCost) / (product.sellingPrice ?? 0)) * 100 : 0;
                          
                          return (mcfProfitMargin ?? 0).toFixed(1);
                        })()}%
                      </div>
                      <div className="text-xs text-muted-foreground">Profit Margin</div>
                    </div>
                   </div>
                 </div>

                {/* Profit FBT */}
                <div className="bg-white/50 rounded-lg p-4 border">
                  <h3 className="text-lg font-semibold text-success mb-3">Profit FBT</h3>
                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div>
                      <div className="text-xl font-bold text-success">
                        ${(() => {
                          // Factory Price Inputs: Product Cost + Retail Box Cost + Card Cost + User Manual Cost + Additional Costs
          const factoryPriceInputs = calculateFactoryPriceInputs(product, additionalCostsTotal);
                          
                          // TikTok Referral FEE (6% of selling price)
                          const tikTokReferralFee = calculateTikTokReferralFee(product.sellingPrice || 0);
                          
                          // TikTok Refund Administration Fee calculations
                          const refundAdminFee = calculateTikTokRefundAdminFee(tikTokReferralFee);
                          const estimatedReturnsCost = (product.estimatedReturnsPercentage / 100) * (refundAdminFee + tikTokFBTSubtotal + factoryPriceInputs);
                          const tikTokRefundAdminFee = refundAdminFee + estimatedReturnsCost;
                          
                          // Total Cost = Factory Price Inputs + TikTok FBT Subtotal + Marketing Subtotal + TikTok Referral FEE + TikTok Refund Administration Fee
                          const fbtTotalCost = factoryPriceInputs + tikTokFBTSubtotal + marketingSubtotal + tikTokReferralFee + tikTokRefundAdminFee;
                          
                          return fbtTotalCost.toFixed(2);
                        })()}
                      </div>
                      <div className="text-xs text-muted-foreground">Total Cost</div>
                      
                      {/* FBT BREAKDOWN */}
                      <div className="mt-2 p-2 bg-purple-50 border border-purple-200 rounded text-left">
                        <div className="text-xs font-semibold text-purple-800 mb-1">📊 FBT Breakdown:</div>
                        <div className="text-xs space-y-0.5 text-purple-700">
                          {(() => {
                            const factoryPriceInputs = calculateFactoryPriceInputs(product, additionalCostsTotal);
                            const tikTokReferralFee = calculateTikTokReferralFee(product.sellingPrice || 0);
                            const refundAdminFee = calculateTikTokRefundAdminFee(tikTokReferralFee);
                            const estimatedReturnsCost = (product.estimatedReturnsPercentage / 100) * (refundAdminFee + tikTokFBTSubtotal + factoryPriceInputs);
                            
                            return (
                              <>
                                <div className="flex justify-between">
                                  <span>Factory:</span>
                                  <span>${factoryPriceInputs.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>FBT Fee:</span>
                                  <span>${tikTokFBTBreakdown.fbtFee.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>FBT Storage:</span>
                                  <span>${tikTokFBTBreakdown.storageCost.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>FBT Placement:</span>
                                  <span>${tikTokFBTBreakdown.placementFee.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>FBT Shipping:</span>
                                  <span>${tikTokFBTBreakdown.shippingCost.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>TikTok Referral Fee:</span>
                                  <span>${tikTokReferralFee.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>FBT Est. Returns:</span>
                                  <span>${estimatedReturnsCost.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Marketing:</span>
                                  <span>${marketingSubtotal.toFixed(2)}</span>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="text-xl font-bold text-success">${(product.sellingPrice ?? 0).toFixed(2)}</div>
                      <div className="text-xs text-muted-foreground">Selling Price</div>
                    </div>
                    <div>
                      <div className="text-xl font-bold text-success">
                        ${(() => {
                          // Factory Price Inputs: Product Cost + Retail Box Cost + Card Cost + User Manual Cost + Additional Costs
          const factoryPriceInputs = calculateFactoryPriceInputs(product, additionalCostsTotal);
                          
                          // TikTok Referral FEE (6% of selling price)
                          const tikTokReferralFee = calculateTikTokReferralFee(product.sellingPrice || 0);
                          
                          // TikTok Refund Administration Fee calculations
                          const refundAdminFee = calculateTikTokRefundAdminFee(tikTokReferralFee);
                          const estimatedReturnsCost = (product.estimatedReturnsPercentage / 100) * (refundAdminFee + tikTokFBTSubtotal + factoryPriceInputs);
                          const tikTokRefundAdminFee = refundAdminFee + estimatedReturnsCost;
                          
                          // Total Cost = Factory Price Inputs + TikTok FBT Subtotal + Marketing Subtotal + TikTok Referral FEE + TikTok Refund Administration Fee
                          const fbtTotalCost = factoryPriceInputs + tikTokFBTSubtotal + marketingSubtotal + tikTokReferralFee + tikTokRefundAdminFee;
                          const fbtProfit = (product.sellingPrice ?? 0) - fbtTotalCost;
                          
                          return fbtProfit.toFixed(2);
                        })()}
                      </div>
                      <div className="text-xs text-muted-foreground">Profit</div>
                    </div>
                    <div>
                      <div className="text-xl font-bold text-success">
                        {(() => {
                          // Factory Price Inputs: Product Cost + Retail Box Cost + Card Cost + User Manual Cost + Additional Costs
          const factoryPriceInputs = calculateFactoryPriceInputs(product, additionalCostsTotal);
                          
                          // TikTok Referral FEE (6% of selling price)
                          const tikTokReferralFee = calculateTikTokReferralFee(product.sellingPrice || 0);
                          
                          // TikTok Refund Administration Fee calculations
                          const refundAdminFee = calculateTikTokRefundAdminFee(tikTokReferralFee);
                          const estimatedReturnsCost = (product.estimatedReturnsPercentage / 100) * (refundAdminFee + tikTokFBTSubtotal + factoryPriceInputs);
                          const tikTokRefundAdminFee = refundAdminFee + estimatedReturnsCost;
                          
                          // Total Cost = Factory Price Inputs + TikTok FBT Subtotal + Marketing Subtotal + TikTok Referral FEE + TikTok Refund Administration Fee
                          const fbtTotalCost = factoryPriceInputs + tikTokFBTSubtotal + marketingSubtotal + tikTokReferralFee + tikTokRefundAdminFee;
                          const fbtProfitMargin = fbtTotalCost > 0 ? (((product.sellingPrice ?? 0) - fbtTotalCost) / (product.sellingPrice ?? 0)) * 100 : 0;
                          
                          return (fbtProfitMargin ?? 0).toFixed(1);
                        })()}%
                      </div>
                      <div className="text-xs text-muted-foreground">Profit Margin</div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Show Amazon FBA specific sections only when FBA button is active */}
        {showAmazonFBA && (
        <>
        {/* FBA Calculation Component */}
        <div className="mb-8">
          <div className="flex items-center mb-4">
            <h2 className="text-lg font-semibold mr-2">Amazon FBA Fees</h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-4 h-4 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-lg">
                <div className="space-y-2">
                  <p className="font-semibold">Amazon FBA Fees</p>
                  <p>Calculates Amazon's Fulfillment by Amazon fees and commissions.</p>
                  <div className="text-sm space-y-1">
                    <p><strong>Fee Components:</strong></p>
                    <p>• Fulfillment Fee = Size tier + weight-based (Peak vs Non-Peak seasons)</p>
                    <p>• Referral Fee = Category % × Selling Price (varies by category)</p>
                    <p>• Return Processing = Min(20% × Selling Price, $20) if {'>'}$10</p>
                    <p>• SIPP Discount = Available if L{'>'}6&quot;, W{'>'}4&quot;, H{'>'}0.375&quot;</p>
                    <p>• Low Price Discount = $0.77 if Selling Price {'<'}$10</p>
                    <p><strong>Weighted Fees:</strong> (Non-Peak × 9 + Peak × 3) ÷ 12</p>
                    <p><strong>Size Determination:</strong> Based on longest, median, shortest dimensions + weight</p>
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
          <FBACalculation
          length={product.length}
          width={product.width}
          height={product.height}
          weight={product.weight}
          sellingPrice={product.sellingPrice}
          category={product.category}
          additionalCosts={additionalCostsTotal}
          sippEligibleOverride={product.sippEligibleOverride ?? true}
          onSippOverrideChange={(value) => updateProduct(product.id, 'sippEligibleOverride', value)}
          hazmat={product.hazmat || false}
          containsBatteries={product.containsBatteries || false}
        />
        </div>

        {/* Shipping & Storage */}
        <Card className="bg-cyan-50 border-cyan-400">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg text-cyan-800 flex items-center justify-between">
              <div className="flex items-center">
                <Package className="w-5 h-5 mr-2" />
                Shipping & Storage
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-4 h-4 text-cyan-600 cursor-help ml-2" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-lg">
                    <div className="space-y-2">
                      <p className="font-semibold">Shipping & Storage</p>
                      <p>Calculates total logistics costs based on fulfillment method mix.</p>
                      <div className="text-sm space-y-1">
                        <p><strong>Cost Components:</strong></p>
                        <p>• Shipping to AMZ = CBM per unit × CBM cost</p>
                        <p>• FBA Storage = CBF per unit × FBA rate × months</p>
                        <p>• AWD Receiving = AWD case cost ÷ units per carton</p>
                        <p>• AWD Storage = CBF per unit × AWD rate × months</p>
                        <p>• Transfer AWD→FBA = CBF per unit × transfer cost</p>
                        <p><strong>Fulfillment Mix:</strong></p>
                        <p>• 100% FBA: AMZ shipping + FBA storage only</p>
                        <p>• Mixed (30/50/70% FBA): Weighted average of costs</p>
                        <p>• 100% AWD: Full AWD cost chain + transfer to FBA</p>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Label>Fulfillment:</Label>
                  <Select value={product.fulfillmentMethod} onValueChange={(value) => updateProduct(product.id, 'fulfillmentMethod', value)}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="100% FBA">100% FBA</SelectItem>
                      <SelectItem value="30% FBA - 70% AWD">30% FBA - 70% AWD</SelectItem>
                      <SelectItem value="50% FBA - 50% AWD">50% FBA - 50% AWD</SelectItem>
                      <SelectItem value="70% FBA - 30% AWD">70% FBA - 30% AWD</SelectItem>
                      <SelectItem value="100% AWD">100% AWD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label>Storage months:</Label>
                  <Input
                    type="number"
                    value={product.storageMonths}
                    onChange={(e) => updateProduct(product.id, 'storageMonths', Math.max(1, Math.min(12, parseInt(e.target.value) || 1)))}
                    className="w-20"
                    min="1"
                    max="12"
                  />
                </div>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Card className="bg-card">
              <CardContent className="pt-6">
                <div className="space-y-4">
                  {(() => {
                    // Debug: Log the current product master carton values
                    console.log('Master Carton Values Check:', {
                      masterCartonLength: product.masterCartonLength,
                      masterCartonWidth: product.masterCartonWidth, 
                      masterCartonHeight: product.masterCartonHeight,
                      masterCartonUnits: product.masterCartonUnits,
                      productLength: product.length,
                      productWidth: product.width,
                      productHeight: product.height,
                      productWeight: product.weight,
                      calculatorMode: calculatorMode
                    });
                    
                    // Use CBM based on calculator mode
                    let cbmPerUnit = 0;
                    let calculationSource = '';
                    
                    // For R&D mode (pre-launch), prioritize Master Carton Optimization
                    if (calculatorMode === 'pre-launch') {
                      // Use Master Carton Optimization if product dimensions are available
                       if ((product.length ?? 0) > 0 && (product.width ?? 0) > 0 && (product.height ?? 0) > 0 && (product.weight ?? 0) > 0) {
                         const optimized = memoizedCartonOptimization;
                        if (optimized) {
                          cbmPerUnit = optimized.cbmPerUnit;
                          calculationSource = `Master Carton Optimization (R&D): ${optimized.l}cm × ${optimized.w}cm × ${optimized.h}cm ÷ 1,000,000 ÷ ${optimized.units} units = ${cbmPerUnit.toFixed(8)} CBM per unit`;
                          console.log('CBM Calculation Source:', calculationSource);
                        }
                      }
                    } 
                    // For Live mode (legacy), prioritize Master Carton Final Packing
                    else {
                      // First check if Master Carton Final Packing values are entered
                      if (product.masterCartonLength > 0 && product.masterCartonWidth > 0 && product.masterCartonHeight > 0 && product.masterCartonUnits > 0) {
                        const dimensions = {
                          masterCartonLength: product.masterCartonLength,
                          masterCartonWidth: product.masterCartonWidth,
                          masterCartonHeight: product.masterCartonHeight,
                          masterCartonUnits: product.masterCartonUnits
                        };
                         const cbmResult = memoizedCBMResult;
                         cbmPerUnit = cbmResult.cbmPerUnit;
                         calculationSource = cbmResult.sourceDescription;
                        console.log('CBM Calculation Source:', calculationSource);
                      } 
                      // Otherwise use Master Carton Optimization if product dimensions are available
                       else if ((product.length ?? 0) > 0 && (product.width ?? 0) > 0 && (product.height ?? 0) > 0 && (product.weight ?? 0) > 0) {
                         const optimized = memoizedCartonOptimization;
                        if (optimized) {
                          cbmPerUnit = optimized.cbmPerUnit;
                          calculationSource = `Master Carton Optimization (Live fallback): ${optimized.l}cm × ${optimized.w}cm × ${optimized.h}cm ÷ 1,000,000 ÷ ${optimized.units} units = ${cbmPerUnit.toFixed(8)} CBM per unit`;
                          console.log('CBM Calculation Source:', calculationSource);
                        }
                      }
                    }
                    
                    // Calculate Shipping to AMZ cost
                    const shippingToAMZCost = cbmPerUnit * product.cbmCost;
                    
                    // Calculate Shipping to AWD cost (same logic as Shipping to AMZ)
                    const shippingToAWDCost = cbmPerUnit * product.shippingToAWD;
                    
                    // Calculate AWD Receiving cost
                    let awdReceivingCost = 0;
                    let units = 0;
                    
                    // First check if Master Carton Final Packing units are entered
                    if (product.masterCartonUnits > 0) {
                      units = product.masterCartonUnits;
                    } 
                    // Otherwise use Master Carton Optimization units if product dimensions are available
                     else if ((product.length ?? 0) > 0 && (product.width ?? 0) > 0 && (product.height ?? 0) > 0 && (product.weight ?? 0) > 0) {
                       const optimized = memoizedCartonOptimization;
                      if (optimized) {
                        units = optimized.units;
                      }
                    }
                    
                    if (units > 0) {
                      awdReceivingCost = product.awdCaseReceiveCost / units;
                    }

                    // Calculate Transfer AWD to FBA cost
                    // Use CBF per Unit from Master Carton Final Packing if entered, otherwise from Master Carton Optimization
                    let cbfPerUnit = 0;
                    if (product.masterCartonLength > 0 && product.masterCartonWidth > 0 && product.masterCartonHeight > 0 && product.masterCartonUnits > 0) {
                       // CBF per Unit from Master Carton Final Packing (matches UI display)
                       cbfPerUnit = (((product.masterCartonLength * product.masterCartonWidth * product.masterCartonHeight) / 1000000) * 35.3147 / product.masterCartonUnits);
                     } else if ((product.length ?? 0) > 0 && (product.width ?? 0) > 0 && (product.height ?? 0) > 0 && (product.weight ?? 0) > 0) {
                       // CBF per Unit from Master Carton Optimization
                       const optimized = memoizedCartonOptimization;
                      if (optimized) {
                        cbfPerUnit = optimized.cbfPerUnit;
                      }
                    }
                    const transferAWDToFBACost = cbfPerUnit * product.awdTransportationCost;
                    
                    // Storage FBA calculation: storageMonths × Amazon FBA AVG Fee (per cbf) × CBF per Unit
                    const amazonFBAAVGFee = (product.amazonFBAStorageFeeNonPeak * 9 + product.amazonFBAStorageFeePeak * 3) / 12;
                    const storageFBACost = product.storageMonths * amazonFBAAVGFee * cbfPerUnit;
                    
                    // Storage AWD calculation  
                    const storageAWDCost = cbfPerUnit * (product.amazonAWDStorageFee || 0) * product.storageMonths;
                    
                    return (
                      <>
                        <div className="grid grid-cols-3 gap-4 items-center">
                          <div className="text-sm font-medium text-card-foreground flex items-center">
                            Shipping to AMZ
                            <div className="ml-1 cursor-help" title={`${calculationSource || 'CBM per unit calculation'}\nShipping to AMZ = ${cbmPerUnit.toFixed(8)} × $${product.cbmCost} = $${shippingToAMZCost.toFixed(2)}`}>
                              <Info className="w-4 h-4 text-muted-foreground" />
                            </div>
                          </div>
                          <div></div>
                          <div className="text-right text-sm font-semibold">${(derivedShipping.shippingToAMZ || 0).toFixed(2)}</div>
                        </div>
                        <div className="grid grid-cols-3 gap-4 items-center">
                          <div className="text-sm font-medium text-card-foreground">Shipping to AWD</div>
                          <div></div>
                          <div className="text-right text-sm font-semibold">${shippingToAWDCost.toFixed(2)}</div>
                        </div>
                        <div className="grid grid-cols-3 gap-4 items-center">
                          <div className="text-sm font-medium text-card-foreground">AWD Receiving cost</div>
                          <div></div>
                          <div className="text-right text-sm font-semibold">${awdReceivingCost.toFixed(2)}</div>
                        </div>
                        <div className="grid grid-cols-3 gap-4 items-center">
                          <div className="text-sm font-medium text-card-foreground">Transfer AWD to FBA cost</div>
                          <div></div>
                          <div className="text-right text-sm font-semibold">${transferAWDToFBACost.toFixed(2)}</div>
                        </div>
                        <div className={`grid grid-cols-3 gap-4 items-center ${product.hazmat ? 'bg-orange-50 -mx-4 px-4 py-2 rounded-lg border border-orange-200' : ''}`}>
                          <div className="text-sm font-medium text-card-foreground flex items-center gap-2">
                            Storage FBA
                            {product.hazmat && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium bg-orange-100 text-orange-700 rounded-full">
                                <AlertTriangle className="w-3 h-3" />
                                Hazmat
                              </span>
                            )}
                          </div>
                          <div className="text-center">
                            {product.hazmat && regularStorageMetrics && (
                              <span className="text-xs text-gray-400 line-through">
                                ${regularStorageMetrics.storageFBA.toFixed(2)}
                              </span>
                            )}
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-semibold">${memoizedStorageMetrics.storageFBA.toFixed(2)}</span>
                            {product.hazmat && regularStorageMetrics && (
                              <span className="ml-1 text-xs text-orange-600">
                                (+${(memoizedStorageMetrics.storageFBA - regularStorageMetrics.storageFBA).toFixed(2)})
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-4 items-center">
                          <div className="text-sm font-medium text-card-foreground">Storage AWD</div>
                          <div></div>
                          <div className="text-right text-sm font-semibold">${memoizedStorageMetrics.storageAWD.toFixed(2)}</div>
                        </div>
                        <hr className="my-4" />
                        <div className="grid grid-cols-3 gap-4 items-center font-bold">
                          <div className="text-sm text-card-foreground">TOTAL</div>
                          <div></div>
                          <div className="text-right text-lg text-cyan-700">
                            ${(() => {
                              // Use memoized storage metrics instead of recalculating
                              const { storageFBA, storageAWD } = memoizedStorageMetrics;
                              const { cbmPerUnit, cbfPerUnit, units } = memoizedCBMResult;
                              
                              const shippingToAMZCost = cbmPerUnit * product.cbmCost;
                              const shippingToAWDCost = cbmPerUnit * product.shippingToAWD;
                              const awdReceivingCost = units > 0 ? product.awdCaseReceiveCost / units : 0;
                              const transferAWDToFBACost = cbfPerUnit * product.awdTransportationCost;
                              
                              // Calculate total based on fulfillment method (Excel formula implementation)
                              if (product.fulfillmentMethod === '100% FBA') {
                                return (shippingToAMZCost + storageFBA).toFixed(2);
                              } else if (product.fulfillmentMethod === '30% FBA - 70% AWD') {
                                return ((0.3 * (shippingToAMZCost + storageFBA)) + (0.7 * (shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + storageAWD + storageFBA))).toFixed(2);
                              } else if (product.fulfillmentMethod === '50% FBA - 50% AWD') {
                                return ((0.5 * (shippingToAMZCost + storageFBA)) + (0.5 * (shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + storageAWD + storageFBA))).toFixed(2);
                              } else if (product.fulfillmentMethod === '70% FBA - 30% AWD') {
                                return ((0.7 * (shippingToAMZCost + storageFBA)) + (0.3 * (shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + storageAWD + storageFBA))).toFixed(2);
                              } else if (product.fulfillmentMethod === '100% AWD') {
                                return (shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + (storageAWD/2) + storageFBA).toFixed(2);
                              } else {
                                // Default to 100% FBA
                                return (shippingToAMZCost + storageFBA).toFixed(2);
                              }
                            })()}
                          </div>
                        </div>
                        
                        {/* Formula Display */}
                        <div className="mt-4 p-3 bg-cyan-100 rounded-lg border border-cyan-300">
                          <div className="text-sm font-medium text-cyan-800 mb-2">Formula for {product.fulfillmentMethod || '100% FBA'}:</div>
                          <div className="text-xs text-cyan-700 font-mono">
                            {(() => {
                              // Use memoized storage metrics instead of recalculating
                              const { storageFBA, storageAWD } = memoizedStorageMetrics;
                              const { cbmPerUnit, cbfPerUnit, units } = memoizedCBMResult;
                              
                              const shippingToAMZCost = cbmPerUnit * product.cbmCost;
                              const shippingToAWDCost = cbmPerUnit * product.shippingToAWD;
                              const awdReceivingCost = units > 0 ? product.awdCaseReceiveCost / units : 0;
                              const transferAWDToFBACost = cbfPerUnit * product.awdTransportationCost;
                              
                              // Display formula based on fulfillment method
                              if (product.fulfillmentMethod === '100% FBA') {
                                return `Shipping to AMZ (${shippingToAMZCost.toFixed(2)}) + Storage FBA (${storageFBA.toFixed(2)}) = $${(shippingToAMZCost + storageFBA).toFixed(2)}`;
                              } else if (product.fulfillmentMethod === '30% FBA - 70% AWD') {
                                const fbaTotal = shippingToAMZCost + storageFBA;
                                const awdTotal = shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + storageAWD + storageFBA;
                                return `30% × (${shippingToAMZCost.toFixed(2)} + ${storageFBA.toFixed(2)}) + 70% × (${shippingToAWDCost.toFixed(2)} + ${awdReceivingCost.toFixed(2)} + ${transferAWDToFBACost.toFixed(2)} + ${storageAWD.toFixed(2)} + ${storageFBA.toFixed(2)}) = 30% × ${fbaTotal.toFixed(2)} + 70% × ${awdTotal.toFixed(2)} = $${((0.3 * fbaTotal) + (0.7 * awdTotal)).toFixed(2)}`;
                              } else if (product.fulfillmentMethod === '50% FBA - 50% AWD') {
                                const fbaTotal = shippingToAMZCost + storageFBA;
                                const awdTotal = shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + storageAWD + storageFBA;
                                return `50% × (${shippingToAMZCost.toFixed(2)} + ${storageFBA.toFixed(2)}) + 50% × (${shippingToAWDCost.toFixed(2)} + ${awdReceivingCost.toFixed(2)} + ${transferAWDToFBACost.toFixed(2)} + ${storageAWD.toFixed(2)} + ${storageFBA.toFixed(2)}) = 50% × ${fbaTotal.toFixed(2)} + 50% × ${awdTotal.toFixed(2)} = $${((0.5 * fbaTotal) + (0.5 * awdTotal)).toFixed(2)}`;
                              } else if (product.fulfillmentMethod === '70% FBA - 30% AWD') {
                                const fbaTotal = shippingToAMZCost + storageFBA;
                                const awdTotal = shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + storageAWD + storageFBA;
                                return `70% × (${shippingToAMZCost.toFixed(2)} + ${storageFBA.toFixed(2)}) + 30% × (${shippingToAWDCost.toFixed(2)} + ${awdReceivingCost.toFixed(2)} + ${transferAWDToFBACost.toFixed(2)} + ${storageAWD.toFixed(2)} + ${storageFBA.toFixed(2)}) = 70% × ${fbaTotal.toFixed(2)} + 30% × ${awdTotal.toFixed(2)} = $${((0.7 * fbaTotal) + (0.3 * awdTotal)).toFixed(2)}`;
                              } else if (product.fulfillmentMethod === '100% AWD') {
                                return `Shipping to AWD (${shippingToAWDCost.toFixed(2)}) + AWD Receiving (${awdReceivingCost.toFixed(2)}) + Transfer AWD to FBA (${transferAWDToFBACost.toFixed(2)}) + Storage AWD/2 (${(storageAWD/2).toFixed(2)}) + Storage FBA (${storageFBA.toFixed(2)}) = $${(shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + (storageAWD/2) + storageFBA).toFixed(2)}`;
                              } else {
                                // Default to 100% FBA
                                return `Shipping to AMZ (${shippingToAMZCost.toFixed(2)}) + Storage FBA (${storageFBA.toFixed(2)}) = $${(shippingToAMZCost + storageFBA).toFixed(2)}`;
                              }
                            })()}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
          </CardContent>
        </Card>

        {/* Marketing Cost */}
        <Card className="bg-destructive/5 border-destructive">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg text-destructive flex items-center">
              <TrendingUp className="w-5 h-5 mr-2" />
              Marketing Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Card className="bg-card">
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                  <div className="text-center">
                    <div className="text-sm font-medium text-card-foreground mb-2">Marketing TACOS</div>
                    <div className="text-2xl font-bold text-destructive">
                      ${((product.sellingPrice ?? 0) * marketingPercentLocal / 100).toFixed(2)}
                    </div>
                  </div>
                  <MarketingPercentageInput 
                    value={marketingPercentLocal}
                    sellingPrice={product.sellingPrice}
                    productId={product.id}
                    updateProduct={updateProduct}
                    onLocalChange={updateMarketingPercentLocal}
                  />
                </div>
              </CardContent>
            </Card>
          </CardContent>
        </Card>

        {/* Customer Returns */}
        <Card className="bg-rose-50 border-rose-400">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg text-rose-800 flex items-center">
              <TrendingUp className="w-5 h-5 mr-2" />
              Customer Returns
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="bg-card">
                <CardContent className="pt-6">
                  <Label className="block text-sm font-medium text-card-foreground mb-2">Estimated Returns (%)</Label>
                  <Input
                    type="number"
                    value={product.estimatedReturnsPercentage}
                    onChange={(e) => updateProduct(product.id, 'estimatedReturnsPercentage', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                    step="0.1"
                    min="0"
                    max="100"
                  />
                </CardContent>
              </Card>
              <Card className="bg-card">
                <CardContent className="pt-6">
                  <div className="flex items-center">
                    <h4 className="font-semibold text-card-foreground mb-3 mr-2">Calculated Return Costs</h4>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-4 h-4 text-muted-foreground cursor-help mb-3" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-lg">
                        <div className="space-y-2">
                          <p className="font-semibold">Calculated Return Costs</p>
                          <p>Estimates costs associated with product returns based on return percentage.</p>
                          <div className="text-sm space-y-1">
                            <p><strong>Components:</strong></p>
                            <p>• Refund Admin Fee = Min($5, 20% × Referral Fee)</p>
                            <p>• Return Fee = Return Processing Fee (based on size tier & weight)</p>
                            <p><strong>Total Formula:</strong></p>
                            <p>Returns % × (Product Cost + Retail Box + Card + Manual + Shipping&Storage + Admin Fee + Return Fee + Weighted FBA Fees - SIPP Discount)</p>
                            <p><strong>Purpose:</strong> Accounts for costs when customers return products, including refund processing, return shipping, and restocking fees.</p>
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="space-y-3">
                    {(() => {
                      // Use memoized storage metrics instead of manual calculation
                      const { storageFBA, storageAWD } = memoizedStorageMetrics;
                      const { cbmPerUnit, cbfPerUnit, units } = memoizedCBMResult;
                      
                      const returnsRate = product.estimatedReturnsPercentage / 100;
                      const referralFee = calculateReferralFee(product.category, product.sellingPrice).fee;
                      const refundAdminFee = Math.min(5, 0.2 * referralFee); // MIN(5, 0.2 * Referral Fee)
                      
                      // Calculate return processing fee based on size tier and weight
                      const fbaData = calculateFBATierAndFee(product.length ?? 0, product.width ?? 0, product.height ?? 0, product.weight ?? 0, product.sellingPrice ?? 0, product.hazmat || false);
                      const shippingWeightOz = fbaData.billableWeight * 16; // Convert pounds to ounces
                      const returnProcessingFee = calculateReturnProcessingFee(fbaData.tier, shippingWeightOz);
                      const returnFee = returnProcessingFee;
                      
                      // Calculate shipping & storage total using memoized values
                      const shippingToAMZCost = cbmPerUnit * product.cbmCost;
                      const shippingToAWDCost = cbmPerUnit * product.shippingToAWD;
                      const awdReceivingCost = units > 0 ? product.awdCaseReceiveCost / units : 0;
                      const transferAWDToFBACost = cbfPerUnit * product.awdTransportationCost;
                      
                      // Calculate total based on fulfillment method
                      let shippingStorageTotal = 0;
                      if (product.fulfillmentMethod === '100% FBA') {
                        shippingStorageTotal = shippingToAMZCost + storageFBA;
                      } else if (product.fulfillmentMethod === '30% FBA - 70% AWD') {
                        shippingStorageTotal = (0.3 * (shippingToAMZCost + storageFBA)) + (0.7 * (shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + storageAWD + storageFBA));
                      } else if (product.fulfillmentMethod === '50% FBA - 50% AWD') {
                        shippingStorageTotal = (0.5 * (shippingToAMZCost + storageFBA)) + (0.5 * (shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + storageAWD + storageFBA));
                      } else if (product.fulfillmentMethod === '70% FBA - 30% AWD') {
                        shippingStorageTotal = (0.7 * (shippingToAMZCost + storageFBA)) + (0.3 * (shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + storageAWD + storageFBA));
                      } else if (product.fulfillmentMethod === '100% AWD') {
                        shippingStorageTotal = shippingToAWDCost + awdReceivingCost + transferAWDToFBACost + (storageAWD/2) + storageFBA;
                      } else {
                        // Default to 100% FBA
                        shippingStorageTotal = shippingToAMZCost + storageFBA;
                      }
                      
                      // Calculate weighted average of FBA Fulfillment Fees
                      // (FBA Fulfillment Fees Non-Peak Season * 9 + FBA Fulfillment Fees Peak Season * 3) / 12
                      const weightedFBAFees = (fbaData.feeNonPeak * 9 + fbaData.feePeak * 3) / 12;
                      
                      // Calculate SIPP Discount (if eligible)
                      // Use sorted dimensions for SIPP eligibility
                      const dims = [product.length / 2.54, product.width / 2.54, product.height / 2.54].sort((a, b) => b - a);
                      const sippEligible = dims[0] > 6 && dims[1] > 4 && dims[2] > 0.375;
                      const finalSippEligible = sippEligible && (product.sippEligibleOverride ?? true);
                      const sippDiscount = finalSippEligible ? calculateSippDiscount(fbaData.tier, fbaData.billableWeight * 16) : 0;
                      
                      // Apply formula: Estimated Returns (%) * (Factory Price Inputs + TOTAL from Shipping & Storage + Refund Administration Fee + Return Fee + Weighted FBA Fees - SIPP Discount)
                      const factoryPriceInputs = calculateFactoryPriceInputs(product, additionalCostsTotal);
                      const totalRefundCost = (product.estimatedReturnsPercentage / 100) * (
                        factoryPriceInputs + 
                        shippingStorageTotal + 
                        refundAdminFee + 
                        returnFee + 
                        weightedFBAFees - 
                        sippDiscount
                      );
                      
                      return (
                        <>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Refund Administration Fee:</span>
                            <span className="font-semibold">${refundAdminFee.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Return Fee:</span>
                            <span className="font-semibold">${returnFee.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-sm font-bold border-t pt-2 mt-2">
                            <span className="text-card-foreground">Total Refund Cost/Unit:</span>
                            <span className="text-rose-700">${totalRefundCost.toFixed(2)}</span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>

        
      {showSummaryBar && (
        <SummaryBar
          sellingPrice={product.sellingPrice}
          totalCost={totalCost}
          profit={profit}
          marginPercent={profitMargin}
          tacosPercent={marketingPercentLocal}
          onSellingPriceChange={(val) => updateProduct(product.id, 'sellingPrice', val)}
          showTikTokDual={showTikTokShop && !showAmazonFBA}
          mcfData={showTikTokShop ? {
            totalCost: (() => {
              const factoryPriceInputs = calculateFactoryPriceInputs(product, additionalCostsTotal);
              const tikTokReferralFee = calculateTikTokReferralFee(product.sellingPrice || 0);
              const shippingToAMZValue = derivedShipping.shippingToAMZ;
              const awdReceivingCostValue = derivedShipping.awdReceivingCost;
              const storageAWDValue = derivedShipping.storageAWDCost;
              const shippingToAWDValue = shippingToAMZValue;
              const additionalCost = (0.3 * shippingToAMZValue) + (0.7 * (shippingToAWDValue + awdReceivingCostValue + storageAWDValue));
              const refundAdminFee = calculateTikTokRefundAdminFee(tikTokReferralFee);
              const mcfEstimatedReturnsCost = (product.estimatedReturnsPercentage / 100) * 
                (refundAdminFee + mcfFee + mcfStorageFee + factoryPriceInputs + additionalCost);
              const totalCost = calculateMCFTotalCost();
              
              console.log('=== MCF TOTAL COST BREAKDOWN ===');
              console.log('MCF Components:', {
                factoryPriceInputs,
                mcfFee,
                mcfStorageFee,
                marketingSubtotal,
                tikTokReferralFee,
                mcfEstimatedReturnsCost,
                additionalCost,
                totalCost,
                productId: product.id,
                
                // Individual factory price components
                productCost: product.cost,
                retailBoxCost: product.retailBoxCost,
                cardCost: product.cardCost,
                userManualCost: product.userManualCost,
                additionalCostsTotal,
                
                // Calculated shipping values that might be different
                shippingToAMZValue: derivedShipping.shippingToAMZ,
                awdReceivingCostValue: derivedShipping.awdReceivingCost,
                storageAWDValue: derivedShipping.storageAWDCost,
                
                // Show the additionalCost calculation breakdown
                additionalCostBreakdown: {
                  shippingComponent: 0.3 * derivedShipping.shippingToAMZ,
                  awdComponent: 0.7 * (derivedShipping.shippingToAMZ + derivedShipping.awdReceivingCost + derivedShipping.storageAWDCost),
                  totalAdditionalCost: additionalCost
                }
              });
              
              return totalCost;
            })(),
            profit: (() => {
              const factoryPriceInputs = calculateFactoryPriceInputs(product, additionalCostsTotal);
              // Calculate Total Shopify Marketing
              const totalMedia = product.shopifyRoas > 0 ? (product.sellingPrice || 0) / product.shopifyRoas : 0;
              const agencyPercentage = product.shopifyAgencyPercentage || 8;
              const creativePercentage = product.shopifyCreativePercentage || 7;
              const agencyCost = totalMedia * agencyPercentage / 100;
              const creativeCost = totalMedia * creativePercentage / 100;
              const totalShopifyMarketing = totalMedia + agencyCost + creativeCost;
              
              // Calculate Transaction Fee
              const transactionFeePercentage = product.shopifyTransactionFeePercentage || 3;
              const transactionFee = (product.sellingPrice || 0) * transactionFeePercentage / 100;
              
              // Calculate Shopify Returns
              const returnsPercentage = product.shopifyReturnsPercentage || 5;
              const shopifyReturns = (product.sellingPrice || 0) * returnsPercentage / 100;
              
              // Calculate Shipping to AMZ - USE THE ACTUAL FIELD VALUE
              const shippingToAMZ = derivedShipping.shippingToAMZ || 0;
              
              const mcfTotalCost = factoryPriceInputs + mcfFee + mcfStorageFee + totalShopifyMarketing + transactionFee + shopifyReturns + shippingToAMZ;
              return product.sellingPrice - mcfTotalCost;
            })(),
            marginPercent: (() => {
              const mcfTotalCost = calculateMCFTotalCost();
              return mcfTotalCost > 0 ? (((product.sellingPrice || 0) - mcfTotalCost) / (product.sellingPrice || 1)) * 100 : 0;
            })()
          } : {
            totalCost: calculateMCFTotalCost(),
            profit: (() => {
              const mcfTotalCost = calculateMCFTotalCost();
              return (product.sellingPrice || 0) - mcfTotalCost;
            })(),
            marginPercent: (() => {
              const mcfTotalCost = calculateMCFTotalCost();
              return mcfTotalCost > 0 ? (((product.sellingPrice || 0) - mcfTotalCost) / (product.sellingPrice || 1)) * 100 : 0;
            })()
          }}
          fbtData={showTikTokShop ? (() => {
            const factoryPriceInputs = calculateFactoryPriceInputs(product, additionalCostsTotal);
            const tikTokReferralFee = calculateTikTokReferralFee(product.sellingPrice || 0);
            const refundAdminFee = calculateTikTokRefundAdminFee(tikTokReferralFee);
            const estimatedReturnsCost = (product.estimatedReturnsPercentage / 100) * (refundAdminFee + tikTokFBTSubtotal + factoryPriceInputs);
            const tikTokRefundAdminFee = refundAdminFee + estimatedReturnsCost;
            
            const fbtDataObj = {
              totalCost: factoryPriceInputs + tikTokFBTSubtotal + marketingSubtotal + tikTokReferralFee + tikTokRefundAdminFee,
              profit: (() => {
                const factoryPriceInputs = calculateFactoryPriceInputs(product, additionalCostsTotal);
                const tikTokReferralFee = calculateTikTokReferralFee(product.sellingPrice || 0);
                const refundAdminFee = calculateTikTokRefundAdminFee(tikTokReferralFee);
                const estimatedReturnsCost = (product.estimatedReturnsPercentage / 100) * (refundAdminFee + tikTokFBTSubtotal + factoryPriceInputs);
                const tikTokRefundAdminFee = refundAdminFee + estimatedReturnsCost;
                const fbtTotalCost = factoryPriceInputs + tikTokFBTSubtotal + marketingSubtotal + tikTokReferralFee + tikTokRefundAdminFee;
                return product.sellingPrice - fbtTotalCost;
              })(),
              marginPercent: (() => {
                const factoryPriceInputs = calculateFactoryPriceInputs(product, additionalCostsTotal);
                const tikTokReferralFee = calculateTikTokReferralFee(product.sellingPrice || 0);
                const refundAdminFee = calculateTikTokRefundAdminFee(tikTokReferralFee);
                const estimatedReturnsCost = (product.estimatedReturnsPercentage / 100) * (refundAdminFee + tikTokFBTSubtotal + factoryPriceInputs);
                const tikTokRefundAdminFee = refundAdminFee + estimatedReturnsCost;
                const fbtTotalCost = factoryPriceInputs + tikTokFBTSubtotal + marketingSubtotal + tikTokReferralFee + tikTokRefundAdminFee;
                return fbtTotalCost > 0 ? ((product.sellingPrice - fbtTotalCost) / product.sellingPrice) * 100 : 0;
              })()
            };
            
            return fbtDataObj;
          })() : undefined}
        />
      )}
        </>
        )}
      </>
      )}
      </CardContent>
    </Card>
  );
});

ProductCard.displayName = 'ProductCard';

export default ProductCard;