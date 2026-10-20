"use client";

import { useState } from "react";
import type { Change as Changes, PeriodSummary } from "@platform/supply-chain-data";
import { cn } from "@platform/ui";
import { METRICS, VIEWS, periodLabel, type Metric } from "@/lib/metrics";
import { Change, changeOf } from "./Change";
import { Segmented } from "./ui";

export type CompareTo = "prev" | "yoy";

/** One row per period, the chosen group of metrics, each with its change against the comparison. */
export function PeriodTable({
  periods,
  changes,
  compare,
  selected,
  onSelect,
  scanning,
  heliumMonths,
  unavailableMonths,
}: {
  periods: PeriodSummary[];
  changes: Map<string, Changes>;
  compare: CompareTo;
  selected: string | null;
  onSelect: (key: string) => void;
  /** Month currently being read, if any. */
  scanning: string | null;
  /** Months whose figures come from Helium 10 (totals only). */
  heliumMonths: Set<string>;
  /** Months no source has. */
  unavailableMonths: Set<string>;
}) {
  const [view, setView] = useState<keyof typeof VIEWS>("costs");
  const metrics = VIEWS[view].map((k) => METRICS[k]);
  const rows = [...periods].reverse();

  return (
    <div>
      <Segmented
        label="Measures shown"
        value={view}
        onChange={setView}
        options={[
          ["costs", "Costs"],
          ["inventory", "Inventory"],
          ["kpis", "KPIs"],
        ]}
        className="mb-3 w-full sm:w-fit"
      />
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="sticky left-0 bg-muted px-3 py-2 text-left font-medium">
                Period
              </th>
              {metrics.map((m) => (
                <th key={m.key} scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap" title={m.help}>
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const base = changes.get(p.key)?.[compare] ?? null;
              const unread = p.feeMonths < p.months.length;
              const isSel = selected === p.key;
              return (
                <tr
                  key={p.key}
                  // The row is a convenience for the pointer; the button in the
                  // first cell is the real control.
                  onClick={() => onSelect(p.key)}
                  className={cn("cursor-pointer border-t border-border hover:bg-muted/60", isSel && "bg-primary-light")}
                >
                  <th
                    scope="row"
                    className={cn("sticky left-0 px-1 py-1 text-left align-top font-normal whitespace-nowrap", isSel ? "bg-primary-light" : "bg-background")}
                  >
                    <button
                      type="button"
                      aria-pressed={isSel}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(p.key);
                      }}
                      className="min-h-11 w-full rounded px-2 py-1 text-left sm:min-h-0"
                    >
                      <span className="block font-medium">
                        {periodLabel(p.key, p.granularity, true)}
                        {p.toDate ? <span className="font-normal text-muted-foreground"> to date</span> : null}
                        {p.granularity === "quarter" && p.months.length < 3 ? (
                          <span className="font-normal text-muted-foreground"> ({p.months.length} of 3 months)</span>
                        ) : null}
                      </span>
                      <PeriodNote p={p} view={view} unread={unread} scanning={scanning} heliumMonths={heliumMonths} unavailableMonths={unavailableMonths} />
                    </button>
                  </th>
                  {metrics.map((m) => (
                    <td key={m.key} className="px-3 py-2 text-right align-top tabular-nums whitespace-nowrap">
                      <div>{m.format(p[m.key] as number | null)}</div>
                      <Change metric={m} value={changeOf(m, p, base)} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Definitions metrics={metrics} />
    </div>
  );
}

function PeriodNote({
  p,
  view,
  unread,
  scanning,
  heliumMonths,
  unavailableMonths,
}: {
  p: PeriodSummary;
  view: string;
  unread: boolean;
  scanning: string | null;
  heliumMonths: Set<string>;
  unavailableMonths: Set<string>;
}) {
  const note = p.months.every((m) => unavailableMonths.has(m))
    ? "no data: before Amazon's 730-day window"
    : unread && view === "costs"
      ? p.months.includes(scanning ?? "")
        ? "reading from Amazon…"
        : `${p.feeMonths} of ${p.months.length} months read`
      : p.months.some((m) => heliumMonths.has(m))
        ? p.months.every((m) => heliumMonths.has(m))
          ? "Helium 10 totals; no storage"
          : "partly Helium 10 totals"
        : null;
  return note ? <span className="block text-xs text-muted-foreground">{note}</span> : null;
}

/**
 * What each column means, as text anyone can reach — keyboard, touch and
 * screen reader — rather than a hover tooltip only a mouse can open.
 */
export function Definitions({ metrics }: { metrics: Metric[] }) {
  const defined = metrics.filter((m) => m.help);
  if (!defined.length) return null;
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">What these measures mean</summary>
      <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {defined.map((m) => (
          <div key={m.key}>
            <dt className="font-medium">{m.label}</dt>
            <dd className="text-muted-foreground">{m.help}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
