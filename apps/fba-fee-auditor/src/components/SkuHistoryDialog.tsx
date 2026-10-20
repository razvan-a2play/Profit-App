"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
  cn,
} from "@platform/ui";
import { Loader2 } from "lucide-react";
import type { SkuHistory, WeeklyMeasurement } from "@/lib/measurementHistory";

const DIM_TOL = 0.5; // inches
const WT_TOL = 0.1; // lb

const n1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));
const n2 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2));

function dimsDiffer(w: WeeklyMeasurement, ours: SkuHistory["ours"]): boolean {
  if (!ours) return false;
  const pairs: [number | null, number | null][] = [
    [w.amazonLongestIn, ours.longestIn],
    [w.amazonMedianIn, ours.medianIn],
    [w.amazonShortestIn, ours.shortestIn],
  ];
  const dim = pairs.some(([a, b]) => a != null && b != null && Math.abs(a - b) > DIM_TOL);
  const wt =
    w.amazonWeightLb != null && ours.weightLb != null && Math.abs(w.amazonWeightLb - ours.weightLb) > WT_TOL;
  return dim || wt;
}

export function SkuHistoryDialog({ sku, onClose }: { sku: string | null; onClose: () => void }) {
  const [data, setData] = useState<SkuHistory | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sku) {
      setData(null);
      return;
    }
    setLoading(true);
    fetch(`/api/history?sku=${encodeURIComponent(sku)}`)
      .then((r) => r.json())
      .then((d: SkuHistory) => setData(d))
      .catch(() => setData({ available: false, sku, ours: null, weeks: [] }))
      .finally(() => setLoading(false));
  }, [sku]);

  const ours = data?.ours ?? null;

  return (
    <Dialog open={!!sku} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Measurement history — {sku}</DialogTitle>
          <DialogDescription>
            Weekly average of Amazon&apos;s measured dimensions vs your box. A flagged week means Amazon&apos;s
            average differs from your measurements beyond tolerance.
          </DialogDescription>
        </DialogHeader>

        {ours && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            <span className="font-medium">Your box:</span>{" "}
            {n1(ours.longestIn)} × {n1(ours.medianIn)} × {n1(ours.shortestIn)} in · {n2(ours.weightLb)} lb
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
          </div>
        ) : !data?.available ? (
          <p className="py-6 text-sm text-muted-foreground">
            Measurement history isn&apos;t set up yet — run the <code>fba_measurement_snapshots</code> migration, then
            run audits over time to build weekly history.
          </p>
        ) : data.weeks.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No snapshots recorded for this SKU yet — run a live audit to capture Amazon&apos;s current measurement.
          </p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Week of</TableHead>
                  <TableHead className="text-right">Obs</TableHead>
                  <TableHead className="text-right">Amazon L×M×S (in, avg)</TableHead>
                  <TableHead className="text-right">Wt (lb)</TableHead>
                  <TableHead className="text-right">Fee</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>vs you</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.weeks.map((w) => {
                  const differ = dimsDiffer(w, ours);
                  return (
                    <TableRow key={w.weekStart}>
                      <TableCell className="font-medium">{w.weekStart}</TableCell>
                      <TableCell className="text-right tabular-nums">{w.observations}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {n1(w.amazonLongestIn)} × {n1(w.amazonMedianIn)} × {n1(w.amazonShortestIn)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{n2(w.amazonWeightLb)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {w.amazonFee == null ? "—" : `$${w.amazonFee.toFixed(2)}`}
                      </TableCell>
                      <TableCell className="text-xs">{w.amazonSizeTier ?? "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            differ ? "border-warning/50 text-warning" : "border-success/40 text-success",
                          )}
                        >
                          {differ ? "Δ differs" : "matches"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
