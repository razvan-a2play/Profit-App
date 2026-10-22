"use client";

import { buildScorecard, type MatchedMeasures, type PeriodSummary, type ScoreRow } from "@platform/supply-chain-data";
import { monthLabel } from "@/lib/format";
import { METRICS, formatChange } from "@/lib/metrics";
import { DeltaArrow, TONE } from "./ui";

const GOOD = TONE.good;
const BAD = TONE.bad;

const VERDICT: Record<ScoreRow["verdict"], { text: string; color?: string }> = {
  improving: { text: "Improving", color: GOOD },
  worse: { text: "Worse", color: BAD },
  holding: { text: "Holding" },
  unknown: { text: "Not enough data" },
};

/**
 * The manager's report card: the measures they move, this period against the
 * comparison, each with its monthly history so a verdict can be told from a blip.
 */
export function Scorecard({
  current,
  base,
  currentName,
  baseName,
  history,
  exclude = [],
  matched = {},
}: {
  current: PeriodSummary;
  base: PeriodSummary | null;
  currentName: string;
  baseName: string | null;
  /** Every month, oldest first, for the trend lines. */
  history: PeriodSummary[];
  /** Measures that don't apply here (e.g. AWD in Canada): left out, not shown as missing. */
  exclude?: string[];
  /** Measures compared on only the months both periods have them. */
  matched?: MatchedMeasures;
}) {
  const built = buildScorecard(current, base, matched);
  const rows = built.rows.filter((r) => !exclude.includes(r.measure.key));
  const n = (v: string) => rows.filter((r) => r.verdict === v).length;
  const card = { ...built, rows, improving: n("improving"), worse: n("worse"), holding: n("holding"), measured: rows.length - n("unknown") };

  return (
    <div>
      <p className="mb-1 text-lg">
        {card.measured === 0 ? (
          <span className="text-muted-foreground">
            No comparison yet: {baseName ? `${baseName} has no data for these measures.` : "the comparison period has not been read."}
          </span>
        ) : (
          <>
            <span className="font-semibold" style={{ color: GOOD }}>{card.improving} improving</span>
            <span className="text-muted-foreground">, </span>
            <span className="font-semibold" style={{ color: card.worse ? BAD : undefined }}>{card.worse} worse</span>
            <span className="text-muted-foreground">, {card.holding} holding — of {card.measured} measures with data for both periods.</span>
          </>
        )}
      </p>
      {card.balance && <p className="mb-3 text-sm">{card.balance}</p>}
      <div className="mt-3 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Measure</th>
              <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">{currentName}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">{baseName ?? "Comparison"}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Change</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Verdict</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Monthly trend</th>
            </tr>
          </thead>
          <tbody>
            {card.rows.map((r) => {
              const m = METRICS[r.measure.key];
              const v = VERDICT[r.verdict];
              return (
                <tr key={r.measure.key} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.measure.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.measure.lever}
                      {r.measure.partlyExternal ? " · partly set by Amazon's rates and product mix" : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {m.format(r.current)}
                    {r.months ? (
                      <span className="block text-xs text-muted-foreground" title="Compared on the months both periods have this measure">
                        {span(r.months)} only
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-muted-foreground">{m.format(r.base)}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatChange(r.change, r.measure.change) || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-medium" style={{ color: v.color ?? TONE.muted }}>
                    {r.verdict === "improving" ? <DeltaArrow dir="up" /> : r.verdict === "worse" ? <DeltaArrow dir="down" /> : null}
                    {v.text}
                  </td>
                  <td className="px-3 py-2">
                    <Sparkline values={history.map((p) => p[r.measure.key] as number | null)} labels={history.map((p) => p.key)} format={m.format} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** "May–Sep" for a run of months, "5 months" for a broken set. */
function span(months: string[]): string {
  const [y0, m0] = months[0].split("-").map(Number);
  const [y1, m1] = months[months.length - 1].split("-").map(Number);
  const run = (y1 - y0) * 12 + (m1 - m0) + 1 === months.length;
  const short = (m: string) => monthLabel(m).split(" ")[0];
  return run ? `${short(months[0])}–${short(months[months.length - 1])}` : `${months.length} months`;
}

const SW = 140;
const SH = 30;

/** One measure over the months. Gaps where a month has no figure, rather than a dip to zero. */
function Sparkline({ values, labels, format }: { values: Array<number | null>; labels: string[]; format: (v: number | null) => string }) {
  const known = values.filter((v): v is number => v != null);
  if (known.length < 2) return <span className="text-xs text-muted-foreground">building up</span>;
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min || 1;
  const x = (i: number) => 3 + (i / Math.max(values.length - 1, 1)) * (SW - 6);
  const y = (v: number) => SH - 4 - ((v - min) / span) * (SH - 8);
  const segs: string[] = [];
  let cur = "";
  values.forEach((v, i) => {
    if (v == null) {
      if (cur) segs.push(cur);
      cur = "";
    } else cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (cur) segs.push(cur);
  const lastIdx = values.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).at(-1)!;
  const firstIdx = values.findIndex((v) => v != null);
  return (
    <svg width={SW} height={SH} role="img" aria-label={`From ${format(values[firstIdx])} in ${labels[firstIdx]} to ${format(values[lastIdx])} in ${labels[lastIdx]}`}>
      <title>{`${labels[firstIdx]} ${format(values[firstIdx])} → ${labels[lastIdx]} ${format(values[lastIdx])}`}</title>
      {segs.map((d) => (
        <path key={d} d={d} fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeLinejoin="round" />
      ))}
      <circle cx={x(lastIdx)} cy={y(values[lastIdx]!)} r={3} fill="hsl(var(--foreground))" />
    </svg>
  );
}
