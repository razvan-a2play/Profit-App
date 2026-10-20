"use client";

import { useState } from "react";
import { useWidth } from "./ui";
import type { PeriodSummary } from "@platform/supply-chain-data";
import { money, pct } from "@/lib/format";
import { periodLabel } from "@/lib/metrics";

// Categorical slots 1-4 of the validated reference palette, in fixed order.
export const SERIES = [
  { key: "fulfilment", label: "FBA fulfilment", color: "#2a78d6" },
  { key: "fbaStorage", label: "FBA storage", color: "#eb6834" },
  { key: "awd", label: "AWD", color: "#1baf7a" },
  { key: "other", label: "Inbound & removals", color: "#eda100" },
] as const;

type Key = (typeof SERIES)[number]["key"];

export function costParts(p: PeriodSummary): Record<Key, number> {
  return {
    fulfilment: p.fulfilmentFees ?? 0,
    fbaStorage: (p.fbaStorage ?? 0) + (p.agedSurcharge ?? 0),
    awd: (p.awdStorage ?? 0) + (p.awdHandling ?? 0),
    other: (p.fbaInbound ?? 0) + (p.removals ?? 0),
  };
}

const total = (p: PeriodSummary) => Object.values(costParts(p)).reduce((a, b) => a + b, 0);

const PAD = { top: 12, right: 8, bottom: 28, left: 56 };

/**
 * Supply-chain cost per period, stacked by where it went. With a comparison,
 * a tick on each bar marks what the comparison period cost in total.
 */
export function CostChart({
  periods: months,
  bases,
  baseLabel,
}: {
  periods: PeriodSummary[];
  bases?: Array<PeriodSummary | null>;
  baseLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [figRef, W] = useWidth<HTMLElement>(760);
  const H = W < 500 ? 220 : 260;
  const totals = months.map(total);
  const baseTotals = (bases ?? []).map((b) => (b && b.fulfilmentFees != null ? total(b) : null));
  const max = niceMax(Math.max(1, ...totals, ...baseTotals.map((v) => v ?? 0)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(months.length, 1);
  // Labels need about 44px each; past that, label every nth period, counted
  // back from the newest so the latest is always labelled and never crowded.
  const labelEvery = Math.max(1, Math.ceil(44 / slot));
  const showLabel = (i: number) => (months.length - 1 - i) % labelEvery === 0;
  const barW = Math.min(36, slot * 0.6);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);

  return (
    <figure ref={figRef} className="relative">
      <Legend baseLabel={bases ? baseLabel : undefined} />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Supply-chain cost per month by component">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="hsl(var(--border))" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px]">
              {money(t)}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const parts = costParts(m);
          const cx = PAD.left + slot * i + slot / 2;
          let acc = 0;
          const segs = SERIES.map((s) => {
            const v = parts[s.key];
            const y0 = y(acc);
            acc += v;
            return { ...s, v, top: y(acc), bottom: y0 };
          }).filter((s) => s.v > 0);
          return (
            <g key={m.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* Hit target: the whole column, not just the bar. */}
              <rect x={cx - slot / 2} y={PAD.top} width={slot} height={innerH} fill="transparent" />
              {segs.map((s, j) => {
                const isTop = j === segs.length - 1;
                // 2px surface gap between stacked fills.
                const h = Math.max(0, s.bottom - s.top - (j > 0 ? 2 : 0));
                return isTop ? (
                  <path key={s.key} d={roundedTop(cx - barW / 2, s.top, barW, h, 4)} fill={s.color} opacity={hover == null || hover === i ? 1 : 0.45} />
                ) : (
                  <rect key={s.key} x={cx - barW / 2} y={s.top} width={barW} height={h} fill={s.color} opacity={hover == null || hover === i ? 1 : 0.45} />
                );
              })}
              {baseTotals[i] != null && (
                <line
                  x1={cx - barW / 2 - 4}
                  x2={cx + barW / 2 + 4}
                  y1={y(baseTotals[i]!)}
                  y2={y(baseTotals[i]!)}
                  stroke="hsl(var(--foreground))"
                  strokeWidth={2}
                />
              )}
              <text x={cx} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                {showLabel(i) ? periodLabel(m.key, m.granularity) : null}
              </text>
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <Tooltip
          m={months[hover]}
          total={totals[hover]}
          base={baseTotals[hover]}
          baseLabel={baseLabel}
          left={(PAD.left + slot * hover + slot / 2) / W}
        />
      )}
    </figure>
  );
}

function Tooltip({
  m,
  total,
  base,
  baseLabel,
  left,
}: {
  m: PeriodSummary;
  total: number;
  base: number | null;
  baseLabel?: string;
  left: number;
}) {
  const parts = costParts(m);
  return (
    <div
      className="pointer-events-none absolute top-8 z-10 w-56 -translate-x-1/2 rounded-md border border-border bg-popover p-3 text-xs shadow-md"
      style={{ left: `${Math.min(Math.max(left * 100, 15), 85)}%` }}
    >
      <div className="mb-2 font-medium text-foreground">{periodLabel(m.key, m.granularity, true)}</div>
      {SERIES.map((s) => (
        <div key={s.key} className="flex items-center justify-between gap-3 py-0.5">
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
          <span className="tabular-nums text-foreground">{money(parts[s.key])}</span>
        </div>
      ))}
      <div className="mt-2 flex justify-between border-t border-border pt-2 text-foreground">
        <span>Total</span>
        <span className="tabular-nums">{money(total)}</span>
      </div>
      <div className="flex justify-between text-muted-foreground">
        <span>Share of net sales</span>
        <span className="tabular-nums">{pct(m.supplyChainShareOfSales)}</span>
      </div>
      {base != null && (
        <div className="flex justify-between text-muted-foreground">
          <span>{baseLabel}</span>
          <span className="tabular-nums">{money(base)}</span>
        </div>
      )}
      {(m.fbaStorage == null || m.awdStorage == null) && (
        <p className="mt-2 text-muted-foreground">Storage not invoiced yet for this period.</p>
      )}
    </div>
  );
}

function Legend({ baseLabel }: { baseLabel?: string }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {baseLabel && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3" style={{ background: "hsl(var(--foreground))" }} />
          {baseLabel}
        </span>
      )}
      {SERIES.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

export function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
