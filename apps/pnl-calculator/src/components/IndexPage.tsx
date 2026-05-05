"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { Calculator, Plus, Settings, ChevronDown, ChevronUp, Package, TrendingUp, Rocket, Archive, Download, Store } from 'lucide-react';
import { Button } from "@platform/ui";
import { Input } from "@platform/ui";
import { Label } from "@platform/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@platform/ui";
import ProductCard from './ProductCard';
import FloatingCalculationDatabase from './FloatingCalculationDatabase';

import type { Product, AdditionalCost, SavedVersion } from '@/types/product';
import { useToast } from "@platform/ui";
import { useScrollRestoration } from '@/hooks/useScrollRestoration';

const Index: React.FC = () => {
  useScrollRestoration();
  const [showFeesInput, setShowFeesInput] = useState(false);
  const [showAmazonFBA, setShowAmazonFBA] = useState(true);
  const [showAmazonMCF, setShowAmazonMCF] = useState(false);
  
  const [showShopify, setShowShopify] = useState(false);
  const [calculatorMode, setCalculatorMode] = useState<'pre-launch' | 'legacy' | null>(null);
  const [showModeDialog, setShowModeDialog] = useState(false); // Start as false until we check localStorage
  const [isStateLoaded, setIsStateLoaded] = useState(false); // Track if localStorage has been loaded
  const { toast } = useToast();
  
  
  const [products, setProducts] = useState<Product[]>([
  {
    id: 1,
    name: 'Product 1',
    savedVersions: [],
    status: 'Active',
    bucket: undefined,
      sku: '',
      cost: undefined,
      costQuantity: undefined,
      productCostLabel: undefined,
      retailBoxCost: undefined,
      retailBoxCostQuantity: undefined,
      retailBoxCostLabel: undefined,
      cardCost: undefined,
      cardCostQuantity: undefined,
      cardCostLabel: undefined,
      userManualCost: undefined,
      userManualCostQuantity: undefined,
      userManualCostLabel: undefined,
      additionalCosts: [],
      sellingPrice: undefined,
      category: 'other',
      length: undefined,
      width: undefined,
      height: undefined,
      weight: undefined,
      masterCartonLength: undefined,
      masterCartonWidth: undefined,
      masterCartonHeight: undefined,
      masterCartonUnits: undefined,
      masterCartonWeight: undefined,
      marketingTacos: 0,
      marketingTacosPercentage: 15,
      marketingAffiliatePercentage: 5,
      marketingAffiliateDollar: 0,
      marketingAdsPercentage: 7,
      marketingAdsDollar: 0,
      fulfillmentMethod: '100% FBA',
      storageMonths: 1,
      estimatedReturnsPercentage: 5,
      cbmCost: 240,
      shippingToAWD: 240,
      awdCaseReceiveCost: 2.7,
      awdTransportationCost: 1.15,
      amazonFBAStorageFeeNonPeak: 0.78,
      amazonFBAStorageFeePeak: 2.4,
      amazonAWDStorageFee: 0.48,
      amazonFBAAVGFee: 1.185,
      hazmatStorageFeeNonPeak: 0.99,
      hazmatStorageFeePeak: 3.63,
      hazmatOversizeStorageFeeNonPeak: 0.78,
      hazmatOversizeStorageFeePeak: 2.43,
      shopifyRoas: 0,
      shopifyCpa: 0,
      shopifyAgencyPercentage: 8,
      shopifyCreativePercentage: 7,
      shopifyTransactionFeePercentage: 3,
      shopifyReturnsPercentage: 5,
      // Section descriptions (editable by user)
      productInfoDescription: 'Basic product details and SKU selection',
      factoryPriceDescription: 'Manufacturing and packaging costs',
      dimensionsDescription: 'Product physical specifications',
      // Field visibility tracking
      productCostVisible: true,
      retailBoxCostVisible: true,
      cardCostVisible: true,
      userManualCostVisible: true,
      notes: '',
      sippEligibleOverride: true,
      hazmat: false,
      containsBatteries: false,
    }
  ]);
  // Persist and restore app state to avoid data loss on tab switches/reloads
  const STATE_STORAGE_KEY = 'pl_calculator_state_v1';

  // Restore on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STATE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.products) {
          // Migrate existing products
          const migratedProducts = parsed.products.map((product: Product) => {
            const migrated = {
              ...product,
              storageMonths: (product.storageMonths === 3 || product.storageMonths === undefined) ? 1 : product.storageMonths,
              hazmat: product.hazmat ?? false,
              containsBatteries: product.containsBatteries ?? false,
            };
            
            // Migrate cost fields: convert 0 to undefined if both cost and quantity are 0 or empty
            if (migrated.cost === 0 || migrated.cost === null) migrated.cost = undefined;
            if (migrated.costQuantity === 0 || migrated.costQuantity === null) migrated.costQuantity = undefined;
            if (migrated.retailBoxCost === 0 || migrated.retailBoxCost === null) migrated.retailBoxCost = undefined;
            if (migrated.retailBoxCostQuantity === 0 || migrated.retailBoxCostQuantity === null) migrated.retailBoxCostQuantity = undefined;
            if (migrated.cardCost === 0 || migrated.cardCost === null) migrated.cardCost = undefined;
            if (migrated.cardCostQuantity === 0 || migrated.cardCostQuantity === null) migrated.cardCostQuantity = undefined;
            if (migrated.userManualCost === 0 || migrated.userManualCost === null) migrated.userManualCost = undefined;
            if (migrated.userManualCostQuantity === 0 || migrated.userManualCostQuantity === null) migrated.userManualCostQuantity = undefined;
            
            return migrated;
          });
          setProducts(migratedProducts);
        }
        if (typeof parsed.showFeesInput === 'boolean') setShowFeesInput(parsed.showFeesInput);
        if (typeof parsed.showAmazonFBA === 'boolean') setShowAmazonFBA(parsed.showAmazonFBA);
        if (typeof parsed.showAmazonMCF === 'boolean') setShowAmazonMCF(parsed.showAmazonMCF);
        if (typeof parsed.showShopify === 'boolean') setShowShopify(parsed.showShopify);
        
        if (
          parsed.calculatorMode === 'pre-launch' ||
          parsed.calculatorMode === 'legacy' ||
          parsed.calculatorMode === null
        ) {
          setCalculatorMode(parsed.calculatorMode);
        }
      } else {
        // No saved state, show mode selection
        setShowModeDialog(true);
      }
    } catch (e) {
      console.warn('Failed to restore state from localStorage', e);
      setShowModeDialog(true);
    } finally {
      setIsStateLoaded(true);
    }
  }, []);

  // Auto-save on change
  useEffect(() => {
    try {
      const toSave = {
        products,
        showFeesInput,
        showAmazonFBA,
        showAmazonMCF,
        showShopify,
        calculatorMode,
      };
      localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {
      console.warn('Failed to persist state to localStorage', e);
    }
  }, [products, showFeesInput, showAmazonFBA, showAmazonMCF, showShopify, calculatorMode]);

  const updateProduct = useCallback((id: number, field: keyof Product, value: string | number | AdditionalCost[] | boolean | undefined) => {
    setProducts(prev => prev.map(product =>
      product.id === id ? { ...product, [field]: value } : product
    ));
  }, []);

  const batchUpdateProduct = useCallback((id: number, updates: Partial<Product>) => {
    setProducts(prev => prev.map(product =>
      product.id === id ? { ...product, ...updates } : product
    ));
  }, []);

  const removeProduct = useCallback((id: number) => {
    setProducts(prev => prev.length > 1 ? prev.filter(product => product.id !== id) : prev);
  }, []);

  const addProduct = useCallback(() => {
    setProducts(prev => {
      const newId = Math.max(...prev.map(p => p.id)) + 1;
      const seed = prev[0];
      const newProduct: Product = {
        id: newId,
        name: `Product ${newId}`,
        savedVersions: [],
        status: 'Active',
        bucket: undefined,
        sku: '',
        cost: undefined,
        costQuantity: undefined,
        productCostLabel: undefined,
        retailBoxCost: undefined,
        retailBoxCostQuantity: undefined,
        retailBoxCostLabel: undefined,
        cardCost: undefined,
        cardCostQuantity: undefined,
        cardCostLabel: undefined,
        userManualCost: undefined,
        userManualCostQuantity: undefined,
        userManualCostLabel: undefined,
        additionalCosts: [],
        sellingPrice: 0,
        category: 'other',
        length: 0,
        width: 0,
        height: 0,
        weight: 0,
        masterCartonLength: 0,
        masterCartonWidth: 0,
        masterCartonHeight: 0,
        masterCartonUnits: 0,
        masterCartonWeight: 0,
        marketingTacos: 0,
        marketingTacosPercentage: 15,
        marketingAffiliatePercentage: 5,
        marketingAffiliateDollar: 0,
        marketingAdsPercentage: 7,
        marketingAdsDollar: 0,
        fulfillmentMethod: '100% FBA',
        storageMonths: 1,
        estimatedReturnsPercentage: 5,
        cbmCost: seed?.cbmCost || 240,
        shippingToAWD: seed?.shippingToAWD || 240,
        awdCaseReceiveCost: seed?.awdCaseReceiveCost || 2.7,
        awdTransportationCost: seed?.awdTransportationCost || 1.15,
        amazonFBAStorageFeeNonPeak: seed?.amazonFBAStorageFeeNonPeak || 0.78,
        amazonFBAStorageFeePeak: seed?.amazonFBAStorageFeePeak || 2.4,
        amazonAWDStorageFee: seed?.amazonAWDStorageFee || 0.48,
        amazonFBAAVGFee: seed?.amazonFBAAVGFee || 1.185,
        hazmatStorageFeeNonPeak: seed?.hazmatStorageFeeNonPeak || 0.99,
        hazmatStorageFeePeak: seed?.hazmatStorageFeePeak || 3.63,
        hazmatOversizeStorageFeeNonPeak: seed?.hazmatOversizeStorageFeeNonPeak || 0.78,
        hazmatOversizeStorageFeePeak: seed?.hazmatOversizeStorageFeePeak || 2.43,
        shopifyRoas: seed?.shopifyRoas || 0,
        shopifyCpa: seed?.shopifyCpa || 0,
        shopifyAgencyPercentage: seed?.shopifyAgencyPercentage || 8,
        shopifyCreativePercentage: seed?.shopifyCreativePercentage || 7,
        shopifyTransactionFeePercentage: seed?.shopifyTransactionFeePercentage || 3,
        shopifyReturnsPercentage: seed?.shopifyReturnsPercentage || 5,
        productInfoDescription: seed?.productInfoDescription || 'Basic product details and SKU selection',
        factoryPriceDescription: seed?.factoryPriceDescription || 'Manufacturing and packaging costs',
        dimensionsDescription: seed?.dimensionsDescription || 'Product physical specifications',
        productCostVisible: seed?.productCostVisible !== false,
        retailBoxCostVisible: seed?.retailBoxCostVisible !== false,
        cardCostVisible: seed?.cardCostVisible !== false,
        userManualCostVisible: seed?.userManualCostVisible !== false,
        notes: '',
        sippEligibleOverride: true,
        hazmat: false,
        containsBatteries: false,
      };
      return [...prev, newProduct];
    });
  }, []);

  const loadProductVersion = useCallback((productId: number, version: SavedVersion) => {
    setProducts(prev => prev.map(p => {
      if (p.id !== productId) return p;
      return {
        ...version.data,
        id: productId,
        savedVersions: p.savedVersions,
        bucket: version.bucket,
        notes: version.data.notes || '',
        name: version.data.name || `Product ${productId}`,
        status: version.data.status || 'Active',
        sku: version.data.sku || '',
        additionalCosts: Array.isArray(version.data.additionalCosts) ? version.data.additionalCosts : []
      } as Product;
    }));

    toast({
      title: "Version loaded",
      description: `Applied "${version.name}"`,
    });
  }, [toast]);

  const deleteProductVersion = useCallback((productId: number, versionId: string) => {
    setProducts(prev => prev.map(p =>
      p.id === productId
        ? { ...p, savedVersions: p.savedVersions.filter(v => v.id !== versionId) }
        : p
    ));
  }, []);

  const clearProduct = useCallback((productId: number) => {
    setShowModeDialog(true);
    setCalculatorMode(null);

    setProducts(prev => prev.map(product =>
      product.id === productId
        ? {
            ...product,
            name: `Product ${productId}`,
            bucket: undefined,
            sku: '',
            cost: undefined,
            costQuantity: undefined,
            productCostLabel: undefined,
            retailBoxCost: undefined,
            retailBoxCostQuantity: undefined,
            retailBoxCostLabel: undefined,
            cardCost: undefined,
            cardCostQuantity: undefined,
            cardCostLabel: undefined,
            userManualCost: undefined,
            userManualCostQuantity: undefined,
            userManualCostLabel: undefined,
            additionalCosts: [],
            sellingPrice: undefined,
            category: 'other',
            length: undefined,
            width: undefined,
            height: undefined,
            weight: undefined,
            masterCartonLength: undefined,
            masterCartonWidth: undefined,
            masterCartonHeight: undefined,
            masterCartonUnits: undefined,
            masterCartonWeight: undefined,
            marketingTacos: 0,
            marketingTacosPercentage: 15,
            marketingAffiliatePercentage: 5,
            marketingAffiliateDollar: 0,
            marketingAdsPercentage: 7,
            marketingAdsDollar: 0,
            fulfillmentMethod: '100% FBA',
            storageMonths: 1,
            estimatedReturnsPercentage: 5,
            notes: '',
            // Keep global fees + derived shipping/storage values
          }
        : product
    ));

    toast({
      title: "New calculation started",
      description: "Choose your calculator mode to continue",
    });
  }, [toast]);

  const exportToCSV = useCallback(() => {
    const headers = [
      "id","name","status","sku","cost","retailBoxCost","cardCost","userManualCost",
      "additionalCostsTotal","additionalCostsDetails","sellingPrice","category","length","width","height","weight",
      "masterCartonLength","masterCartonWidth","masterCartonHeight","masterCartonUnits","masterCartonWeight",
      "marketingTacos","marketingTacosPercentage","marketingAffiliatePercentage","marketingAffiliateDollar",
      "marketingAdsPercentage","marketingAdsDollar","fulfillmentMethod","storageMonths","estimatedReturnsPercentage",
      "cbmCost","shippingToAWD","awdCaseReceiveCost","awdTransportationCost",
      "amazonFBAStorageFeeNonPeak","amazonFBAStorageFeePeak","amazonAWDStorageFee","amazonFBAAVGFee",
    ];

    const rows = products.map(p => ({
      id: p.id,
      name: p.name,
      status: p.status,
      sku: p.sku,
      cost: p.cost,
      retailBoxCost: p.retailBoxCost,
      cardCost: p.cardCost,
      userManualCost: p.userManualCost,
      additionalCostsTotal: (p.additionalCosts || []).reduce((sum, c) => sum + ((c?.value || 0) * (c?.quantity || 1)), 0),
      additionalCostsDetails: JSON.stringify(p.additionalCosts || []),
      sellingPrice: p.sellingPrice,
      category: p.category,
      length: p.length,
      width: p.width,
      height: p.height,
      weight: p.weight,
      masterCartonLength: p.masterCartonLength,
      masterCartonWidth: p.masterCartonWidth,
      masterCartonHeight: p.masterCartonHeight,
      masterCartonUnits: p.masterCartonUnits,
      masterCartonWeight: p.masterCartonWeight,
      marketingTacos: p.marketingTacos,
      marketingTacosPercentage: p.marketingTacosPercentage,
      marketingAffiliatePercentage: p.marketingAffiliatePercentage,
      marketingAffiliateDollar: p.marketingAffiliateDollar,
      marketingAdsPercentage: p.marketingAdsPercentage,
      marketingAdsDollar: p.marketingAdsDollar,
      fulfillmentMethod: p.fulfillmentMethod,
      storageMonths: p.storageMonths,
      estimatedReturnsPercentage: p.estimatedReturnsPercentage,
      cbmCost: p.cbmCost,
      shippingToAWD: p.shippingToAWD,
      awdCaseReceiveCost: p.awdCaseReceiveCost,
      awdTransportationCost: p.awdTransportationCost,
      amazonFBAStorageFeeNonPeak: p.amazonFBAStorageFeeNonPeak,
      amazonFBAStorageFeePeak: p.amazonFBAStorageFeePeak,
      amazonAWDStorageFee: p.amazonAWDStorageFee,
      amazonFBAAVGFee: p.amazonFBAAVGFee,
    }));

    const escapeVal = (val: any) => {
      if (val === null || val === undefined) return '""';
      const s = String(val).replace(/"/g, '""');
      return `"${s}"`;
    };

    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => escapeVal((r as any)[h])).join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `products_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Exported', description: 'CSV downloaded successfully.' });
  }, [products, toast]);

  // Stable per-field global-fee setter \u2014 used by the Fees Configuration inputs.
  // Trailing comma in the generic disambiguates from JSX in .tsx files.
  const setGlobalFee = useCallback(<K extends keyof Product,>(field: K, value: Product[K]) => {
    setProducts(prev => prev.map(product => ({ ...product, [field]: value })));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-light via-background to-accent-light p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10 animate-enter">
          <div className="flex items-center justify-center mb-6">
            <div className="p-3 rounded-full bg-primary/10 mr-4">
              <Calculator className="w-10 h-10 text-primary" />
            </div>
            <div>
              <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-primary via-accent to-info bg-clip-text text-transparent">
                Sales Channel P&L
              </h1>
              <div className="h-1 w-32 bg-gradient-to-r from-primary to-accent rounded-full mx-auto mt-2"></div>
            </div>
          </div>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto leading-relaxed">
            Calculate your product profits with detailed cost analysis and FBA optimization. 
            Streamline your e-commerce financial planning with precision.
          </p>
        </div>

        {/* Controls */}
        <div className="mb-10">
          <div className="bg-card border border-border rounded-xl p-6 shadow-card">
            <div className="flex flex-col items-center space-y-6">
              {/* Main Configuration Button */}
              <Button
                onClick={() => setShowFeesInput(!showFeesInput)}
                variant={showFeesInput ? "default" : "outline"}
                size="lg"
                className="shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200"
              >
                <Settings className="w-5 h-5 mr-2" />
                Fees Configuration
                {showFeesInput ? <ChevronUp className="w-4 h-4 ml-2" /> : <ChevronDown className="w-4 h-4 ml-2" />}
              </Button>
              
              {/* Channel Analysis Buttons */}
                <div className="flex flex-wrap justify-center gap-4">
                  <Button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowAmazonFBA(!showAmazonFBA);
                    }}
                    variant={showAmazonFBA ? "default" : "outline"}
                    className="shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200"
                  >
                    <Package className="w-4 h-4 mr-2" />
                    Amazon FBA Analysis
                    {showAmazonFBA ? <ChevronUp className="w-4 h-4 ml-2" /> : <ChevronDown className="w-4 h-4 ml-2" />}
                  </Button>
                  <Button
                    onClick={() => setShowAmazonMCF(!showAmazonMCF)}
                    variant={showAmazonMCF ? "success" : "outline"}
                    className="shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200"
                  >
                    <TrendingUp className="w-4 h-4 mr-2" />
                    TikTok Shop Analysis
                    {showAmazonMCF ? <ChevronUp className="w-4 h-4 ml-2" /> : <ChevronDown className="w-4 h-4 ml-2" />}
                  </Button>
                  <Button
                    onClick={() => setShowShopify(!showShopify)}
                    variant={showShopify ? "info" : "outline"}
                    className="shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200"
                  >
                    <Store className="w-4 h-4 mr-2" />
                    Shopify Analysis
                    {showShopify ? <ChevronUp className="w-4 h-4 ml-2" /> : <ChevronDown className="w-4 h-4 ml-2" />}
                  </Button>
                  <Button
                    onClick={exportToCSV}
                    variant="outline"
                    className="shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export CSV
                  </Button>
                </div>
            </div>
          </div>
        </div>

        {/* Fees Input Configuration */}
        {showFeesInput && (
          <Card className="mb-10 shadow-elegant border-border bg-gradient-card">
            <CardHeader className="border-b border-border/50">
              <CardTitle className="text-primary text-xl flex items-center">
                <Settings className="w-6 h-6 mr-3" />
                Fees Configuration
              </CardTitle>
              <p className="text-muted-foreground">Configure your global fees and import SKU data</p>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-4">
                  <div>
                    <Label>CBM Cost to FBA</Label>
                    <Input
                      type="number"
                      value={products[0]?.cbmCost || 240}
                      onChange={(e) => setGlobalFee('cbmCost', parseFloat(e.target.value) || 0)}
                      step="0.01"
                    />
                  </div>
                  <div>
                    <Label>CBM Cost to AWD</Label>
                    <Input
                      type="number"
                      value={products[0]?.shippingToAWD || 240}
                      onChange={(e) => setGlobalFee('shippingToAWD', parseFloat(e.target.value) || 0)}
                      step="0.01"
                    />
                  </div>
                  <div>
                    <Label>AWD Case Receive Cost</Label>
                    <Input
                      type="number"
                      value={products[0]?.awdCaseReceiveCost || 2.7}
                      onChange={(e) => setGlobalFee('awdCaseReceiveCost', parseFloat(e.target.value) || 0)}
                      step="0.01"
                    />
                  </div>
                  <div>
                    <Label>AWD Transportation Cost</Label>
                    <Input
                      type="number"
                      value={products[0]?.awdTransportationCost || 1.15}
                      onChange={(e) => setGlobalFee('awdTransportationCost', parseFloat(e.target.value) || 0)}
                      step="0.01"
                    />
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <Label>Amazon FBA Storage Fee Non Peak (per cbf)</Label>
                    <Input
                      type="number"
                      value={products[0]?.amazonFBAStorageFeeNonPeak || 0.78}
                      onChange={(e) => setGlobalFee('amazonFBAStorageFeeNonPeak', parseFloat(e.target.value) || 0)}
                      step="0.01"
                    />
                  </div>
                  <div>
                    <Label>Amazon FBA Storage Fee Peak (per cbf)</Label>
                    <Input
                      type="number"
                      value={products[0]?.amazonFBAStorageFeePeak || 2.4}
                      onChange={(e) => setGlobalFee('amazonFBAStorageFeePeak', parseFloat(e.target.value) || 0)}
                      step="0.01"
                    />
                  </div>
                  <div>
                    <Label>Amazon AWD Storage Fee (per cbf)</Label>
                    <Input
                      type="number"
                      value={products[0]?.amazonAWDStorageFee || 0.48}
                      onChange={(e) => setGlobalFee('amazonAWDStorageFee', parseFloat(e.target.value) || 0)}
                      step="0.01"
                    />
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <Label>Amazon FBA AVG Fee (per cbf)</Label>
                    <Input
                      type="number"
                      value={Math.round(((products[0]?.amazonFBAStorageFeeNonPeak || 0.78) * 9 + (products[0]?.amazonFBAStorageFeePeak || 2.4) * 3) / 12 * 10000) / 10000}
                      readOnly
                      className="bg-muted"
                      title="Auto-calculated: (Non Peak × 9 + Peak × 3) ÷ 12"
                    />
                  </div>
                  <div>
                    <Label>AWD Receiving Cost (Calculated)</Label>
                    <Input
                      type="number"
                      value={(products[0]?.awdCaseReceiveCost || 2.7) * ((products[0]?.length || 0) * (products[0]?.width || 0) * (products[0]?.height || 0) / 1000000 / 35.315) || 0.11}
                      readOnly
                      className="bg-muted"
                      title="Auto-calculated: AWD Case Receive Cost × CBF"
                    />
                  </div>
                  <div>
                    <Label>AWD Storage Cost (Calculated)</Label>
                    <Input
                      type="number"
                      value={(products[0]?.storageMonths || 3) * (products[0]?.amazonAWDStorageFee || 0.48) * ((products[0]?.length || 0) * (products[0]?.width || 0) * (products[0]?.height || 0) / 1000000 / 35.315) || 0.09}
                      readOnly
                      className="bg-muted"
                      title="Auto-calculated: Storage Months × AWD Storage Fee × CBF"
                    />
                  </div>
                </div>
              </div>
              
              {/* Hazmat Storage Fees Section */}
              <div className="mt-6 pt-6 border-t border-border/50">
                <p className="text-sm font-medium text-primary mb-4">Hazmat Storage Fees (Dangerous Goods)</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <Label>Amazon FBA Hazmat Standard Non Peak (per cbf)</Label>
                    <Input
                      type="number"
                      value={products[0]?.hazmatStorageFeeNonPeak || 0.99}
                      onChange={(e) => setGlobalFee('hazmatStorageFeeNonPeak', parseFloat(e.target.value) || 0)}
                      step="0.01"
                    />
                  </div>
                  <div>
                    <Label>Amazon FBA Hazmat Standard Peak (per cbf)</Label>
                    <Input
                      type="number"
                      value={products[0]?.hazmatStorageFeePeak || 3.63}
                      onChange={(e) => setGlobalFee('hazmatStorageFeePeak', parseFloat(e.target.value) || 0)}
                      step="0.01"
                    />
                  </div>
                  <div>
                    <Label>Amazon FBA Hazmat Standard AVG Fee (per cbf)</Label>
                    <Input
                      type="number"
                      value={Math.round(((products[0]?.hazmatStorageFeeNonPeak || 0.99) * 9 + (products[0]?.hazmatStorageFeePeak || 3.63) * 3) / 12 * 10000) / 10000}
                      readOnly
                      className="bg-muted"
                      title="Auto-calculated: (Non Peak × 9 + Peak × 3) ÷ 12"
                    />
                  </div>
                  <div>
                    <Label>Amazon FBA Hazmat Oversize Non Peak (per cbf)</Label>
                    <Input
                      type="number"
                      value={products[0]?.hazmatOversizeStorageFeeNonPeak || 0.78}
                      onChange={(e) => setGlobalFee('hazmatOversizeStorageFeeNonPeak', parseFloat(e.target.value) || 0)}
                      step="0.01"
                    />
                  </div>
                  <div>
                    <Label>Amazon FBA Hazmat Oversize Peak (per cbf)</Label>
                    <Input
                      type="number"
                      value={products[0]?.hazmatOversizeStorageFeePeak || 2.43}
                      onChange={(e) => setGlobalFee('hazmatOversizeStorageFeePeak', parseFloat(e.target.value) || 0)}
                      step="0.01"
                    />
                  </div>
                  <div>
                    <Label>Amazon FBA Hazmat Oversize AVG Fee (per cbf)</Label>
                    <Input
                      type="number"
                      value={Math.round(((products[0]?.hazmatOversizeStorageFeeNonPeak || 0.78) * 9 + (products[0]?.hazmatOversizeStorageFeePeak || 2.43) * 3) / 12 * 10000) / 10000}
                      readOnly
                      className="bg-muted"
                      title="Auto-calculated: (Non Peak × 9 + Peak × 3) ÷ 12"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Mode Selection Dialog */}
        <AlertDialog open={showModeDialog && calculatorMode === null} onOpenChange={setShowModeDialog}>
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center text-xl">
                <Calculator className="w-6 h-6 mr-3 text-primary" />
                Select Calculator Mode
              </AlertDialogTitle>
              <AlertDialogDescription>
                Choose your calculator mode to customize the available features and validation rules.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-4 py-4">
              <div 
                className={`p-4 border-2 rounded-lg cursor-pointer transition-all hover:border-primary ${
                  calculatorMode === 'pre-launch' ? 'border-primary bg-primary/10' : 'border-border'
                }`}
                onClick={() => setCalculatorMode('pre-launch')}
              >
                <div className="flex items-center mb-2">
                  <Rocket className="w-5 h-5 mr-3 text-accent" />
                  <h3 className="font-semibold">R&D</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  For products in development. Master Carton Final Packing not available.
                </p>
              </div>
              <div 
                className={`p-4 border-2 rounded-lg cursor-pointer transition-all hover:border-primary ${
                  calculatorMode === 'legacy' ? 'border-primary bg-primary/10' : 'border-border'
                }`}
                onClick={() => setCalculatorMode('legacy')}
              >
                <div className="flex items-center mb-2">
                  <Archive className="w-5 h-5 mr-3 text-info" />
                  <h3 className="font-semibold">Live</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  For existing products. SKU selection is mandatory.
                </p>
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogAction 
                disabled={!calculatorMode}
                onClick={() => {
                  setShowModeDialog(false);
                  // Set bucket on the product based on calculator mode
                  const targetProductId = products.find(p => !p.bucket)?.id;
                  if (targetProductId) {
                    const bucket = calculatorMode === 'legacy' ? 'live' : 'rd';
                    updateProduct(targetProductId, 'bucket', bucket);
                  }
                }}
                className="w-full"
              >
                Continue with {calculatorMode === 'pre-launch' ? 'R&D' : 'Live'} Mode
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Products */}
        <div className="space-y-10">
          {products.map((product, index) => (
            <div key={product.id} className="relative animate-enter">
              {index > 0 && (
                <div className="absolute -top-5 left-1/2 transform -translate-x-1/2">
                  <div className="flex items-center">
                    <div className="h-px w-16 bg-gradient-to-r from-transparent to-border"></div>
                    <div className="px-4 py-2 bg-accent/10 rounded-full border border-accent/20">
                      <span className="text-xs font-medium text-accent">Product {index + 1}</span>
                    </div>
                    <div className="h-px w-16 bg-gradient-to-l from-transparent to-border"></div>
                  </div>
                </div>
              )}
              <ProductCard
                product={product}
                updateProduct={updateProduct}
                batchUpdateProduct={batchUpdateProduct}
                removeProduct={removeProduct}
                loadProductVersion={loadProductVersion}
                deleteProductVersion={deleteProductVersion}
                onCreateNewCalculation={clearProduct}
                canRemove={products.length > 1}
                showAmazonFBA={showAmazonFBA}
                showTikTokShop={showAmazonMCF}

                showShopify={showShopify}
                calculatorMode={calculatorMode}
                showSummaryBar={showAmazonFBA !== showAmazonMCF}
              />
            </div>
          ))}
          
        </div>
        
        {/* Floating Calculation Database Button */}
        <FloatingCalculationDatabase
          products={products}
        />
      </div>
    </div>
  );
};

export default Index;