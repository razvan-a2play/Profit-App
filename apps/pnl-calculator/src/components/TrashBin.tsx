"use client";

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@platform/ui";
import { Button } from "@platform/ui";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@platform/ui";
import { Trash2, RotateCcw, Clock, Folder } from 'lucide-react';
import { SavedVersion } from '@/types/product';
import { formatDistanceToNow } from 'date-fns';

interface TrashBinProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: number;
  loadDeletedVersions: () => Promise<SavedVersion[]>;
  onRestore: (uuid: string) => Promise<void>;
  onPermanentDelete: (uuid: string) => Promise<void>;
}

export const TrashBin = ({
  open,
  onOpenChange,
  productId,
  loadDeletedVersions,
  onRestore,
  onPermanentDelete
}: TrashBinProps) => {
  const [deletedVersions, setDeletedVersions] = useState<SavedVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      loadTrash();
    }
  }, [open]);

  const loadTrash = async () => {
    setLoading(true);
    const versions = await loadDeletedVersions();
    setDeletedVersions(versions);
    setLoading(false);
  };

  const handleRestore = async (uuid: string) => {
    await onRestore(uuid);
    await loadTrash(); // Reload trash after restore
  };

  const handlePermanentDelete = async (uuid: string) => {
    await onPermanentDelete(uuid);
    setConfirmDelete(null);
    await loadTrash(); // Reload trash after delete
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5" />
              Trash Bin
            </DialogTitle>
            <DialogDescription>
              Deleted calculations are kept for 30 days before permanent deletion.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading trash...
            </div>
          ) : deletedVersions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Trash2 className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>Trash is empty</p>
            </div>
          ) : (
            <div className="space-y-3">
              {deletedVersions.map((version) => (
                <div
                  key={version.id}
                  className="flex items-center justify-between p-4 border rounded-lg bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1">
                    <Folder className={`w-5 h-5 ${
                      version.bucket === 'live' 
                        ? 'text-green-500' 
                        : 'text-purple-500'
                    }`} />
                    <div className="flex-1">
                      <div className="font-medium">{version.name}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Deleted {formatDistanceToNow(new Date(version.timestamp))} ago
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {version.bucket === 'live' ? 'LIVE' : 'R&D'} Mode
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRestore(version.id)}
                      className="flex items-center gap-1"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Restore
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setConfirmDelete(version.id)}
                      className="flex items-center gap-1"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete Forever
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently Delete?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the calculation from the database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && handlePermanentDelete(confirmDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
