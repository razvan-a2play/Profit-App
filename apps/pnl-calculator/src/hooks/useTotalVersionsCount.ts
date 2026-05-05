import { useState, useEffect } from 'react';
import { supabase } from "@/lib/supabase";

export const useTotalVersionsCount = () => {
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTotalCount = async () => {
      try {
        const { count, error } = await supabase
          .from('product_versions')
          .select('*', { count: 'exact', head: true });
        
        if (error) {
          console.error('Error fetching total versions count:', error);
          setTotalCount(0);
        } else {
          setTotalCount(count || 0);
        }
      } catch (error) {
        console.error('Error fetching total versions count:', error);
        setTotalCount(0);
      } finally {
        setLoading(false);
      }
    };

    fetchTotalCount();

    // Set up real-time subscription to update count when versions are added/removed
    const subscription = supabase
      .channel('total_versions_count')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'product_versions' },
        () => {
          fetchTotalCount();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return { totalCount, loading };
};