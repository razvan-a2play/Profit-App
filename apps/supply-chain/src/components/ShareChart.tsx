"use client";

import { useState } from "react";
import { useWidth } from "./ui";
import type { PeriodSummary } from "@platform/supply-chain-data";
import { pct } from "@/lib/format";
import { periodLabel } from "@/lib/metrics";
import { niceMax } from "./CostChart";

const LINES = [
  { key: "supplyChainShareOfSales", label: "All supply-chain cost", color: "hsl(var(--foreground))" },
  { key: "storageShareOfSales", label: "Storage (FBA + AWD)", color: "#eb6834" },
] as const;

const PAD = { top: 12, right: 8, bottom: 28, left: 56 };

/** Cost as a share of net sales, month by month. One axis: both lines are percentages. */
export function ShareChart({ periods: months }: { periods: PeriodSummary[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [figRef, W] = useWidth<HTMLElement>(760);
  const H = W < 500 ? 180 : 200;
  const values = months.flatMap((m) => LINES.map((l) => m[l.key] ?? 0));
  const max = niceMax(Math.max(0.01, ...values));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(months.length, 1);
  // Labels need about 44px each; past that, label every nth period, counted
  // back from the newest so the latest is always labelled and never crowded.
  const labelEvery = Math.max(1, Math.ceil(44 / slot));
  const showLabel = (i: number) => (months.length - 1 - i) % labelEvery === 0;
  const x = (i: number) => PAD.left + slot * i + slot / 2;
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, 0.5, 1].map((t) => t * max);

  return (
    <figure ref={figRef} className="relative">
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {LINES.map((l) => (
          <span key={l.key} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Supply-chain and storage cost as a share of net sales">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="hsl(var(--border))" />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px]">
              {pct(t, 0)}
            </text>
          </g>
        ))}
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
        )}
        {LINES.map((l) => {
          // A month without both halves of the cost has no share: break the line there rather than dip to zero.
          const segs: string[] = [];
          let cur = "";
          months.forEach((m, i) => {
            const v = m[l.key];
            if (v == null) {
              if (cur) segs.push(cur);
              cur = "";
            } else cur += `${cur ? "L" : "M"}${x(i)},${y(v)}`;
          });
          if (cur) segs.push(cur);
          return (
            <g key={l.key}>
              {segs.map((d) => (
                <path key={d} d={d} fill="none" stroke={l.color} strokeWidth={2} strokeLinejoin="round" />
              ))}
              {months.map((m, i) =>
                m[l.key] != null ? (
                  <circle key={m.key} cx={x(i)} cy={y(m[l.key]!)} r={hover === i ? 4.5 : 3} fill={l.color} stroke="hsl(var(--background))" strokeWidth={2} />
                ) : null,
              )}
            </g>
          );
        })}
        {months.map((m, i) => (
          <g key={m.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={x(i) - slot / 2} y={PAD.top} width={slot} height={innerH} fill="transparent" />
            <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
              {showLabel(i) ? periodLabel(m.key, m.granularity) : null}
            </text>
          </g>
        ))}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute top-8 z-10 w-52 -translate-x-1/2 rounded-md border border-border bg-popover p-3 text-xs shadow-md"
          style={{ left: `${Math.min(Math.max((x(hover) / W) * 100, 15), 85)}%` }}
        >
          <div className="mb-1 font-medium text-foreground">{periodLabel(months[hover].key, months[hover].granularity, true)}</div>
          {LINES.map((l) => (
            <div key={l.key} className="flex justify-between gap-3 py-0.5">
              <span className="text-muted-foreground">{l.label}</span>
              <span className="tabular-nums text-foreground">{pct(months[hover][l.key])}</span>
            </div>
          ))}
          {months[hover].storageShareOfSales == null && (
            <p className="mt-1 text-muted-foreground">No share until the month&apos;s storage is invoiced.</p>
          )}
        </div>
      )}
    </figure>
  );
}
