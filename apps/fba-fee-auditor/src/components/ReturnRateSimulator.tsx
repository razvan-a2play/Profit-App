"use client";

import { useMemo, useState } from "react";
import {
  Card, CardContent, CardHeader, CardTitle, Badge, Button,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn,
} from "@platform/ui";
import { TrendingDown } from "lucide-react";
import { expectedMargin, idealMargin, type Decision } from "@/lib/returnsDecision";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const money2 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

type Mode = "relative" | "absolute";

/**
 * "What if we cut the return rate?" — evaluates the lifecycle model at today's
 * rate and at a target rate, per SKU, and shows the annual difference.
 *
 * Storage is deliberately excluded: you'd hold the replacement unit anyway, so
 * it cancels out of the comparison.
 */
export function ReturnRateSimulator({ decisions }: { decisions: Decision[] }) {
  const [cut, setCut] = useState(20);          // % relative reduction
  const [absTarget, setAbsTarget] = useState(4.0); // absolute target rate %
  const [mode, setMode] = useState<Mode>("relative");

  const rows = useMemo(() => {
    return decisions
      .filter((d) => d.lifecycle && (d.lifecycle.annualUnits ?? 0) > 0)
      .map((d) => {
        const l = d.lifecycle!;
        const units = l.annualUnits ?? 0;
        const target =
          mode === "relative"
            ? l.returnRate * (1 - cut / 100)
            : Math.min(l.returnRate, absTarget / 100);

        const now = expectedMargin(l);
        const after = expectedMargin(l, { returnRate: target });
        const ideal = idealMargin(l);

        return {
          sku: d.sku,
          units,
          rateNow: l.returnRate,
          rateTarget: target,
          marginNow: now,
          marginAfter: after,
          dragNow: (ideal - now) * units,
          dragAfter: (ideal - after) * units,
          gain: (after - now) * units,
          returnsNow: Math.round(l.returnRate * units),
          returnsAfter: Math.round(target * units),
        };
      })
      .sort((a, b) => b.gain - a.gain);
  }, [decisions, cut, absTarget, mode]);

  const totals = rows.reduce(
    (a, r) => ({
      gain: a.gain + r.gain,
      dragNow: a.dragNow + r.dragNow,
      returnsSaved: a.returnsSaved + (r.returnsNow - r.returnsAfter),
    }),
    { gain: 0, dragNow: 0, returnsSaved: 0 },
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingDown className="h-4 w-4" /> What if we cut the return rate?
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Runs the full unit lifecycle at today&apos;s rate and at your target, per SKU. Storage is excluded —
              you&apos;d hold the replacement unit anyway.
            </p>
          </div>
          <Badge className="bg-success text-success-foreground">{money(totals.gain)}/yr</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4 rounded-md border border-border p-3">
          <div className="flex gap-1">
            <Button size="sm" variant={mode === "relative" ? "default" : "outline"} onClick={() => setMode("relative")}>
              Cut by %
            </Button>
            <Button size="sm" variant={mode === "absolute" ? "default" : "outline"} onClick={() => setMode("absolute")}>
              Target rate
            </Button>
          </div>

          {mode === "relative" ? (
            <div className="min-w-[240px] flex-1">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">Reduce returns by</span>
                <span className="text-sm font-semibold tabular-nums">{cut}%</span>
              </div>
              <input
                type="range" min={5} max={60} step={5} value={cut}
                onChange={(e) => setCut(Number(e.target.value))}
                className="mt-2 w-full accent-[hsl(var(--primary))]"
              />
            </div>
          ) : (
            <div className="min-w-[240px] flex-1">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">Target return rate</span>
                <span className="text-sm font-semibold tabular-nums">{absTarget.toFixed(1)}%</span>
              </div>
              <input
                type="range" min={1} max={8} step={0.25} value={absTarget}
                onChange={(e) => setAbsTarget(Number(e.target.value))}
                className="mt-2 w-full accent-[hsl(var(--primary))]"
              />
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            <div>
              Return drag today: <strong className="text-destructive">{money(totals.dragNow)}/yr</strong>
            </div>
            <div>
              {totals.returnsSaved.toLocaleString()} fewer returns →{" "}
              <strong className="text-success">{money(totals.gain)}/yr</strong>
            </div>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Needs the dashboard paste (for return rate) and COGS on each SKU.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Units / yr</TableHead>
                  <TableHead className="text-right">Rate now</TableHead>
                  <TableHead className="text-right">Target</TableHead>
                  <TableHead className="text-right">Returns saved</TableHead>
                  <TableHead className="text-right">Margin / unit</TableHead>
                  <TableHead className="text-right">Drag now</TableHead>
                  <TableHead className="text-right">Gain / yr</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.sku}>
                    <TableCell className="font-medium">{r.sku}</TableCell>
                    <TableCell className="text-right tabular-nums">{Math.round(r.units).toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{(r.rateNow * 100).toFixed(2)}%</TableCell>
                    <TableCell className="text-right tabular-nums text-success">
                      {(r.rateTarget * 100).toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(r.returnsNow - r.returnsAfter).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money2(r.marginNow)}
                      <span className="mx-1 text-muted-foreground">→</span>
                      <span className="text-success">{money2(r.marginAfter)}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-destructive">{money(r.dragNow)}</TableCell>
                    <TableCell className={cn("text-right font-semibold tabular-nums", r.gain > 0 && "text-success")}>
                      {money(r.gain)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">What the model traces</summary>
          <div className="mt-2 space-y-1 pl-4">
            <p>Every unit lands in one terminal state. Margin per unit is the probability-weighted sum:</p>
            <ul className="list-disc pl-4">
              <li>sold, never returned → <strong>+margin</strong></li>
              <li>returnless refund → <strong>−(FBA fee + refund admin + COGS)</strong></li>
              <li>physical, SELLABLE, resold → <strong>−fees + margin</strong> (re-earns contribution)</li>
              <li>physical, SELLABLE, returned again → <strong>−(2 × fees) − COGS</strong></li>
              <li>physical, CUSTOMER_DAMAGED → <strong>−(fees + COGS)</strong> + recovery if Grade &amp; Resell is on</li>
              <li>physical, DEFECTIVE → <strong>−(fees + COGS + disposal)</strong></li>
              <li>physical, CARRIER_DAMAGED → <strong>−fees</strong> (COGS reimbursed)</li>
            </ul>
            <p className="mt-1">
              Drag = (margin with zero returns − actual margin) × annual units. Cutting the rate shrinks every
              negative branch at once, which is why it beats the returnless switch on most SKUs.
            </p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
