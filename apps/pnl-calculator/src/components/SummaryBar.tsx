"use client";

import React, { useState, useEffect } from "react";
import { DollarSign, TrendingUp, TrendingDown } from "lucide-react";
import { Input } from "@platform/ui";

interface SummaryBarProps {
  sellingPrice: number;
  totalCost: number;
  profit: number;
  marginPercent: number;
  tacosPercent?: number;
  onSellingPriceChange?: (value: number) => void;
  // TikTok Shop specific props
  showTikTokDual?: boolean;
  mcfData?: {
    totalCost: number;
    profit: number;
    marginPercent: number;
  };
  fbtData?: {
    totalCost: number;
    profit: number;
    marginPercent: number;
  };
}

const fmt = (n: number) => (Number.isFinite(n) ? n : 0);

const SummaryBar: React.FC<SummaryBarProps> = ({
  sellingPrice,
  totalCost,
  profit,
  marginPercent,
  tacosPercent,
  onSellingPriceChange,
  showTikTokDual = false,
  mcfData,
  fbtData,
}) => {
  const positive = fmt(profit) >= 0;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(Number.isFinite(sellingPrice) ? sellingPrice.toFixed(2) : "0.00");

  useEffect(() => {
    if (!editing) {
      setDraft(Number.isFinite(sellingPrice) ? sellingPrice.toFixed(2) : "0.00");
    }
  }, [sellingPrice, editing]);

  const commit = () => {
    if (!onSellingPriceChange) {
      setEditing(false);
      return;
    }
    const val = parseFloat(draft);
    if (!Number.isNaN(val)) {
      onSellingPriceChange(val);
    }
    setEditing(false);
  };

  if (showTikTokDual && mcfData && fbtData) {
    return (
      <nav
        className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 animate-enter"
        aria-label="Profit summary"
      >
        <div className="bg-card/95 backdrop-blur border border-border rounded-xl shadow-elegant p-3 min-w-[500px]">
          {/* Header with Editable Selling Price */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              <span className="font-medium text-emerald-500">Profit Summary</span>
            </div>
            <div className="flex items-center gap-2">
              <DollarSign className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Selling</span>
              {onSellingPriceChange ? (
                editing ? (
                  <Input
                    type="number"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commit();
                      if (e.key === "Escape") { setEditing(false); setDraft(Number.isFinite(sellingPrice) ? sellingPrice.toFixed(2) : "0.00"); }
                    }}
                    step="0.01"
                    className="h-6 w-20 text-sm"
                    aria-label="Edit selling price"
                    autoFocus
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="font-semibold text-sm focus:outline-none hover:underline"
                    aria-label="Click to edit selling price"
                  >
                    ${fmt(sellingPrice).toFixed(2)}
                  </button>
                )
              ) : (
                <span className="font-semibold text-sm">${fmt(sellingPrice).toFixed(2)}</span>
              )}
            </div>
          </div>
          
          {/* Dual Profit Display */}
          <div className="grid grid-cols-2 gap-3">
            {/* Profit MCF */}
            <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
              <h3 className="text-emerald-700 dark:text-emerald-400 font-medium text-sm mb-2">Profit MCF</h3>
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Total Cost</span>
                  <span className="font-semibold text-sm">${fmt(mcfData.totalCost).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-emerald-700 dark:text-emerald-400">Profit</span>
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">${fmt(mcfData.profit).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-emerald-700 dark:text-emerald-400">Margin</span>
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">{fmt(mcfData.marginPercent).toFixed(1)}%</span>
                </div>
              </div>
            </div>

            {/* Profit FBT */}
            <div className="bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 rounded-lg p-3">
              <h3 className="text-violet-700 dark:text-violet-400 font-medium text-sm mb-2">Profit FBT</h3>
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Total Cost</span>
                  <span className="font-semibold text-sm">${fmt(fbtData.totalCost).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-violet-700 dark:text-violet-400">Profit</span>
                  <span className="font-bold text-violet-700 dark:text-violet-400">${fmt(fbtData.profit).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-violet-700 dark:text-violet-400">Margin</span>
                  <span className="font-bold text-violet-700 dark:text-violet-400">{fmt(fbtData.marginPercent).toFixed(1)}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>
    );
  }

  return (
    <nav
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 animate-enter"
      aria-label="Profit summary"
    >
      <div className="flex items-center gap-4 md:gap-6 rounded-full border border-border bg-card/95 backdrop-blur px-4 py-2 md:px-6 md:py-3 shadow-elegant">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs md:text-sm text-muted-foreground">Selling</span>
          {onSellingPriceChange ? (
            editing ? (
              <Input
                type="number"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") { setEditing(false); setDraft(Number.isFinite(sellingPrice) ? sellingPrice.toFixed(2) : "0.00"); }
                }}
                step="0.01"
                className="h-8 w-24"
                aria-label="Edit selling price"
                autoFocus
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="font-semibold focus:outline-none hover:underline"
                aria-label="Click to edit selling price"
              >
                ${fmt(sellingPrice).toFixed(2)}
              </button>
            )
          ) : (
            <span className="font-semibold">${fmt(sellingPrice).toFixed(2)}</span>
          )}
        </div>
        <div className="h-5 w-px bg-border/70" />
        <div className="flex items-center gap-2">
          <span className="text-xs md:text-sm text-muted-foreground">Cost</span>
          <span className="font-semibold">${fmt(totalCost).toFixed(2)}</span>
        </div>
        <div className="h-5 w-px bg-border/70" />
        <div className="flex items-center gap-2">
          <TrendingUp className={`h-4 w-4 ${positive ? "text-primary" : "text-destructive"}`} />
          <span className="text-xs md:text-sm text-muted-foreground">Profit</span>
          <span className={`font-semibold ${positive ? "text-primary" : "text-destructive"}`}>
            ${fmt(profit).toFixed(2)}
          </span>
        </div>
        <div className="h-5 w-px bg-border/70" />
        <div className="flex items-center gap-2">
          <span className="text-xs md:text-sm text-muted-foreground">Margin</span>
          <span className="font-semibold">{fmt(marginPercent).toFixed(1)}%</span>
        </div>
        {typeof tacosPercent === "number" && (
          <>
            <div className="h-5 w-px bg-border/70" />
            <div className="flex items-center gap-2">
              <span className="text-xs md:text-sm text-muted-foreground">TACOS</span>
              <span className="font-semibold">{fmt(tacosPercent).toFixed(1)}%</span>
            </div>
          </>
        )}
      </div>
    </nav>
  );
};

export default SummaryBar;