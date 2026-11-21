import { useState, useEffect } from 'react';
import { supabase } from "@/lib/supabase";
import { useToast } from "@platform/ui";
import { mergeLibraryProducts, type ProductInfoLike } from "@/lib/product-library";
import { fetchLibraryProducts } from "@/lib/product-library-client";

// The P&L's own `Product Information` rows plus every non-archived Product
// Library product that table lacks.
type ProductInfo = ProductInfoLike;

export const useProductInfo = () => {
  const [productInfoList, setProductInfoList] = useState<ProductInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const loadProductInfo = async () => {
    try {
      setLoading(true);
      console.log('Loading product info from Supabase...');
      
      // Use exact column names from the database
      const [{ data, error }, library] = await Promise.all([
        supabase
          .from('Product Information')
          .select('SKU, "Product Name", Category, Supplier, "Units/carton", "Product box Length", "Product box Width", "Product box Height", "Product box weight (kg)", "Carton Width", "Carton Height", "Carton weight", "Carton Length", ASIN')
          .order('SKU', { ascending: true }),
        fetchLibraryProducts(),
      ]);
      if (library.state !== 'ok') {
        console.warn('Product Library not included:', library.state === 'error' ? library.message : 'not configured');
      }

      console.log('Supabase response:', { data, error });

      if (error) {
        console.error('Supabase query error:', error);
        throw error;
      }

      if (data && Array.isArray(data)) {
        const rows = data as unknown as ProductInfo[];
        const merged = library.state === 'ok' ? mergeLibraryProducts(rows, library.products).rows : rows;
        merged.sort((a, b) => String(a.SKU).localeCompare(String(b.SKU)));
        console.log(`Loaded ${merged.length} products (${rows.length} from Product Information)`);
        setProductInfoList(merged);
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