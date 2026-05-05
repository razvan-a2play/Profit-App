import { useEffect, useRef } from 'react';
import { logger } from "@platform/calc";

interface PerformanceMetrics {
  componentName: string;
  renderTime: number;
  renderCount: number;
}

/**
 * Performance monitoring hook for development
 * Tracks component render times and counts
 */
export function usePerformanceMonitor(componentName: string, enabled: boolean = process.env.NODE_ENV !== "production") {
  const renderCount = useRef(0);
  const startTime = useRef<number>(0);
  const metrics = useRef<PerformanceMetrics>({
    componentName,
    renderTime: 0,
    renderCount: 0
  });

  if (enabled) {
    startTime.current = performance.now();
  }

  useEffect(() => {
    if (enabled) {
      const endTime = performance.now();
      const renderTime = endTime - startTime.current;
      renderCount.current += 1;
      
      metrics.current = {
        componentName,
        renderTime,
        renderCount: renderCount.current
      };

      // Warn about slow renders (> 16ms for 60fps)
      if (renderTime > 16) {
        logger.warn(`Slow render detected in ${componentName}`, {
          renderTime: `${renderTime.toFixed(2)}ms`,
          renderCount: renderCount.current,
          threshold: '16ms (60fps)'
        });
      }

      // Warn about excessive re-renders
      if (renderCount.current > 10) {
        logger.warn(`High render count in ${componentName}`, {
          renderCount: renderCount.current,
          averageRenderTime: `${(renderTime / renderCount.current).toFixed(2)}ms`
        });
      }
    }
  });

  return {
    renderCount: renderCount.current,
    averageRenderTime: metrics.current.renderTime / Math.max(renderCount.current, 1)
  };
}

/**
 * Performance optimization checker
 * Analyzes calculation complexity and suggests optimizations
 */
export function analyzeCalculationComplexity(
  calculationName: string, 
  inputCount: number, 
  operationCount: number
) {
  const complexity = inputCount * operationCount;
  
  if (complexity > 1000) {
    logger.warn(`High calculation complexity detected`, {
      calculation: calculationName,
      complexity,
      suggestion: 'Consider memoization or result caching'
    });
  }

  return {
    complexity,
    isOptimal: complexity <= 100,
    needsOptimization: complexity > 1000
  };
}