interface SimpleProductData {
  sku: string;
  name: string;
  factoryPriceInputs: number;
  length: number;
  width: number;
  height: number;
  weight: number;
  masterCartonLength: number;
  masterCartonWidth: number;
  masterCartonHeight: number;
  masterCartonUnits: number;
  masterCartonWeight: number;
}

interface SimpleSkuSelectorProps {
  onSKUSelect: (productData: SimpleProductData) => void;
}

export const SimpleSkuSelector = ({ onSKUSelect }: SimpleSkuSelectorProps) => {
  return null;
};