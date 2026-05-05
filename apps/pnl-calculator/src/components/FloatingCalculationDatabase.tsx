"use client";

import React from 'react';
import { Database } from 'lucide-react';
import { Button } from "@platform/ui";
import { Product } from '@/types/product';
import { useTotalVersionsCount } from '@/hooks/useTotalVersionsCount';

interface FloatingCalculationDatabaseProps {
  products: Product[];
}

const FloatingCalculationDatabase: React.FC<FloatingCalculationDatabaseProps> = ({
  products,
}) => {
  const { totalCount: totalSavedVersions } = useTotalVersionsCount();

  const scrollToCalculationDatabase = () => {
    // Find the first calculation database element and scroll to it
    const calculationDatabase = document.getElementById('calculation-database');
    if (calculationDatabase) {
      calculationDatabase.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'start' 
      });
      
      // After scrolling, expand the calculation database if it's not already expanded
      setTimeout(() => {
        const header = calculationDatabase.querySelector('[role="button"], .cursor-pointer');
        if (header) {
          // Check if it's already expanded by looking for ChevronUp icon
          const chevronUp = header.querySelector('svg[data-testid="chevron-up"], .lucide-chevron-up');
          const chevronDown = header.querySelector('svg[data-testid="chevron-down"], .lucide-chevron-down');
          
          // If chevronDown is visible or chevronUp is not visible, it's collapsed, so click to expand
          if (chevronDown || !chevronUp) {
            (header as HTMLElement).click();
          }
        }
      }, 500); // Wait for scroll animation to complete
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-fade-in">
      <Button
        onClick={scrollToCalculationDatabase}
        className="h-14 w-14 rounded-full bg-primary hover:bg-primary/90 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105"
        size="icon"
        title={`Calculation Database - ${totalSavedVersions} saved version${totalSavedVersions !== 1 ? 's' : ''}`}
      >
        <div className="relative">
          <Database className="h-6 w-6 text-primary-foreground" />
          {totalSavedVersions > 0 && (
            <div className="absolute -top-2 -right-2 h-5 w-5 bg-accent rounded-full flex items-center justify-center">
              <span className="text-xs font-bold text-accent-foreground">
                {totalSavedVersions > 99 ? '99+' : totalSavedVersions}
              </span>
            </div>
          )}
        </div>
      </Button>
    </div>
  );
};

export default FloatingCalculationDatabase;