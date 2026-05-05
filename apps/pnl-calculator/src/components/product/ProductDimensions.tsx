"use client";

import React, { memo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { Input } from "@platform/ui";
import { Label } from "@platform/ui";
import { Package } from 'lucide-react';
import type { Product } from '@/types/product';

interface ProductDimensionsProps {
  product: Product;
  updateProduct: (id: number, field: keyof Product, value: string | number) => void;
}

const ProductDimensions = memo<ProductDimensionsProps>(({
  product,
  updateProduct,
}) => {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          {product.dimensionsDescription || 'Product Dimensions'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <fieldset>
          <legend className="sr-only">Product physical dimensions</legend>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Length */}
            <div>
              <Label htmlFor={`length-${product.id}`} className="text-sm font-medium">
                Length (cm)
              </Label>
              <Input
                id={`length-${product.id}`}
                type="number"
                value={product.length ?? ''}
                onChange={(e) => updateProduct(product.id, 'length', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                placeholder="0"
                step="0.1"
                min="0"
                aria-describedby={`length-help-${product.id}`}
              />
              <p id={`length-help-${product.id}`} className="sr-only">
                Enter product length in centimeters
              </p>
            </div>

            {/* Width */}
            <div>
              <Label htmlFor={`width-${product.id}`} className="text-sm font-medium">
                Width (cm)
              </Label>
              <Input
                id={`width-${product.id}`}
                type="number"
                value={product.width ?? ''}
                onChange={(e) => updateProduct(product.id, 'width', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                placeholder="0"
                step="0.1"
                min="0"
                aria-describedby={`width-help-${product.id}`}
              />
              <p id={`width-help-${product.id}`} className="sr-only">
                Enter product width in centimeters
              </p>
            </div>

            {/* Height */}
            <div>
              <Label htmlFor={`height-${product.id}`} className="text-sm font-medium">
                Height (cm)
              </Label>
              <Input
                id={`height-${product.id}`}
                type="number"
                value={product.height ?? ''}
                onChange={(e) => updateProduct(product.id, 'height', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                placeholder="0"
                step="0.1"
                min="0"
                aria-describedBy={`height-help-${product.id}`}
              />
              <p id={`height-help-${product.id}`} className="sr-only">
                Enter product height in centimeters
              </p>
            </div>

            {/* Weight */}
            <div>
              <Label htmlFor={`weight-${product.id}`} className="text-sm font-medium">
                Weight (kg)
              </Label>
              <Input
                id={`weight-${product.id}`}
                type="number"
                value={product.weight ?? ''}
                onChange={(e) => updateProduct(product.id, 'weight', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                placeholder="0"
                step="0.01"
                min="0"
                aria-describedby={`weight-help-${product.id}`}
              />
              <p id={`weight-help-${product.id}`} className="sr-only">
                Enter product weight in kilograms
              </p>
            </div>
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
});

ProductDimensions.displayName = 'ProductDimensions';

export default ProductDimensions;