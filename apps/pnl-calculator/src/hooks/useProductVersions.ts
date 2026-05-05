import { useState, useEffect } from 'react';
import { supabase } from "@/lib/supabase";
import { useToast } from "@platform/ui";
import { SavedVersion } from '@/types/product';

interface SupabaseVersion {
  id: string;
  product_id: number;
  version_name: string;
  version_data: any;
  bucket: 'live' | 'rd';
  created_at: string;
  updated_at: string;
  creator_email?: string;
  deleted_at?: string | null;
}

const toSavedVersion = (row: SupabaseVersion, useDeletedAtAsTimestamp = false): SavedVersion => ({
  id: row.id,
  timestamp: useDeletedAtAsTimestamp
    ? row.deleted_at || row.created_at
    : new Date(row.created_at).toLocaleDateString('en-US') + ' ' + new Date(row.created_at).toLocaleTimeString('en-US'),
  name: row.version_name,
  bucket: row.bucket || 'rd',
  data: row.version_data,
});

export const useProductVersions = (productId: number) => {
  const [savedVersions, setSavedVersions] = useState<SavedVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const loadVersions = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('product_versions')
        .select('*')
        .eq('product_id', productId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setSavedVersions((data || []).map((v: SupabaseVersion) => toSavedVersion(v)));
    } catch (error) {
      console.error('Error loading versions:', error);
      toast({
        title: "Error",
        description: "Failed to load saved versions",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const loadDeletedVersions = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('product_versions')
        .select('*')
        .eq('product_id', productId)
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false });

      if (error) throw error;

      return (data || []).map((v: SupabaseVersion) => toSavedVersion(v, true));
    } catch (error) {
      console.error('Error loading deleted versions:', error);
      toast({
        title: "Error",
        description: "Failed to load trash",
        variant: "destructive"
      });
      return [];
    } finally {
      setLoading(false);
    }
  };

  const saveVersion = async (versionName: string, productData: any, bucket: 'live' | 'rd' = 'live') => {
    try {
      setLoading(true);
      const { error } = await supabase
        .from('product_versions')
        .insert({
          product_id: productId,
          version_name: versionName,
          version_data: productData,
          bucket: bucket
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: `Version "${versionName}" saved to ${bucket === 'live' ? 'Live Products' : 'R&D Products'}`,
        variant: "default"
      });

      await loadVersions();
    } catch (error) {
      console.error('Error saving version:', error);
      toast({
        title: "Error",
        description: "Failed to save version",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const deleteVersion = async (versionId: string) => {
    try {
      setLoading(true);

      const { error } = await supabase
        .from('product_versions')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', versionId);

      if (error) throw error;

      toast({
        title: "Moved to Trash",
        description: "Calculation moved to trash. You can restore it within 30 days."
      });

      await loadVersions();
    } catch (error) {
      console.error('Error deleting version:', error);
      toast({
        title: "Error",
        description: "Failed to move to trash",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const restoreVersion = async (versionId: string) => {
    try {
      setLoading(true);
      const { error } = await supabase
        .from('product_versions')
        .update({ deleted_at: null })
        .eq('id', versionId);

      if (error) throw error;

      toast({
        title: "Restored",
        description: "Calculation restored successfully"
      });

      await loadVersions();
    } catch (error) {
      console.error('Error restoring version:', error);
      toast({
        title: "Error",
        description: "Failed to restore calculation",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const permanentlyDeleteVersion = async (versionId: string) => {
    try {
      setLoading(true);
      const { error } = await supabase
        .from('product_versions')
        .delete()
        .eq('id', versionId);

      if (error) throw error;

      toast({
        title: "Permanently Deleted",
        description: "Calculation permanently deleted"
      });
    } catch (error) {
      console.error('Error permanently deleting version:', error);
      toast({
        title: "Error",
        description: "Failed to permanently delete",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const updateVersion = async (versionId: string, productData: any, newName?: string) => {
    try {
      setLoading(true);

      const updates: Record<string, any> = { version_data: productData };
      if (newName && newName.trim()) {
        updates.version_name = newName.trim();
      }

      const { error } = await supabase
        .from('product_versions')
        .update(updates)
        .eq('id', versionId);

      if (error) throw error;

      const displayName = newName?.trim() ?? savedVersions.find(v => v.id === versionId)?.name ?? '';
      toast({
        title: 'Version updated',
        description: `Saved current changes to "${displayName}"`,
      });

      await loadVersions();
    } catch (error) {
      console.error('Error updating version:', error);
      toast({
        title: 'Error',
        description: 'Failed to update version',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const renameVersion = async (versionId: string, newName: string) => {
    try {
      setLoading(true);

      const { error } = await supabase
        .from('product_versions')
        .update({ version_name: newName.trim() })
        .eq('id', versionId);

      if (error) throw error;

      await loadVersions();
    } catch (error) {
      console.error('Error renaming version:', error);
      toast({
        title: 'Error',
        description: 'Failed to rename version',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVersions();
  }, [productId]);

  return {
    savedVersions,
    loading,
    saveVersion,
    deleteVersion,
    updateVersion,
    renameVersion,
    refreshVersions: loadVersions,
    loadDeletedVersions,
    restoreVersion,
    permanentlyDeleteVersion
  };
};
