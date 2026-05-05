"use client";

import { useState, useCallback } from 'react';
import { Button } from "@platform/ui";
import { Input } from "@platform/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { useToast } from "@platform/ui";
import { Upload, FileText, Check } from 'lucide-react';

export interface SKUData {
  sku: string;
  name?: string;
  length?: number;
  width?: number;
  height?: number;
  weight?: number;
  [key: string]: any;
}

interface SKUImporterProps {
  onSKUSelect: (skuData: SKUData) => void;
}

export function SKUImporter({ onSKUSelect }: SKUImporterProps) {
  const [skuData, setSKUData] = useState<SKUData[]>([]);
  const [selectedSKU, setSelectedSKU] = useState<string>('');
  const [isImported, setIsImported] = useState(false);
  const { toast } = useToast();

  const parseCSV = useCallback((csvText: string): SKUData[] => {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const data: SKUData[] = [];

    // Find column indices
    const skuIndex = headers.findIndex(h => h.includes('sku') || h.includes('product') || h.includes('code'));
    const nameIndex = headers.findIndex(h => h.includes('name') || h.includes('title') || h.includes('description'));
    const lengthIndex = headers.findIndex(h => h.includes('length') || h.includes('l'));
    const widthIndex = headers.findIndex(h => h.includes('width') || h.includes('w'));
    const heightIndex = headers.findIndex(h => h.includes('height') || h.includes('h'));
    const weightIndex = headers.findIndex(h => h.includes('weight') || h.includes('mass'));

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      
      if (values.length >= headers.length && skuIndex >= 0) {
        const skuItem: SKUData = {
          sku: values[skuIndex] || `SKU-${i}`,
        };

        if (nameIndex >= 0) skuItem.name = values[nameIndex];
        if (lengthIndex >= 0) skuItem.length = parseFloat(values[lengthIndex]) || undefined;
        if (widthIndex >= 0) skuItem.width = parseFloat(values[widthIndex]) || undefined;
        if (heightIndex >= 0) skuItem.height = parseFloat(values[heightIndex]) || undefined;
        if (weightIndex >= 0) skuItem.weight = parseFloat(values[weightIndex]) || undefined;

        data.push(skuItem);
      }
    }

    return data;
  }, []);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload a CSV file',
        variant: 'destructive',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csvText = e.target?.result as string;
        const parsedData = parseCSV(csvText);
        
        if (parsedData.length === 0) {
          toast({
            title: 'No data found',
            description: 'The CSV file appears to be empty or has no valid data',
            variant: 'destructive',
          });
          return;
        }

        setSKUData(parsedData);
        setIsImported(true);
        setSelectedSKU('');
        
        toast({
          title: 'CSV imported successfully',
          description: `Loaded ${parsedData.length} SKUs`,
        });
      } catch (error) {
        toast({
          title: 'Import failed',
          description: 'Error parsing CSV file. Please check the format.',
          variant: 'destructive',
        });
      }
    };
    reader.readAsText(file);
  }, [parseCSV, toast]);

  const handleSKUSelect = useCallback((skuValue: string) => {
    setSelectedSKU(skuValue);
    const selectedData = skuData.find(item => item.sku === skuValue);
    if (selectedData) {
      onSKUSelect(selectedData);
      toast({
        title: 'SKU loaded',
        description: `Loaded data for ${selectedData.sku}`,
      });
    }
  }, [skuData, onSKUSelect, toast]);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          SKU Data Import
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <Input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="cursor-pointer"
            />
          </div>
          {isImported && (
            <div className="flex items-center gap-2 text-green-600">
              <Check className="h-4 w-4" />
              <span className="text-sm font-medium">{skuData.length} SKUs loaded</span>
            </div>
          )}
        </div>

        {isImported && skuData.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Select SKU:</label>
            <Select value={selectedSKU} onValueChange={handleSKUSelect}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a SKU to load its data..." />
              </SelectTrigger>
              <SelectContent>
                {skuData.map((item) => (
                  <SelectItem key={item.sku} value={item.sku}>
                    {item.sku} {item.name ? `- ${item.name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          <p><strong>CSV Format:</strong> First row should contain headers like: SKU, Name, Length, Width, Height, Weight</p>
          <p>The system will automatically detect column names containing these keywords.</p>
        </div>
      </CardContent>
    </Card>
  );
}