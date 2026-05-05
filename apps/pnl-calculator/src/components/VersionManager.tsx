"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Clock, Save, FolderOpen, Copy, Trash2, ChevronDown, ChevronUp, Loader2, Search, SortAsc, SortDesc, Filter, Edit, Briefcase, FlaskConical, Plus, History, Lock, Unlock } from 'lucide-react';
import { Button } from "@platform/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { Input } from "@platform/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@platform/ui";
import { RadioGroup, RadioGroupItem } from "@platform/ui";
import { Label } from "@platform/ui";
import { useToast } from "@platform/ui";
import { SavedVersion } from '@/types/product';
import VersionHistory from './VersionHistory';
import { TrashBin } from './TrashBin';

interface SaveAsDialogProps {
  loading: boolean;
  onSaveVersion: (bucket: 'live' | 'rd', versionName: string) => void;
}

const SaveAsDialog: React.FC<SaveAsDialogProps> = ({ loading, onSaveVersion }) => {
  const [selectedBucket, setSelectedBucket] = useState<'live' | 'rd'>('live');
  const [versionName, setVersionName] = useState('');

  const handleSave = () => {
    if (versionName.trim()) {
      onSaveVersion(selectedBucket, versionName.trim());
      setVersionName('');
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="border-primary/50 text-primary hover:bg-primary/10"
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-1" />
          )}
          Save As
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save New Version</DialogTitle>
          <DialogDescription>
            Create a new version and categorize it as Live or R&D.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="version-name" className="text-sm font-medium">
              Version Name
            </Label>
            <Input
              id="version-name"
              placeholder="Enter version name"
              value={versionName}
              onChange={(e) => setVersionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && versionName.trim()) {
                  handleSave();
                  const closeBtn = e.currentTarget.closest('[role="dialog"]')?.querySelector('[data-close-btn]') as HTMLButtonElement;
                  closeBtn?.click();
                }
              }}
            />
          </div>
          
          <div>
            <Label className="text-sm font-medium mb-3 block">
              Category
            </Label>
            <RadioGroup
              value={selectedBucket}
              onValueChange={(value: 'live' | 'rd') => setSelectedBucket(value)}
              className="space-y-3"
            >
              <div className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-muted/30">
                <RadioGroupItem value="live" id="live" />
                <Label htmlFor="live" className="flex items-center cursor-pointer flex-1">
                  <Briefcase className="w-4 h-4 mr-2 text-success" />
                  <div>
                    <div className="font-medium">Live</div>
                    <div className="text-xs text-muted-foreground">Production-ready versions</div>
                  </div>
                </Label>
              </div>
              <div className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-muted/30">
                <RadioGroupItem value="rd" id="rd" />
                <Label htmlFor="rd" className="flex items-center cursor-pointer flex-1">
                  <FlaskConical className="w-4 h-4 mr-2 text-warning" />
                  <div>
                    <div className="font-medium">R&D</div>
                    <div className="text-xs text-muted-foreground">Research & development versions</div>
                  </div>
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>
        <div className="flex justify-end space-x-2 pt-4">
          <DialogClose asChild>
            <Button variant="outline" data-close-btn>Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button
              onClick={handleSave}
              disabled={!versionName.trim()}
              className="bg-primary hover:bg-primary/90"
            >
              Save Version
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
};

interface VersionManagerProps {
  productId: number;
  savedVersions: SavedVersion[];
  loading?: boolean;
  currentProductData?: any;
  onSaveVersion: (bucket: 'live' | 'rd', versionName: string) => void;
  onLoadVersion: (version: SavedVersion) => void;
  onDeleteVersion: (versionId: string) => void;
  onUpdateVersion: (versionId: string) => void;
  onRenameVersion: (versionId: string, newName: string) => void;
  onCreateNewCalculation: () => void;
  loadDeletedVersions: () => Promise<SavedVersion[]>;
  restoreVersion: (versionId: string) => Promise<void>;
  permanentlyDeleteVersion: (versionId: string) => Promise<void>;
}

