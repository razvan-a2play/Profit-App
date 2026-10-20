"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@platform/ui";

/** Ink for a change, from the tokens in globals.css. */
export const TONE = {
  good: "hsl(var(--good))",
  bad: "hsl(var(--bad))",
  muted: "hsl(var(--muted-foreground))",
} as const;

/**
 * Which way a figure moved, drawn rather than typed: a glyph renders in
 * whatever font the system substitutes, at whatever weight it likes.
 */
export function DeltaArrow({ dir }: { dir: "up" | "down" | "flat" }) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" className="mr-1 inline-block align-[0.05em]">
      {dir === "up" && <path d="M4 0.5 L7.5 7 H0.5 Z" fill="currentColor" />}
      {dir === "down" && <path d="M4 7.5 L7.5 1 H0.5 Z" fill="currentColor" />}
      {dir === "flat" && <path d="M0.5 4 H6 M4.5 2 L6.5 4 L4.5 6" stroke="currentColor" strokeWidth="1.3" fill="none" />}
    </svg>
  );
}

/**
 * A row of mutually exclusive options. Announces its name and which option is
 * on (aria-pressed), and grows to a 44px target on touch-sized screens while
 * staying compact where a pointer is precise.
 */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, React.ReactNode]>;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex rounded-md border border-border p-0.5 text-sm", className)}>
      {options.map(([v, text]) => {
        const on = v === value;
        return (
          <button
            key={String(v)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(v)}
            className={cn(
              "min-h-11 flex-1 whitespace-nowrap rounded px-3 sm:min-h-0 sm:flex-none sm:py-1",
              on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The rendered width of an element, kept current. Charts draw at this width
 * instead of scaling a fixed drawing, so 11px labels stay 11px on a phone.
 */
export function useWidth<T extends HTMLElement>(initial: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  // Measured once before paint, then on every resize. The observer alone is
  // not enough: a page opened in a background tab gets no observer callbacks
  // until it draws, and would keep the fallback width until then.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (w: number) => setWidth(Math.max(280, Math.round(w)));
    measure(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}
