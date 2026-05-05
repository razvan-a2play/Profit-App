/**
 * Performance optimization utilities
 */

import { useCallback, useRef } from 'react';

/**
 * Debounce hook for expensive operations
 */
export function useDebounce<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<NodeJS.Timeout>();

  return useCallback(
    ((...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        callback.apply(null, args);
      }, delay);
    }) as T,
    [callback, delay]
  );
}

/**
 * Throttle hook for frequent operations
 */
export function useThrottle<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const lastRan = useRef<number>(0);

  return useCallback(
    ((...args: Parameters<T>) => {
      if (Date.now() - lastRan.current >= delay) {
        callback.apply(null, args);
        lastRan.current = Date.now();
      }
    }) as T,
    [callback, delay]
  );
}

/**
 * Memoization utility for expensive calculations
 */
export class MemoCache<T> {
  private cache = new Map<string, { value: T; timestamp: number }>();
  private ttl: number;

  constructor(ttlMs: number = 5000) {
    this.ttl = ttlMs;
  }

  get(key: string): T | undefined {
    const cached = this.cache.get(key);
    if (!cached) return undefined;

    if (Date.now() - cached.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    return cached.value;
  }

  set(key: string, value: T): void {
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  clear(): void {
    this.cache.clear();
  }
}