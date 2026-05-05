"use client";

import React, { useState } from 'react';
import { History, User, Clock, Edit, Plus, Trash2, FileText, ChevronRight, ChevronDown, ArrowRight, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { Badge } from "@platform/ui";
import { Skeleton } from "@platform/ui";
import { ScrollArea } from "@platform/ui";
import { Button } from "@platform/ui";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@platform/ui";
import { useVersionHistory, type VersionHistoryEntry } from '@/hooks/useVersionHistory';

interface VersionHistoryProps {
  productId: number;
  versionId?: string;
  versionName?: string;
}

const getActionIcon = (actionType: string) => {
  switch (actionType) {
    case 'created':
      return <Plus className="w-4 h-4 text-success" />;
    case 'updated':
      return <Edit className="w-4 h-4 text-info" />;
    case 'renamed':
      return <FileText className="w-4 h-4 text-warning" />;
    case 'deleted':
      return <Trash2 className="w-4 h-4 text-destructive" />;
    default:
      return <Clock className="w-4 h-4 text-muted-foreground" />;
  }
};

const getActionBadgeVariant = (actionType: string) => {
  switch (actionType) {
    case 'created':
      return 'default';
    case 'updated':
      return 'secondary';
    case 'renamed':
      return 'outline';
    case 'deleted':
      return 'destructive';
    default:
      return 'secondary';
  }
};

const formatTimeAgo = (timestamp: string) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
  
  if (diffInHours < 1) {
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    return diffInMinutes < 1 ? 'Just now' : `${diffInMinutes}m ago`;
  } else if (diffInHours < 24) {
    return `${diffInHours}h ago`;
  } else {
    const diffInDays = Math.floor(diffInHours / 24);
    return diffInDays === 1 ? '1 day ago' : `${diffInDays} days ago`;
  }
};

const VersionHistoryEntry: React.FC<{ entry: VersionHistoryEntry }> = ({ entry }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasDetails = entry.changed_fields && Object.keys(entry.changed_fields).length > 0;

  const renderChangeDetails = (changes: any) => {
    if (!changes || typeof changes !== 'object') return null;

    return (
      <div className="space-y-2 mt-3 p-3 bg-muted/50 rounded-md border">
        <div className="text-xs font-medium text-muted-foreground mb-2">Field Changes:</div>
        {Object.entries(changes).map(([field, change]: [string, any]) => (
          <div key={field} className="space-y-1">
            {field === 'version_name' && change.from && change.to && (
              <div className="flex items-center space-x-2 text-xs">
                <span className="font-medium">Name:</span>
                <span className="bg-destructive/10 text-destructive px-2 py-1 rounded">
                  {change.from}
                </span>
                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                <span className="bg-success/10 text-success px-2 py-1 rounded">
                  {change.to}
                </span>
              </div>
            )}
            {field === '_bucket' && change.from && change.to && (
              <div className="flex items-center space-x-2 text-xs">
                <span className="font-medium">Bucket:</span>
                <Badge variant={change.from === 'live' ? 'default' : 'secondary'} className="h-5 text-xs">
                  {change.from.toUpperCase()}
                </Badge>
                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                <Badge variant={change.to === 'live' ? 'default' : 'secondary'} className="h-5 text-xs">
                  {change.to.toUpperCase()}
                </Badge>
              </div>
            )}
            {field !== 'version_name' && field !== '_bucket' && (
              <div className="space-y-1">
                <div className="flex items-center space-x-2 text-xs">
                  <Package className="w-3 h-3 text-muted-foreground" />
                  <span className="font-medium capitalize">{field.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}:</span>
                  {change.type && (
                    <Badge variant={
                      change.type === 'added' ? 'default' : 
                      change.type === 'removed' ? 'destructive' : 'secondary'
                    } className="h-4 text-xs">
                      {change.type}
                    </Badge>
                  )}
                </div>
                <div className="pl-5 space-y-1">
                  {change.from !== null && change.type !== 'added' && (
                    <div className="text-xs text-muted-foreground">
                      <span className="text-destructive">- </span>
                      <span className="bg-destructive/10 px-1 rounded">{JSON.stringify(change.from)}</span>
                    </div>
                  )}
                  {change.to !== null && change.type !== 'removed' && (
                    <div className="text-xs text-muted-foreground">
                      <span className="text-success">+ </span>
                      <span className="bg-success/10 px-1 rounded">{JSON.stringify(change.to)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex items-start space-x-3 p-4 border-l-2 border-l-muted hover:bg-accent/5 transition-colors">
      <div className="flex-shrink-0 w-8 h-8 bg-muted rounded-full flex items-center justify-center">
        {getActionIcon(entry.action_type)}
      </div>
      
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Badge variant={getActionBadgeVariant(entry.action_type) as any}>
              {entry.action_type}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {formatTimeAgo(entry.created_at)}
            </span>
            {hasDetails && (
              <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                <CollapsibleTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="p-0 h-auto text-xs text-info hover:text-info/80"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3 h-3 mr-1" />
                    ) : (
                      <ChevronRight className="w-3 h-3 mr-1" />
                    )}
                    Details
                  </Button>
                </CollapsibleTrigger>
              </Collapsible>
            )}
          </div>
          
          {entry.user_email && (
            <div className="flex items-center space-x-1 text-xs text-muted-foreground">
              <User className="w-3 h-3" />
              <span>{entry.user_email}</span>
            </div>
          )}
        </div>
        
        <p className="text-sm text-foreground">
          {entry.change_description}
        </p>
        
        <div className="text-xs text-muted-foreground">
          {new Date(entry.created_at).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}
        </div>

        {hasDetails && (
          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CollapsibleContent>
              {renderChangeDetails(entry.changed_fields)}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  );
};

const VersionHistory: React.FC<VersionHistoryProps> = ({ productId, versionId, versionName }) => {
  const { history, loading } = useVersionHistory(productId, versionId);

  if (loading) {
    return (
      <Card className="border-info/20 bg-info/5">
        <CardHeader>
          <CardTitle className="text-info flex items-center">
            <History className="w-5 h-5 mr-2" />
            Version History
            <span className="ml-2 text-sm bg-info/10 text-info px-2 py-1 rounded-full">
              Loading...
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-start space-x-3 p-4">
              <Skeleton className="w-8 h-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-info/20 bg-info/5">
      <CardHeader>
        <CardTitle className="text-info flex items-center">
          <History className="w-5 h-5 mr-2" />
          {versionName ? `History: ${versionName}` : 'Version History'}
          <span className="ml-2 text-sm bg-info/10 text-info px-2 py-1 rounded-full">
            {history.length} {history.length === 1 ? 'entry' : 'entries'}
          </span>
        </CardTitle>
      </CardHeader>
      
      <CardContent className="p-0">
        {history.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground p-6">
            <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No version history yet</p>
            <p className="text-sm">Actions on versions will appear here</p>
          </div>
        ) : (
          <ScrollArea className="h-96">
            <div className="space-y-0">
              {history.map((entry) => (
                <VersionHistoryEntry key={entry.id} entry={entry} />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};

export default VersionHistory;