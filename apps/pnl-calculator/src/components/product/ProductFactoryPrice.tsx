"use client";

import React, { memo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { Input } from "@platform/ui";
import { Label } from "@platform/ui";
import { Button } from "@platform/ui";
import { Plus, X, DollarSign } from 'lucide-react';
import type { Product, AdditionalCost } from '@/types/product';

interface ProductFactoryPriceProps {
  product: Product;
  updateProduct: (id: number, field: keyof Product, value: string | number | boolean | AdditionalCost[] | undefined) => void;
  batchUpdateProduct: (id: number, updates: Partial<Product>) => void;
  additionalCostsTotal: number;
  addAdditionalCost: () => void;
  updateAdditionalCost: (costId: string, field: 'name' | 'value' | 'quantity', value: string | number) => void;
  removeAdditionalCost: (costId: string) => void;
}

const ProductFactoryPrice = memo<ProductFactoryPriceProps>(({
  product,
  updateProduct,
  batchUpdateProduct,
  additionalCostsTotal,
  addAdditionalCost,
  updateAdditionalCost,
  removeAdditionalCost,
}) => {
  const totalCost = 
    (product.cost ?? 0) * (product.costQuantity ?? 1) +
    (product.retailBoxCost ?? 0) * (product.retailBoxCostQuantity ?? 1) +
    (product.cardCost ?? 0) * (product.cardCostQuantity ?? 1) +
    (product.userManualCost ?? 0) * (product.userManualCostQuantity ?? 1) +
    product.additionalCosts.reduce((sum, cost) => sum + ((cost.value ?? 0) * (cost.quantity ?? 1)), 0);

  return (
    <Card className="overflow-hidden bg-gradient-to-br from-emerald-50/80 to-green-50/80 border-2 border-emerald-200/60 shadow-lg hover:shadow-xl transition-all duration-300">
      <CardHeader className="pb-4 bg-gradient-to-r from-emerald-500/10 to-green-500/10 border-b border-emerald-200/30">
        <CardTitle className="text-xl font-semibold text-emerald-800 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/15 shadow-sm">
            <DollarSign className="w-6 h-6 text-emerald-600" />
          </div>
          {product.factoryPriceDescription || 'Manufacturing and packaging costs'}
        </CardTitle>
        <p className="text-sm text-emerald-600/70 font-medium">
          {product.factoryPriceDescription || "Cost breakdown and quantity calculations"}
        </p>
      </CardHeader>
      <CardContent className="p-6 space-y-5">
        {/* Product Cost */}
        {(product.cost !== undefined || product.costQuantity !== undefined || product.productCostLabel !== undefined) && (
          <div className="p-4 bg-white/60 border border-emerald-200/40 rounded-xl hover:bg-white/80 transition-colors">
            <div className="grid grid-cols-12 gap-3 items-end">
              <div className="col-span-3">
                <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                  Cost Name
                </Label>
                <Input
                  value={product.productCostLabel ?? 'Product Cost'}
                  onChange={(e) => updateProduct(product.id, 'productCostLabel', e.target.value)}
                  placeholder="e.g., Product Cost"
                  className="h-10 border-2 hover:border-emerald-300 focus:border-emerald-500 transition-colors"
                />
              </div>
              <div className="col-span-2">
                <Label className="text-sm font-semibold text-gray-700 mb-2 block">Cost ($)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    value={product.cost ?? ''}
                    onChange={(e) => updateProduct(product.id, 'cost', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                    step="0.01"
                    placeholder="0.00"
                    className="h-10 pl-6 border-2 hover:border-emerald-300 focus:border-emerald-500 transition-colors"
                  />
                  <DollarSign className="absolute left-1.5 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-400" />
                </div>
              </div>
              <div className="col-span-2">
                <Label className="text-sm font-semibold text-gray-700 mb-2 block">Quantity</Label>
                <Input
                  type="number"
                  value={product.costQuantity ?? ''}
                  onChange={(e) => updateProduct(product.id, 'costQuantity', e.target.value === '' ? undefined : (parseFloat(e.target.value) || 0))}
                  placeholder="0"
                  step="1"
                  min="0"
                  className="h-10 border-2 hover:border-emerald-300 focus:border-emerald-500 transition-colors"
                />
              </div>
              <div className="col-span-3">
                <Label className="text-sm font-semibold text-gray-700 mb-2 block">Total</Label>
                <div className="h-10 px-3 bg-emerald-50 border-2 border-emerald-200 rounded-md flex items-center">
                  <span className="font-bold text-emerald-800">
                    ${((product.cost ?? 0) * (product.costQuantity ?? 1)).toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="col-span-2 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    batchUpdateProduct(product.id, {
                      cost: undefined,
                      costQuantity: undefined,
                      productCostLabel: undefined
                    });
                  }}
                  className="h-10 text-red-600 hover:text-red-700 border-red-200 hover:bg-red-50 hover:border-red-300 transition-all duration-200"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Retail Box Cost */}
        {(product.retailBoxCost !== undefined || product.retailBoxCostQuantity !== undefined || product.retailBoxCostLabel !== undefined) && (
          <div className="p-4 bg-white/60 border border-emerald-200/40 rounded-xl hover:bg-white/80 transition-colors">
            <div className="grid grid-cols-12 gap-3 items-end">
              <div className="col-span-3">
                <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                  Cost Name
                </Label>
                <Input
                  value={product.retailBoxCostLabel ?? 'Retail Box Cost'}
                  onChange={(e) => updateProduct(product.id, 'retailBoxCostLabel', e.target.value)}
                  placeholder="e.g., Retail Box Cost"
                  className="h-10 border-2 hover:border-emerald-300 focus:border-emerald-500 transition-colors"
                />
              </div>
              <div className="col-span-2">
                <Label className="text-sm font-semibold text-gray-700 mb-2 block">Cost ($)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    value={product.retailBoxCost ?? ''}
                    onChange={(e) => updateProduct(product.id, 'retailBoxCost', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                    step="0.01"
                    placeholder="0.00"
                    className="h-10 pl-6 border-2 hover:border-emerald-300 focus:border-emerald-500 transition-colors"
                  />
                  <DollarSign className="absolute left-1.5 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-400" />
                </div>
              </div>
              <div className="col-span-2">
                <Label className="text-sm font-semibold text-gray-700 mb-2 block">Quantity</Label>
                <Input
                  type="number"
                  value={product.retailBoxCostQuantity ?? ''}
                  onChange={(e) => updateProduct(product.id, 'retailBoxCostQuantity', e.target.value === '' ? undefined : (parseFloat(e.target.value) || 0))}
                  placeholder="0"
                  step="1"
                  min="0"
                  className="h-10 border-2 hover:border-emerald-300 focus:border-emerald-500 transition-colors"
                />
              </div>
              <div className="col-span-3">
                <Label className="text-sm font-semibold text-gray-700 mb-2 block">Total</Label>
                <div className="h-10 px-3 bg-emerald-50 border-2 border-emerald-200 rounded-md flex items-center">
                  <span className="font-bold text-emerald-800">
                    ${((product.retailBoxCost ?? 0) * (product.retailBoxCostQuantity ?? 1)).toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="col-span-2 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    batchUpdateProduct(product.id, {
                      retailBoxCost: undefined,
                      retailBoxCostQuantity: undefined,
                      retailBoxCostLabel: undefined
                    });
                  }}
                  className="h-10 text-red-600 hover:text-red-700 border-red-200 hover:bg-red-50 hover:border-red-300 transition-all duration-200"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Card Cost */}
        {(product.cardCost !== undefined || product.cardCostQuantity !== undefined || product.cardCostLabel !== undefined) && (
          <div className="p-4 bg-white/60 border border-emerald-200/40 rounded-xl hover:bg-white/80 transition-colors">
            <div className="grid grid-cols-12 gap-3 items-end">
              <div className="col-span-3">
                <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                  Cost Name
                </Label>
                <Input
                  value={product.cardCostLabel ?? 'Card Cost'}
                  onChange={(e) => updateProduct(product.id, 'cardCostLabel', e.target.value)}
                  placeholder="e.g., Card Cost"
                  className="h-10 border-2 hover:border-emerald-300 focus:border-emerald-500 transition-colors"
                />
              </div>
              <div className="col-span-2">
                <Label className="text-sm font-semibold text-gray-700 mb-2 block">Cost ($)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    value={product.cardCost ?? ''}
                    onChange={(e) => updateProduct(product.id, 'cardCost', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                    step="0.01"
                    placeholder="0.00"
                    className="h-10 pl-6 border-2 hover:border-emerald-300 focus:border-emerald-500 transition-colors"
                  />
                  <DollarSign className="absolute left-1.5 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-400" />
                </div>
              </div>
              <div className="col-span-2">
                <Label className="text-sm font-semibold text-gray-700 mb-2 block">Quantity</Label>
                <Input
                  type="number"
                  value={product.cardCostQuantity ?? ''}
                  onChange={(e) => updateProduct(product.id, 'cardCostQuantity', e.target.value === '' ? undefined : (parseFloat(e.target.value) || 0))}
                  placeholder="0"
                  step="1"
                  min="0"
                  className="h-10 border-2 hover:border-emerald-300 focus:border-emerald-500 transition-colors"
                />
              </div>
              <div className="col-span-3">
                <Label className="text-sm font-semibold text-gray-700 mb-2 block">Total</Label>
                <div className="h-10 px-3 bg-emerald-50 border-2 border-emerald-200 rounded-md flex items-center">
                  <span className="font-bold text-emerald-800">
                    ${((product.cardCost ?? 0) * (product.cardCostQuantity ?? 1)).toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="col-span-2 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    batchUpdateProduct(product.id, {
                      cardCost: undefined,
                      cardCostQuantity: undefined,
                      cardCostLabel: undefined
                    });
                  }}
                  className="h-10 text-red-600 hover:text-red-700 border-red-200 hover:bg-red-50 hover:border-red-300 transition-all duration-200"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* User Manual Cost */}
        {(product.userManualCost !== undefined || product.userManualCostQuantity !== undefined || product.userManualCostLabel !== undefined) && (
          <div className="p-4 bg-white/60 border border-emerald-200/40 rounded-xl hover:bg-white/80 transition-colors">
            <div className="grid grid-cols-12 gap-3 items-end">
              <div className="col-span-3">
                <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                  Cost Name
                </Label>
                <Input
                  value={product.userManualCostLabel ?? 'User Manual Cost'}
                  onChange={(e) => updateProduct(product.id, 'userManualCostLabel', e.target.value)}
                  placeholder="e.g., User Manual Cost"
                  className="h-10 border-2 hover:border-emerald-300 focus:border-emerald-500 transition-colors"
                />
              </div>
              <div className="col-span-2">
                <Label className="text-sm font-semibold text-gray-700 mb-2 block">Cost ($)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    value={product.userManualCost ?? ''}
                    onChange={(e) => updateProduct(product.id, 'userManualCost', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                    step="0.01"
                    placeholder="0.00"
                    className="h-10 pl-6 border-2 hover:border-emerald-300 focus:border-emerald-500 transition-colors"
                  />
                  <DollarSign className="absolute left-1.5 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-400" />
                </div>
              </div>
              <div className="col-span-2">
                <Label className="text-sm font-semibold text-gray-700 mb-2 block">Quantity</Label>
                <Input
                  type="number"
                  value={product.userManualCostQuantity ?? ''}
                  onChange={(e) => updateProduct(product.id, 'userManualCostQuantity', e.target.value === '' ? undefined : (parseFloat(e.target.value) || 0))}
                  placeholder="0"
                  step="1"
                  min="0"
                  className="h-10 border-2 hover:border-emerald-300 focus:border-emerald-500 transition-colors"
                />
              </div>
              <div className="col-span-3">
                <Label className="text-sm font-semibold text-gray-700 mb-2 block">Total</Label>
                <div className="h-10 px-3 bg-emerald-50 border-2 border-emerald-200 rounded-md flex items-center">
                  <span className="font-bold text-emerald-800">
                    ${((product.userManualCost ?? 0) * (product.userManualCostQuantity ?? 1)).toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="col-span-2 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    batchUpdateProduct(product.id, {
                      userManualCost: undefined,
                      userManualCostQuantity: undefined,
                      userManualCostLabel: undefined
                    });
                  }}
                  className="h-10 text-red-600 hover:text-red-700 border-red-200 hover:bg-red-50 hover:border-red-300 transition-all duration-200"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
        
        {/* Additional Cost Fields */}
        {product.additionalCosts.map((additionalCost) => (
          <div key={additionalCost.id} className="p-4 bg-white/60 border border-emerald-200/40 rounded-xl hover:bg-white/80 transition-colors">
            <div className="grid grid-cols-12 gap-3 items-end">
              <div className="col-span-3">
                <Label className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                  Cost Name
                </Label>
                <Input
                  value={additionalCost.name}
                  onChange={(e) => updateAdditionalCost(additionalCost.id, 'name', e.target.value)}
                  placeholder="e.g., Packaging Cost"
                  className="h-10 border-2 hover:border-emerald-300 focus:border-emerald-500 transition-colors"
                />
              </div>
              <div className="col-span-2">
                <Label className="text-sm font-semibold text-gray-700 mb-2 block">Cost ($)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    value={additionalCost.value ?? ''}
                    onChange={(e) => updateAdditionalCost(additionalCost.id, 'value', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                    step="0.01"
                    placeholder="0.00"
                    className="h-10 pl-6 border-2 hover:border-emerald-300 focus:border-emerald-500 transition-colors"
                  />
                  <DollarSign className="absolute left-1.5 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-400" />
                </div>
              </div>
              <div className="col-span-2">
                <Label className="text-sm font-semibold text-gray-700 mb-2 block">Quantity</Label>
                <Input
                  type="number"
                  value={additionalCost.quantity ?? ''}
                  onChange={(e) => updateAdditionalCost(additionalCost.id, 'quantity', e.target.value === '' ? undefined : (parseFloat(e.target.value) || 0))}
                  placeholder="0"
                  step="1"
                  min="0"
                  className="h-10 border-2 hover:border-emerald-300 focus:border-emerald-500 transition-colors"
                />
              </div>
              <div className="col-span-3">
                <Label className="text-sm font-semibold text-gray-700 mb-2 block">Total</Label>
                <div className="h-10 px-3 bg-emerald-50 border-2 border-emerald-200 rounded-md flex items-center">
                  <span className="font-bold text-emerald-800">
                    ${((additionalCost.value ?? 0) * (additionalCost.quantity ?? 1)).toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="col-span-2 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => removeAdditionalCost(additionalCost.id)}
                  className="h-10 text-red-600 hover:text-red-700 border-red-200 hover:bg-red-50 hover:border-red-300 transition-all duration-200"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
        
        {/* Add Additional Cost Button */}
        <div className="pt-2">
          <Button
            variant="outline"
            size="lg"
            onClick={addAdditionalCost}
            className="w-full h-12 border-2 border-dashed border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 hover:border-emerald-400 transition-all duration-200 font-semibold"
          >
            <Plus className="w-5 h-5 mr-2" />
            ✨ Add Additional Cost
          </Button>
        </div>

        {/* Total Cost Display */}
        <div className="mt-6 p-5 bg-gradient-to-r from-emerald-500/10 to-green-500/10 border-2 border-emerald-300 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-lg font-bold text-emerald-800 flex items-center gap-2">
              💰 Total Manufacturing Cost:
            </span>
            <span className="text-2xl font-black text-emerald-900" aria-live="polite">
              ${totalCost.toFixed(2)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

ProductFactoryPrice.displayName = 'ProductFactoryPrice';

export default ProductFactoryPrice;