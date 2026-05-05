"use client";

import React, { memo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { Input } from "@platform/ui";
import { Label } from "@platform/ui";
import { Package } from 'lucide-react';
import type { Product } from '@/types/product';

interface ProductMasterCartonProps {
  product: Product;
  updateProduct: (id: number, field: keyof Product, value: string | number) => void;
  isMasterCartonComplete: boolean;
}

const ProductMasterCarton = memo<ProductMasterCartonProps>(({
  product,
  updateProduct,
  isMasterCartonComplete,
}) => {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          Master Carton Final Packing
          {isMasterCartonComplete && (
            <span className="ml-2 px-2 py-1 bg-success/10 text-success text-xs rounded-full">
              Complete
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <fieldset>
          <legend className="sr-only">Master carton specifications</legend>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {/* Master Carton Length */}
            <div>
              <Label htmlFor={`mc-length-${product.id}`} className="text-sm font-medium">
                Length (cm)
              </Label>
              <Input
                id={`mc-length-${product.id}`}
                type="number"
                value={product.masterCartonLength ?? ''}
                onChange={(e) => updateProduct(product.id, 'masterCartonLength', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                placeholder="0"
                step="0.1"
                min="0"
                aria-describedby={`mc-length-help-${product.id}`}
              />
              <p id={`mc-length-help-${product.id}`} className="sr-only">
                Enter master carton length in centimeters
              </p>
            </div>

            {/* Master Carton Width */}
            <div>
              <Label htmlFor={`mc-width-${product.id}`} className="text-sm font-medium">
                Width (cm)
              </Label>
              <Input
                id={`mc-width-${product.id}`}
                type="number"
                value={product.masterCartonWidth ?? ''}
                onChange={(e) => updateProduct(product.id, 'masterCartonWidth', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                placeholder="0"
                step="0.1"
                min="0"
                aria-describedby={`mc-width-help-${product.id}`}
              />
              <p id={`mc-width-help-${product.id}`} className="sr-only">
                Enter master carton width in centimeters
              </p>
            </div>

            {/* Master Carton Height */}
            <div>
              <Label htmlFor={`mc-height-${product.id}`} className="text-sm font-medium">
                Height (cm)
              </Label>
              <Input
                id={`mc-height-${product.id}`}
                type="number"
                value={product.masterCartonHeight ?? ''}
                onChange={(e) => updateProduct(product.id, 'masterCartonHeight', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                placeholder="0"
                step="0.1"
                min="0"
                aria-describedby={`mc-height-help-${product.id}`}
              />
              <p id={`mc-height-help-${product.id}`} className="sr-only">
                Enter master carton height in centimeters
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Master Carton Units */}
            <div>
              <Label htmlFor={`mc-units-${product.id}`} className="text-sm font-medium">
                Units per Carton
              </Label>
              <Input
                id={`mc-units-${product.id}`}
                type="number"
                value={product.masterCartonUnits ?? ''}
                onChange={(e) => updateProduct(product.id, 'masterCartonUnits', e.target.value === '' ? undefined : parseInt(e.target.value) || 0)}
                placeholder="0"
                min="1"
                step="1"
                aria-describedby={`mc-units-help-${product.id}`}
              />
              <p id={`mc-units-help-${product.id}`} className="sr-only">
                Enter the number of units that fit in one master carton
              </p>
            </div>

            {/* Master Carton Weight */}
            <div>
              <Label htmlFor={`mc-weight-${product.id}`} className="text-sm font-medium">
                Total Weight (kg)
              </Label>
              <Input
                id={`mc-weight-${product.id}`}
                type="number"
                value={product.masterCartonWeight ?? ''}
                onChange={(e) => updateProduct(product.id, 'masterCartonWeight', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                placeholder="0"
                step="0.01"
                min="0"
                aria-describedby={`mc-weight-help-${product.id}`}
              />
              <p id={`mc-weight-help-${product.id}`} className="sr-only">
                Enter the total weight of the master carton including all units
              </p>
            </div>
          </div>
        </fieldset>

        {/* Calculated values display */}
        {isMasterCartonComplete && (
          <div className="mt-4 p-4 bg-muted rounded-lg">
            <h4 className="font-medium mb-2">Calculated Values:</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">CBM per Unit:</span>
                <span className="ml-2 font-mono">
                  {(((product.masterCartonLength ?? 0) * (product.masterCartonWidth ?? 0) * (product.masterCartonHeight ?? 0)) / 1000000 / (product.masterCartonUnits ?? 1)).toFixed(6)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Weight per Unit:</span>
                <span className="ml-2 font-mono">
                  {((product.masterCartonWeight ?? 0) / (product.masterCartonUnits ?? 1)).toFixed(3)} kg
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

ProductMasterCarton.displayName = 'ProductMasterCarton';

export default ProductMasterCarton;