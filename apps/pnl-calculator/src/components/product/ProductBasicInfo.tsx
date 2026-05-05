"use client";

import React, { memo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { Input } from "@platform/ui";
import { Label } from "@platform/ui";
import { Textarea } from "@platform/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@platform/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@platform/ui";
import { Button } from "@platform/ui";
import { Check, ChevronsUpDown, Info } from 'lucide-react';
import { Checkbox } from "@platform/ui";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@platform/ui";
import type { Product } from '@/types/product';

interface ProductBasicInfoProps {
  product: Product;
  updateProduct: (id: number, field: keyof Product, value: string | number | boolean) => void;
  categories: string[];
  productInfoList: any[];
  skuPopoverOpen: boolean;
  setSkuPopoverOpen: (open: boolean) => void;
  onSKUChange: (sku: string) => void;
  calculatorMode?: 'pre-launch' | 'legacy' | null;
  getFieldValidationClass: (field: 'sku' | 'sellingPrice' | 'category') => string;
}

const ProductBasicInfo = memo<ProductBasicInfoProps>(({
  product,
  updateProduct,
  categories,
  productInfoList,
  skuPopoverOpen,
  setSkuPopoverOpen,
  onSKUChange,
  calculatorMode,
  getFieldValidationClass,
}) => {
  console.log('ProductBasicInfo - Product name:', product.name, 'Bucket value:', product.bucket, 'Bucket type:', typeof product.bucket, 'SKU will show:', product.bucket !== 'rd');
  
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Info className="h-5 w-5" />
          {product.productInfoDescription || 'Product Information'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Product Name */}
          <div>
            <Label htmlFor={`name-${product.id}`} className="text-sm font-medium">
              Product Name *
            </Label>
            <Input
              id={`name-${product.id}`}
              type="text"
              value={product.name}
              onChange={(e) => updateProduct(product.id, 'name', e.target.value)}
              placeholder="Enter product name"
              aria-describedby={`name-help-${product.id}`}
              required
            />
            <p id={`name-help-${product.id}`} className="sr-only">
              Enter the full product name for identification
            </p>
          </div>

          {/* SKU Field - Hide only for R&D versions */}
          {product.bucket !== 'rd' && (
            <div>
              <Label htmlFor={`sku-${product.id}`} className="text-sm font-medium">
                SKU *
              </Label>
              <Popover open={skuPopoverOpen} onOpenChange={setSkuPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id={`sku-${product.id}`}
                    variant="outline"
                    role="combobox"
                    aria-expanded={skuPopoverOpen}
                    aria-haspopup="listbox"
                    className={`w-full justify-between ${getFieldValidationClass('sku')}`}
                  >
                    {product.sku || "Select or enter SKU..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0 z-50 bg-popover" align="start">
                  <div className="flex flex-col">
                    <Command
                      filter={(value, search) => {
                        if (!search) return 1;
                        const v = (value ?? '').toString().toLowerCase();
                        const s = search.toLowerCase();
                        return v.includes(s) ? 1 : 0;
                      }}
                    >
                      <CommandInput
                        placeholder="Search or type custom SKU..."
                        value={product.sku || ''}
                        onValueChange={(value) => {
                          // Allow free typing even if it doesn't match existing SKUs
                          onSKUChange(value);
                        }}
                      />
                      <CommandList>
                        <CommandEmpty>
                          <div className="p-2 text-sm text-muted-foreground flex flex-col gap-2">
                            <span>No SKU found.</span>
                            {(product.sku || '').trim() && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full justify-start"
                                onClick={() => {
                                  const value = (product.sku || '').trim();
                                  if (value) {
                                    onSKUChange(value);
                                    setSkuPopoverOpen(false);
                                  }
                                }}
                              >
                                Use &quot;{(product.sku || '').trim()}&quot; as new SKU
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full justify-start"
                              onClick={() => {
                                onSKUChange('');
                                setSkuPopoverOpen(false);
                              }}
                            >
                              Not Assigned
                            </Button>
                          </div>
                        </CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="not-assigned"
                            onSelect={() => {
                              onSKUChange('');
                              setSkuPopoverOpen(false);
                            }}
                          >
                            <Check
                              className={`mr-2 h-4 w-4 ${
                                !product.sku ? "opacity-100" : "opacity-0"
                              }`}
                            />
                            Not Assigned
                          </CommandItem>
                          {productInfoList.map((info) => (
                            <CommandItem
                              key={info.sku}
                              value={info.sku}
                              onSelect={() => {
                                onSKUChange(info.sku);
                                setSkuPopoverOpen(false);
                              }}
                            >
                              <Check
                                className={`mr-2 h-4 w-4 ${
                                  product.sku === info.sku ? "opacity-100" : "opacity-0"
                                }`}
                              />
                              {info.sku} - {info['Product Name']}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>

                    <div className="border-t p-3 bg-muted/30" onKeyDown={(e) => e.stopPropagation()}>
                      <Label htmlFor={`manual-sku-${product.id}`} className="text-xs text-muted-foreground mb-1.5 block">
                        Manual SKU Entry
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id={`manual-sku-${product.id}`}
                          placeholder="Enter custom SKU"
                          className="h-8 text-sm"
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                              const value = e.currentTarget.value.trim();
                              if (value) {
                                onSKUChange(value);
                                setSkuPopoverOpen(false);
                              }
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          className="h-8"
                          onClick={(e) => {
                            const input = e.currentTarget.parentElement?.querySelector('input');
                            const value = input?.value.trim();
                            if (value) {
                              onSKUChange(value);
                              setSkuPopoverOpen(false);
                            }
                          }}
                        >
                          Set
                        </Button>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="flex items-center px-3 py-2 text-sm text-left border-t bg-background hover:bg-accent"
                      onClick={() => {
                        onSKUChange('');
                        setSkuPopoverOpen(false);
                      }}
                    >
                      <Check
                        className={`mr-2 h-4 w-4 ${
                          !product.sku ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      Not Assigned
                    </button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Selling Price */}
          <div>
            <Label htmlFor={`selling-price-${product.id}`} className="text-sm font-medium">
              Selling Price * ($)
            </Label>
            <Input
              id={`selling-price-${product.id}`}
              type="number"
              value={product.sellingPrice ?? ''}
              onChange={(e) => updateProduct(product.id, 'sellingPrice', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
              placeholder="0.00"
              step="0.01"
              min="0"
              className={getFieldValidationClass('sellingPrice')}
              aria-describedby={`selling-price-help-${product.id}`}
              required
            />
            <p id={`selling-price-help-${product.id}`} className="sr-only">
              Enter the selling price in USD
            </p>
          </div>

          {/* Category */}
          <div>
            <Label htmlFor={`category-${product.id}`} className="text-sm font-medium">
              Category *
            </Label>
            <Select
              value={product.category || ''}
              onValueChange={(value) => updateProduct(product.id, 'category', value)}
              required
            >
              <SelectTrigger 
                id={`category-${product.id}`}
                className={getFieldValidationClass('category')}
                aria-describedby={`category-help-${product.id}`}
              >
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id={`category-help-${product.id}`} className="sr-only">
              Select the product category for accurate fee calculations
            </p>
          </div>
        </div>

        {/* Hazmat Checkbox */}
        <div className="flex items-center gap-4 mt-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id={`hazmat-${product.id}`}
              checked={product.hazmat || false}
              onCheckedChange={(checked) => updateProduct(product.id, 'hazmat', checked as boolean)}
            />
            <Label htmlFor={`hazmat-${product.id}`} className="text-sm font-medium cursor-pointer">
              Hazmat (Dangerous Goods)
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`batteries-${product.id}`}
              checked={product.containsBatteries || false}
              onCheckedChange={(checked) => updateProduct(product.id, 'containsBatteries', checked as boolean)}
            />
            <Label htmlFor={`batteries-${product.id}`} className="text-sm font-medium cursor-pointer">
              Contains Batteries
            </Label>
          </div>
        </div>

        {/* Notes Section */}
        <div className="mt-4">
          <Label htmlFor={`notes-${product.id}`} className="text-sm font-medium">
            Notes
          </Label>
          <Textarea
            id={`notes-${product.id}`}
            value={product.notes || ''}
            onChange={(e) => updateProduct(product.id, 'notes', e.target.value)}
            placeholder="Add any notes about this product..."
            className="mt-2 min-h-[80px]"
            aria-describedby={`notes-help-${product.id}`}
          />
          <p id={`notes-help-${product.id}`} className="sr-only">
            Optional notes field for additional product information
          </p>
        </div>
      </CardContent>
    </Card>
  );
});

ProductBasicInfo.displayName = 'ProductBasicInfo';

export default ProductBasicInfo;