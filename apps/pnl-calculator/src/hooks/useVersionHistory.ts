import { useState, useEffect } from 'react';
import { supabase } from "@/lib/supabase";
import { useToast } from "@platform/ui";

export interface VersionHistoryEntry {
  id: string;
  version_id: string;
  product_id: number;
  action_type: 'created' | 'updated' | 'renamed' | 'deleted';
  change_description: string;
  changed_fields?: any;
  user_email?: string;
  user_id?: string;
  created_at: string;
}

export const useVersionHistory = (productId: number, versionId?: string) => {
  const [history, setHistory] = useState<VersionHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const loadHistory = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('version_history')
        .select('*')
        .eq('product_id', productId);
      
      // If versionId is provided, filter by specific version
      if (versionId) {
        query = query.eq('version_id', versionId);
      }
      
      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;

      setHistory((data || []) as VersionHistoryEntry[]);
    } catch (error) {
      console.error('Error loading version history:', error);
      toast({
        title: "Error",
        description: "Failed to load version history",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (productId) {
      loadHistory();
    }
  }, [productId, versionId]);

  return {
    history,
    loading,
    refreshHistory: loadHistory
  };
};