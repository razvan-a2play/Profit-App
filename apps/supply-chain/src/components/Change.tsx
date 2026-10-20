"use client";

import { pctChange, ppChange, type PeriodSummary } from "@platform/supply-chain-data";
import { formatChange, type Metric } from "@/lib/metrics";
import { DeltaArrow, TONE } from "./ui";

export function changeOf(metric: Metric, cur: PeriodSummary, base: PeriodSummary | null): number | null {
  if (!base) return null;
  const a = cur[metric.key] as number | null;
  const b = base[metric.key] as number | null;
  return metric.change === "pp" ? ppChange(a, b) : pctChange(a, b);
}

/** A change with its direction drawn and its sign written, so colour is never the only signal. */
export function Change({ metric, value, suffix }: { metric: Metric; value: number | null; suffix?: string }) {
  if (value == null) return null;
  const up = value > 0;
  const flat = Math.abs(value) < 0.0005;
  const tone = flat || metric.better === 0 ? TONE.muted : (up ? 1 : -1) === metric.better ? TONE.good : TONE.bad;
  const verdict = flat || metric.better === 0 ? "" : (up ? 1 : -1) === metric.better ? ", better" : ", worse";
  return (
    <span className="whitespace-nowrap text-xs tabular-nums" style={{ color: tone }}>
      <DeltaArrow dir={flat ? "flat" : up ? "up" : "down"} />
      {formatChange(value, metric.change)}
      <span className="sr-only">{verdict}</span>
      {suffix ? <span className="text-muted-foreground"> {suffix}</span> : null}
    </span>
  );
}
