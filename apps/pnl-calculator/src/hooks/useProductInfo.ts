import { useState, useEffect } from 'react';
import { supabase } from "@/lib/supabase";
import { useToast } from "@platform/ui";

interface ProductInfo {
  SKU: string;
  'Product Name': string | null;
  Category: string | null;
  Supplier: string | null;
  'Units/carton': number | null;
  'Product box Length': string | null;
  'Product box Width': number | null;
  'Product box Height': number | null;
  'Product box weight (kg)': number | null;
  'Carton Width': number | null;
  'Carton Height': number | null;
  'Carton weight': number | null;
  'Carton Length': string | null;
  ASIN: string | null;
}

export const useProductInfo = () => {
  const [productInfoList, setProductInfoList] = useState<ProductInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const loadProductInfo = async () => {
    try {
      setLoading(true);
      console.log('Loading product info from Supabase...');
      
      // Use exact column names from the database
      const { data, error } = await supabase
        .from('Product Information')
        .select('SKU, "Product Name", Category, Supplier, "Units/carton", "Product box Length", "Product box Width", "Product box Height", "Product box weight (kg)", "Carton Width", "Carton Height", "Carton weight", "Carton Length", ASIN')
        .order('SKU', { ascending: true });

      console.log('Supabase response:', { data, error });

      if (error) {
        console.error('Supabase query error:', error);
        throw error;
      }

      if (data && Array.isArray(data)) {
        console.log(`Loaded ${data.length} products from Supabase`);
        setProductInfoList(data as unknown as ProductInfo[]);
      } else {
        console.log('No data returned from Supabase');
        setProductInfoList([]);
      }
    } catch (error) {
      console.error('Error loading product info:', error);
      toast({
        title: "Error",
        description: "Failed to load product information",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const getProductBySKU = (sku: string): ProductInfo | undefined => {
    return productInfoList.find(product => product.SKU === sku);
  };

  useEffect(() => {
    loadProductInfo();
  }, []);

  return {
    productInfoList,
    loading,
    getProductBySKU,
    refreshProductInfo: loadProductInfo
  };
};