const VersionManager: React.FC<VersionManagerProps> = ({
  productId,
  savedVersions,
  loading = false,
  currentProductData,
  onSaveVersion,
  onLoadVersion,
  onDeleteVersion,
  onUpdateVersion,
  onRenameVersion,
  onCreateNewCalculation,
  loadDeletedVersions,
  restoreVersion,
  permanentlyDeleteVersion,
}) => {
  const { toast } = useToast();
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<SavedVersion | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'date'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [bucketFilter, setBucketFilter] = useState<'all' | 'live' | 'rd'>('all');
  const [lastLoadedVersionId, setLastLoadedVersionId] = useState<string | null>(null);
  const [unlockedVersions, setUnlockedVersions] = useState<Set<string>>(new Set());
  const [unlockConfirmVersion, setUnlockConfirmVersion] = useState<SavedVersion | null>(null);
  const [trashDialogOpen, setTrashDialogOpen] = useState(false);
  
  const currentLoadedVersion = useMemo(
    () => savedVersions.find(v => v.id === lastLoadedVersionId) || null,
    [savedVersions, lastLoadedVersionId]
  );

  const toggleVersionLock = (version: SavedVersion) => {
    const isCurrentlyLocked = !unlockedVersions.has(version.id);
    
    // If it's a live version being unlocked, show confirmation dialog
    if (isCurrentlyLocked && version.bucket === 'live') {
      setUnlockConfirmVersion(version);
      return;
    }
    
    setUnlockedVersions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(version.id)) {
        newSet.delete(version.id);
        toast({
          title: "Version locked",
          description: "This version is now protected from accidental changes",
          variant: "default"
        });
      } else {
        newSet.add(version.id);
        toast({
          title: "Version unlocked",
          description: "You can now save changes to this version",
          variant: "default"
        });
      }
      return newSet;
    });
  };

  const confirmUnlockLiveVersion = () => {
    if (unlockConfirmVersion) {
      setUnlockedVersions(prev => {
        const newSet = new Set(prev);
        newSet.add(unlockConfirmVersion.id);
        return newSet;
      });
      toast({
        title: "Live version unlocked",
        description: `"${unlockConfirmVersion.name}" can now be modified`,
        variant: "default"
      });
      setUnlockConfirmVersion(null);
    }
  };

  const isVersionLocked = (version: SavedVersion) =>
    !unlockedVersions.has(version.id);

  const filteredAndSortedVersions = useMemo(() => {
    let filtered = savedVersions.filter(version => {
      const matchesSearch = version.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesBucket = bucketFilter === 'all' || version.bucket === bucketFilter;
      return matchesSearch && matchesBucket;
    });

    filtered.sort((a, b) => {
      // Always put the currently loaded version first
      if (currentLoadedVersion) {
        if (a.id === currentLoadedVersion.id) return -1;
        if (b.id === currentLoadedVersion.id) return 1;
      }
      
      if (sortBy === 'name') {
        const comparison = a.name.localeCompare(b.name);
        return sortOrder === 'asc' ? comparison : -comparison;
      } else {
        const aDate = new Date(a.timestamp);
        const bDate = new Date(b.timestamp);
        const comparison = aDate.getTime() - bDate.getTime();
        return sortOrder === 'asc' ? comparison : -comparison;
      }
    });

    return filtered;
  }, [savedVersions, searchTerm, sortBy, sortOrder, bucketFilter, currentLoadedVersion]);

  // Handle auto-open via URL params (?open_product=&open_version=)
  const linkHandledRef = useRef(false);
  useEffect(() => {
    if (loading) return;
    const params = new URLSearchParams(window.location.search);
    const openProduct = params.get('open_product');
    const openVersion = params.get('open_version');
    if (!openProduct || !openVersion) return;
    if (Number(openProduct) !== productId) return;
    if (linkHandledRef.current) return;
    const target = savedVersions.find(v => v.id === openVersion);
    if (target) {
      onLoadVersion(target);
      setLastLoadedVersionId(target.id);
      toast({ title: 'Version loaded', description: `Opened version "${target.name}"` });
      linkHandledRef.current = true;
      params.delete('open_product');
      params.delete('open_version');
      const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}${window.location.hash}`;
      window.history.replaceState({}, '', newUrl);
    }
  }, [productId, savedVersions, loading, onLoadVersion]);

  return (
    <Card className="border-info/20 bg-info/5">
      <CardHeader 
        className="pb-3 cursor-pointer" 
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <CardTitle className="text-info flex items-center justify-between">
          <div className="flex items-center">
            <Clock className="w-5 h-5 mr-2" />
            Calculation Database
            <span className="ml-2 text-sm bg-info/10 text-info px-2 py-1 rounded-full">
              {savedVersions.length} saved
            </span>
          </div>
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </CardTitle>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0 space-y-4">
          {/* Action Buttons - All in one row */}
          <div className="grid grid-cols-4 gap-2">
            {/* New Button */}
            <Button
              onClick={onCreateNewCalculation}
              variant="default"
              className="bg-primary hover:bg-primary/90"
            >
              <Plus className="w-4 h-4 mr-1" />
              New
            </Button>

            {/* Load Button */}
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="border-info/50 text-info hover:bg-info/10"
                  disabled={loading || savedVersions.length === 0}
                >
                  <FolderOpen className="w-4 h-4 mr-1" />
                  Load
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Load Version</DialogTitle>
                  <DialogDescription>
                    Select a saved version to load. This will replace all current product data.
                  </DialogDescription>
                </DialogHeader>
                <div className="max-h-60 overflow-y-auto space-y-2">
                  {savedVersions.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground">
                      No saved versions available
                    </div>
                  ) : (
                    savedVersions.map((version) => (
                      <DialogClose key={version.id} asChild>
                        <Button
                          variant="ghost"
                          className="w-full justify-start h-auto p-3"
                          onClick={() => {
                            setLastLoadedVersionId(version.id);
                            onLoadVersion(version);
                            toast({ title: 'Version loaded', description: `Loaded "${version.name}"` });
                          }}
                        >
                          <div className="flex items-center justify-between w-full">
                            <div className="text-left">
                              <div className="font-medium">{version.name}</div>
                              <div className="text-xs text-muted-foreground">{version.timestamp}</div>
                            </div>
                            <div className={`text-xs px-2 py-1 rounded-full ${
                              version.bucket === 'live' 
                                ? 'bg-success/10 text-success border border-success/20' 
                                : 'bg-warning/10 text-warning border border-warning/20'
                            }`}>
                              {version.bucket === 'live' ? 'Live' : 'R&D'}
                            </div>
                          </div>
                        </Button>
                      </DialogClose>
                    ))
                  )}
                </div>
              </DialogContent>
            </Dialog>

            {/* Save to Current Version */}
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="border-info/50 text-info hover:bg-info/10"
                  disabled={loading || savedVersions.length === 0}
                >
                  <Save className="w-4 h-4 mr-1" />
                  Save
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {savedVersions.length === 0 
                      ? 'No versions available'
                      : currentLoadedVersion && isVersionLocked(currentLoadedVersion)
                      ? `"${currentLoadedVersion.name}" is locked`
                      : 'Save to Existing Version'
                    }
                  </DialogTitle>
                  <DialogDescription>
                    {savedVersions.length === 0
                      ? 'Create your first version using "Save As" to enable saving to existing versions.'
                      : currentLoadedVersion && isVersionLocked(currentLoadedVersion)
                      ? 'This version is locked to prevent accidental changes. Click the unlock button on the version to enable saving.'
                      : currentLoadedVersion
                      ? `Save your current changes to "${currentLoadedVersion.name}". This action cannot be undone.`
                      : 'Select a version to save your current changes to. This action cannot be undone.'
                    }
                  </DialogDescription>
                </DialogHeader>
                {savedVersions.length > 0 && (
                  <div className="py-4">
                    {currentLoadedVersion ? (
                      // Show current loaded version info
                      <div className="p-3 border rounded-lg bg-muted/30">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium">{currentLoadedVersion.name}</div>
                            <div className="text-xs text-muted-foreground">{currentLoadedVersion.timestamp}</div>
                          </div>
                          <div className={`text-xs px-2 py-1 rounded-full ${
                            currentLoadedVersion.bucket === 'live' 
                              ? 'bg-success/10 text-success border border-success/20' 
                              : 'bg-warning/10 text-warning border border-warning/20'
                          }`}>
                            {currentLoadedVersion.bucket === 'live' ? 'Live' : 'R&D'}
                          </div>
                        </div>
                      </div>
                    ) : (
                       // Show version selection dropdown
                       <div className="space-y-2">
                         <Label>Select version to save to:</Label>
                         <div className="max-h-32 overflow-y-auto space-y-1">
                           {[...savedVersions].sort((a, b) => {
                             // Always put the currently loaded version first
                             if (currentLoadedVersion) {
                               if (a.id === currentLoadedVersion.id) return -1;
                               if (b.id === currentLoadedVersion.id) return 1;
                             }
                             // Then sort by date descending
                             return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
                           }).map((version) => (
                            <DialogClose key={version.id} asChild>
                              <Button
                                variant="ghost"
                                className="w-full justify-start h-auto p-3"
                                disabled={isVersionLocked(version)}
                                onClick={() => {
                                  if (!isVersionLocked(version)) {
                                    onUpdateVersion(version.id);
                                  }
                                }}
                              >
                                <div className="flex items-center justify-between w-full">
                                  <div className="text-left">
                                    <div className="font-medium flex items-center">
                                      {version.name}
                                      {isVersionLocked(version) && <Lock className="w-3 h-3 ml-2" />}
                                    </div>
                                    <div className="text-xs text-muted-foreground">{version.timestamp}</div>
                                  </div>
                                  <div className={`text-xs px-2 py-1 rounded-full ${
                                    version.bucket === 'live' 
                                      ? 'bg-success/10 text-success border border-success/20' 
                                      : 'bg-warning/10 text-warning border border-warning/20'
                                  }`}>
                                    {version.bucket === 'live' ? 'Live' : 'R&D'}
                                  </div>
                                </div>
                              </Button>
                            </DialogClose>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex justify-end space-x-2 pt-4">
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  {currentLoadedVersion && !isVersionLocked(currentLoadedVersion) && (
                    <DialogClose asChild>
                      <Button
                        onClick={() => onUpdateVersion(currentLoadedVersion.id)}
                        className="bg-info hover:bg-info/90"
                      >
                        Save to "{currentLoadedVersion.name}"
                      </Button>
                    </DialogClose>
                  )}
                </div>
              </DialogContent>
            </Dialog>

            {/* Copy to Live (only shown for R&D versions) */}
            {currentLoadedVersion && currentLoadedVersion.bucket === 'rd' && (
              <Button
                onClick={() => {
                  const copyName = `${currentLoadedVersion.name} - Live Copy`;
                  if (currentProductData) {
                    onSaveVersion('live', copyName);
                    toast({
                      title: "Copied to Live",
                      description: `Created "${copyName}" in Live Products`,
                    });
                  }
                }}
                variant="outline"
                className="border-success/50 text-success hover:bg-success/10"
                disabled={loading}
              >
                <Briefcase className="w-4 h-4 mr-1" />
                Copy to Live
              </Button>
            )}

            {/* Save As - New Version */}
            <SaveAsDialog 
              loading={loading}
              onSaveVersion={onSaveVersion}
            />

            {/* Trash Bin */}
            <Button
              onClick={() => setTrashDialogOpen(true)}
              variant="outline"
              className="border-muted-foreground/30 hover:bg-muted"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Trash
            </Button>
          </div>

          {/* Search and Sort Controls */}
          {savedVersions.length > 0 && (
            <div className="space-y-3 p-3 bg-muted/30 rounded-lg">
              <div className="flex items-center space-x-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search versions..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
                
                <Select value={bucketFilter} onValueChange={(value: 'all' | 'live' | 'rd') => setBucketFilter(value)}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4" />
                        All Products
                      </div>
                    </SelectItem>
                    <SelectItem value="live">
                      <div className="flex items-center gap-2">
                        <Briefcase className="w-4 h-4 text-success" />
                        Live Only
                      </div>
                    </SelectItem>
                    <SelectItem value="rd">
                      <div className="flex items-center gap-2">
                        <FlaskConical className="w-4 h-4 text-warning" />
                        R&D Only
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                
                <Select value={sortBy} onValueChange={(value: 'name' | 'date') => setSortBy(value)}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="name">Name</SelectItem>
                  </SelectContent>
                </Select>
                
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  className="px-2"
                >
                  {sortOrder === 'asc' ? <SortAsc className="w-4 h-4" /> : <SortDesc className="w-4 h-4" />}
                </Button>
              </div>
              
              {searchTerm && (
                <div className="text-xs text-muted-foreground">
                  Showing {filteredAndSortedVersions.length} of {savedVersions.length} versions
                </div>
              )}
            </div>
          )}

          {/* Saved Versions List */}
          {savedVersions.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No saved versions yet</p>
              <p className="text-sm">Save your current configuration to create the first version</p>
            </div>
          ) : filteredAndSortedVersions.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Filter className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No versions found</p>
              <p className="text-sm">Try adjusting your search terms</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {filteredAndSortedVersions.map((version) => (
                <div
                  key={version.id}
                  className="flex items-center justify-between p-3 border border-border rounded-lg bg-card hover:bg-accent/5 transition-colors"
                >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-sm truncate">{version.name}</div>
                        <div className={`text-xs px-2 py-1 rounded-full ${
                          version.bucket === 'live' 
                            ? 'bg-success/10 text-success border border-success/20' 
                            : 'bg-warning/10 text-warning border border-warning/20'
                        }`}>
                          {version.bucket === 'live' ? 'Live' : 'R&D'}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {version.timestamp}
                      </div>
                    </div>
                  
                   <div className="flex items-center space-x-2 ml-3">
                     <Dialog>
                       <DialogTrigger asChild>
                         <Button
                           variant="ghost"
                           size="sm"
                           className="text-info hover:text-info hover:bg-info/10"
                           onClick={() => setSelectedVersion(version)}
                         >
                           <FolderOpen className="w-4 h-4" />
                         </Button>
                       </DialogTrigger>
                       <DialogContent>
                         <DialogHeader>
                           <DialogTitle>Load Version: {version.name}</DialogTitle>
                           <DialogDescription>
                             This will replace all current product data with the saved version from {version.timestamp}.
                             This action cannot be undone.
                           </DialogDescription>
                         </DialogHeader>
                         <div className="flex justify-end space-x-2 pt-4">
                           <DialogClose asChild>
                             <Button variant="outline">Cancel</Button>
                           </DialogClose>
                           <DialogClose asChild>
                             <Button
                               onClick={() => { setLastLoadedVersionId(version.id); onLoadVersion(version); }}
                               className="bg-info hover:bg-info/90"
                             >
                               Load Version
                             </Button>
                           </DialogClose>
                         </div>
                       </DialogContent>
                     </Dialog>

                      {/* Lock/Unlock button for all versions */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`${isVersionLocked(version) 
                          ? 'text-destructive hover:text-destructive hover:bg-destructive/10' 
                          : 'text-success hover:text-success hover:bg-success/10'
                        }`}
                        onClick={() => toggleVersionLock(version)}
                      >
                        {isVersionLocked(version) ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                      </Button>

                     {/* Overwrite selected version with current data */}
                     <Dialog>
                       <DialogTrigger asChild>
                         <Button
                           variant="ghost"
                           size="sm"
                           className="text-success hover:text-success hover:bg-success/10"
                           disabled={isVersionLocked(version)}
                         >
                           <Save className="w-4 h-4" />
                         </Button>
                       </DialogTrigger>
                       <DialogContent>
                         <DialogHeader>
                           <DialogTitle>
                             {isVersionLocked(version) 
                               ? `"${version.name}" is locked`
                               : `Overwrite "${version.name}"?`
                             }
                           </DialogTitle>
                           <DialogDescription>
                             {isVersionLocked(version)
                               ? 'This version is locked to prevent accidental changes. Click the unlock button to enable saving.'
                               : 'This will replace the saved data of this version with your current product configuration. This action cannot be undone.'
                             }
                           </DialogDescription>
                         </DialogHeader>
                          <div className="flex justify-end space-x-2 pt-4">
                            <DialogClose asChild>
                              <Button variant="outline">Cancel</Button>
                            </DialogClose>
                            {(() => {
                              const locked = isVersionLocked(version);
                              console.log(`Save button render check for "${version.name}":`, { locked, shouldShow: !locked });
                              return !locked ? (
                                <DialogClose asChild>
                                  <Button
                                    onClick={() => onUpdateVersion(version.id)}
                                    className="bg-success hover:bg-success/90"
                                  >
                                    Save to This Version
                                  </Button>
                                </DialogClose>
                              ) : (
                                <div className="text-sm text-muted-foreground">
                                  Version is locked - click the lock icon to unlock
                                </div>
                              );
                            })()}
                          </div>
                       </DialogContent>
                     </Dialog>

                    <Dialog>
                      <DialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-warning hover:text-warning hover:bg-warning/10"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Rename Version</DialogTitle>
                          <DialogDescription>
                            Enter a new name for this version.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <Input
                            placeholder="Version name"
                            defaultValue={version.name}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const input = e.currentTarget;
                                const newName = input.value.trim();
                                if (newName && newName !== version.name) {
                                  onRenameVersion(version.id, newName);
                                  toast({ title: 'Renamed', description: `Version renamed to "${newName}"` });
                                }
                                // Close dialog by clicking the close button
                                const closeBtn = input.closest('[role="dialog"]')?.querySelector('[data-close-btn]') as HTMLButtonElement;
                                closeBtn?.click();
                              }
                            }}
                          />
                        </div>
                        <div className="flex justify-end space-x-2 pt-4">
                          <DialogClose asChild>
                            <Button variant="outline" data-close-btn>Cancel</Button>
                          </DialogClose>
                          <DialogClose asChild>
                            <Button
                              onClick={(e) => {
                                const input = e.currentTarget.closest('[role="dialog"]')?.querySelector('input') as HTMLInputElement;
                                const newName = input?.value.trim();
                                if (newName && newName !== version.name) {
                                  onRenameVersion(version.id, newName);
                                  toast({ title: 'Renamed', description: `Version renamed to "${newName}"` });
                                }
                              }}
                              className="bg-warning hover:bg-warning/90"
                            >
                              Rename
                            </Button>
                          </DialogClose>
                        </div>
                      </DialogContent>
                    </Dialog>

                     <Button
                       variant="ghost"
                       size="sm"
                       className="text-primary hover:text-primary hover:bg-primary/10"
                       onClick={() => {
                         const url = new URL(window.location.href);
                         url.searchParams.set('open_product', String(productId));
                         url.searchParams.set('open_version', String(version.id));
                         navigator.clipboard.writeText(url.toString());
                         toast({ title: 'Link copied', description: 'Share this link to open this version.' });
                       }}
                     >
                       <Copy className="w-4 h-4" />
                     </Button>

                     {/* Version History Button */}
                     <Dialog>
                       <DialogTrigger asChild>
                         <Button
                           variant="ghost"
                           size="sm"
                           className="text-muted-foreground hover:text-foreground"
                         >
                           <History className="w-4 h-4" />
                         </Button>
                       </DialogTrigger>
                       <DialogContent className="max-w-2xl max-h-[80vh]">
                         <DialogHeader>
                           <DialogTitle>Version History</DialogTitle>
                           <DialogDescription>
                             Changes made to "{version.name}"
                           </DialogDescription>
                         </DialogHeader>
                         <div className="max-h-96 overflow-hidden">
                           <VersionHistory
                             productId={productId}
                             versionId={version.id}
                             versionName={version.name}
                           />
                         </div>
                       </DialogContent>
                     </Dialog>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => onDeleteVersion(version.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Confirmation dialog for unlocking live versions */}
          <Dialog open={!!unlockConfirmVersion} onOpenChange={() => setUnlockConfirmVersion(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Unlock Live Version</DialogTitle>
                <DialogDescription>
                  You are about to unlock "{unlockConfirmVersion?.name}" which is a Live version. 
                  This will allow modifications to production-ready data. Are you sure you want to proceed?
                </DialogDescription>
              </DialogHeader>
              <div className="flex justify-end space-x-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setUnlockConfirmVersion(null)}
                >
                  No
                </Button>
                <Button
                  onClick={confirmUnlockLiveVersion}
                  className="bg-destructive hover:bg-destructive/90"
                >
                  Yes, Unlock
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardContent>
      )}

      <TrashBin
        open={trashDialogOpen}
        onOpenChange={setTrashDialogOpen}
        productId={productId}
        loadDeletedVersions={loadDeletedVersions}
        onRestore={restoreVersion}
        onPermanentDelete={permanentlyDeleteVersion}
      />
    </Card>
  );
};

export default VersionManager;