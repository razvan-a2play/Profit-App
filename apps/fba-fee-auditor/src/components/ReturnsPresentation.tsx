"use client";

import { useMemo } from "react";
import {
  Card, CardContent, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Button, cn,
} from "@platform/ui";
import { Printer, PanelsTopLeft } from "lucide-react";
import type { Decision } from "@/lib/returnsDecision";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const money2 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

interface Props {
  decisions: Decision[];
  threshold: number;
  feeCategory: string;
  windowLabel: string | null;
  onExit: () => void;
}

type Call = "switch" | "keep" | "exclude" | "immaterial";

/**
 * Executive view of the returnless decision — the same numbers as the working
 * dashboard with every input panel, filter and slider removed.
 *
 * Gross recovery and the returns-processing fee are shown as separate columns
 * on purpose. They scale off different denominators: recovery follows the
 * returnless refunds you actually switch, while the fee is charged across
 * EVERY refund on a SKU once switching pushes its rate past the category
 * threshold. Collapsing them into one net figure hides that.
 */
export function ReturnsPresentation({
  decisions, threshold, feeCategory, windowLabel, onExit,
}: Props) {
  const rows = useMemo(() => {
    return decisions
      .filter((d) => d.verdict !== "no_cogs" && d.totalRefunds >= 3 && d.returnlessRefunds > 0)
      .map((d) => {
        const gross = d.pnl?.inventorySaved ?? d.sellableRate * (d.cogs ?? 0) * d.returnlessRefunds;
        const fee = d.extraFeeIfSwitched;
        const disposal = d.pnl?.disposalCost ?? 0;
        const net = d.annualDelta;
        const call: Call =
          net < 0 ? "keep" : net >= 300 ? "switch" : fee > gross * 0.5 ? "exclude" : "immaterial";
        return { d, gross, fee, disposal, net, call };
      })
      .sort((a, b) => b.net - a.net);
  }, [decisions]);

  const t = useMemo(() => {
    const gross = rows.reduce((s, r) => s + r.gross, 0);
    const fee = rows.reduce((s, r) => s + r.fee, 0);
    const disposal = rows.reduce((s, r) => s + r.disposal, 0);
    const recovered = rows.reduce((s, r) => s + (r.d.pnl?.unitsRecovered ?? 0), 0);
    const scrapped = rows.reduce((s, r) => s + (r.d.pnl?.extraDisposals ?? 0), 0);
    const net = rows.reduce((s, r) => s + r.net, 0);
    const less = rows.reduce((s, r) => s + r.d.returnlessRefunds, 0);
    const tot = rows.reduce((s, r) => s + r.d.totalRefunds, 0);
    const sez = rows.filter((r) => r.d.sku.toUpperCase().startsWith("SEZ")).reduce((s, r) => s + r.net, 0);
    // Turning returnless off wholesale and excluding only the loss-makers beats
    // any single price threshold here: the SKUs worth keeping are among the
    // most expensive, so no price cut-off separates them.
    const winners = rows.filter((r) => r.net > 0);
    const captured = winners.reduce((s, r) => s + r.net, 0);
    return {
      gross, fee, disposal, recovered, scrapped, net, less, tot, sez,
      switchCount: rows.filter((r) => r.call === "switch").length,
      captured, winnerCount: winners.length,
    };
  }, [rows]);

  const keepers = rows.filter((r) => r.call === "keep" || r.call === "exclude");

  return (
    <div className="space-y-8 print:space-y-6">
      {/* ── masthead ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Decision brief · FBA returns policy
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Should we turn off Returnless Resolutions?
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {rows.length} SKUs with complete data · {t.tot.toLocaleString()} refunds a year ·{" "}
            {windowLabel ?? "trailing 365 days"}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-3.5 w-3.5" /> Print / PDF
          </Button>
          <Button size="sm" variant="outline" onClick={onExit}>
            <PanelsTopLeft className="mr-2 h-3.5 w-3.5" /> Back to working view
          </Button>
        </div>
      </div>

      {/* ── the recommendation ───────────────────────────────── */}
      <Card className="border-l-4 border-l-primary">
        <CardContent className="space-y-4 py-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            The recommendation
          </div>
          <h2 className="text-xl font-semibold tracking-tight">
            Turn Returnless Resolutions off
            {keepers.length > 0 && <>, excluding {keepers.map((k) => k.d.sku).join(" and ")}</>}.
          </h2>
          <ol className="space-y-2 text-sm">
            <li className="flex gap-3">
              <span className="font-mono font-bold text-primary">1</span>
              <span>
                In Seller Central → FBA returns settings, disable Returnless Resolutions. That switches{" "}
                <strong>{t.winnerCount} SKUs</strong> to return-required, worth{" "}
                <strong>{money(t.captured)}</strong> a year.
              </span>
            </li>
            {keepers.map((k) => (
              <li key={k.d.sku} className="flex gap-3">
                <span className="font-mono font-bold text-primary">·</span>
                <span>
                  Exclude <strong>{k.d.sku}</strong> — {k.call === "keep"
                    ? <>its returns-processing fee ({money2(k.fee / Math.max(1, k.d.totalRefunds))}/refund) exceeds
                       the {money2(k.gross / Math.max(1, k.d.returnlessRefunds))} we recover, a net loss of{" "}
                       {money(Math.abs(k.net))}/yr</>
                    : <>the fee eats {pct(k.fee / Math.max(k.gross, 1))} of the recovery, leaving only{" "}
                       {money(k.net)}/yr</>}.
                </span>
              </li>
            ))}
            <li className="flex gap-3">
              <span className="font-mono font-bold text-primary">·</span>
              <span>
                A single maximum-price rule will not work here — the SKUs worth keeping are among the most
                expensive, so no price cut-off separates them. Use per-SKU exclusions.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-mono font-bold text-primary">·</span>
              <span>
                Review the seasonal SKUs at the end of each season — see the condition below.
              </span>
            </li>
          </ol>
          <div className="flex flex-wrap items-baseline gap-3 border-t border-border pt-4">
            <span className="font-mono text-4xl font-semibold tracking-tight text-success">
              +{money(t.captured)}
            </span>
            <span className="text-sm text-muted-foreground">
              per year · one settings change · no headcount, no process change
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── the money ────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          The money
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Demand does not change: the same units ship and the same refunds are issued either way, so every
          revenue and fee line is identical.{" "}
          <strong className="text-foreground">Only two things move</strong> — how much stock we buy, and how
          many unsellable units we pay to dispose of.
        </p>
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>If we turn returnless off</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Effect on profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>
                  Refunds that switch to physical
                  <div className="text-xs text-muted-foreground">
                    currently written off in full
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{t.less.toLocaleString()}</TableCell>
                <TableCell className="text-right text-muted-foreground">&mdash;</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  Come back sellable &rarr; <strong>stock we stop buying</strong>
                  <div className="text-xs text-muted-foreground">
                    they go back on the shelf and serve the next order
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{t.recovered.toLocaleString()}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums text-success">
                  +{money(t.gross)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  Come back unsellable &rarr; <strong>disposal fees</strong>
                  <div className="text-xs text-muted-foreground">
                    measured from the FBA Removal Order Detail report
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{t.scrapped.toLocaleString()}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums text-warning">
                  &minus;{money(t.disposal)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  Returns-processing fee
                  <div className="text-xs text-muted-foreground">
                    SKUs pushed above the {(threshold * 100).toFixed(1)}% {feeCategory} threshold
                  </div>
                </TableCell>
                <TableCell className="text-right text-muted-foreground">&mdash;</TableCell>
                <TableCell className="text-right font-semibold tabular-nums text-warning">
                  &minus;{money(t.fee)}
                </TableCell>
              </TableRow>
              <TableRow className="bg-muted/50">
                <TableCell className="font-semibold">Net</TableCell>
                <TableCell></TableCell>
                <TableCell className="text-right text-lg font-semibold tabular-nums text-success">
                  {money(t.net)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ── per-SKU ──────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          By SKU
        </div>
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">COGS</TableHead>
                <TableHead className="text-right">Sellable</TableHead>
                <TableHead className="text-right">Returnless / yr</TableHead>
                <TableHead className="text-right">Recovery / refund</TableHead>
                <TableHead className="text-right">Stock saved</TableHead>
                <TableHead className="text-right">Disposal</TableHead>
                <TableHead className="text-right">Returns fee</TableHead>
                <TableHead className="text-right">Net / yr</TableHead>
                <TableHead>Call</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ d, gross, fee, disposal, net, call }) => (
                <TableRow key={d.sku}>
                  <TableCell className={cn("font-mono text-xs font-medium border-l-[3px]", STRIPE[call])}>
                    {d.sku}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money2(d.price)}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.cogs != null ? money2(d.cogs) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(d.sellableRate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.returnlessRefunds.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money2(gross / Math.max(1, d.returnlessRefunds))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(gross)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", disposal > 0 && "text-warning")}>
                    {disposal > 0 ? `−${money(disposal)}` : "—"}
                    {d.pnl?.disposalFeeEstimated && disposal > 0 && (
                      <span className="ml-1 text-[9px] text-muted-foreground">est</span>
                    )}
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums", fee > 0 && "text-warning")}>
                    {fee > 0 ? `−${money(fee)}` : "—"}
                  </TableCell>
                  <TableCell className={cn("text-right font-semibold tabular-nums", TONE[call])}>
                    {net < 0 ? `−${money(Math.abs(net))}` : money(net)}
                  </TableCell>
                  <TableCell>
                    <span className={cn("rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", PILL[call])}>
                      {LABEL[call]}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/50 font-semibold">
                <TableCell>Total</TableCell>
                <TableCell colSpan={3}></TableCell>
                <TableCell className="text-right tabular-nums">{t.less.toLocaleString()}</TableCell>
                <TableCell></TableCell>
                <TableCell className="text-right tabular-nums">{money(t.gross)}</TableCell>
                <TableCell className="text-right tabular-nums text-warning">−{money(t.disposal)}</TableCell>
                <TableCell className="text-right tabular-nums text-warning">−{money(t.fee)}</TableCell>
                <TableCell className="text-right tabular-nums text-success">{money(t.net)}</TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ── the condition ────────────────────────────────────── */}
      <Card className="border-l-4 border-l-warning bg-warning-light/30">
        <CardContent className="space-y-3 py-5 text-sm">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-warning">
            The condition
          </div>
          <h3 className="text-base font-semibold">
            {pct(t.sez / Math.max(t.captured, 1))} of the value assumes returned units replace units we would
            otherwise buy
          </h3>
          <p className="max-w-3xl text-muted-foreground">
            A recovered unit is worth its COGS only if it displaces a purchase. For the year-round SKUs that always
            holds. The seasonal SEZ SKUs are different — our September forecast shows them running{" "}
            <strong className="text-foreground">long on stock</strong>. If we are not reordering, a returned SEZ
            unit is not a saved purchase; it is inventory we did not want, arriving at the end of a season.
          </p>
          <div className="flex flex-wrap gap-6 pt-1">
            <div>
              <div className="text-xs text-muted-foreground">Returns displace a purchase</div>
              <div className="font-mono text-lg font-semibold text-success">{money(t.captured)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">SEZ returns worth nothing</div>
              <div className="font-mono text-lg font-semibold text-warning">{money(t.captured - t.sez)}</div>
            </div>
          </div>
          <p className="max-w-3xl text-muted-foreground">
            <strong className="text-foreground">Practical rule:</strong> switch the year-round SKUs permanently.
            Switch the seasonal ones during the buying window only, and revert at season end.
          </p>
        </CardContent>
      </Card>

      <div className="space-y-1.5 border-t border-border pt-5 text-xs text-muted-foreground">
        <p>
          <strong className="text-foreground">Sources.</strong> FBA Customer Returns report and Return Insights
          dashboard, US fulfilment centres only (Canadian FCs excluded). Landed COGS from the PNL calculator
          (manufacturing) and Inbound Pathfinder (CBM-weighted freight). Fees from the FBA Estimated Fees report.
          Returns-processing thresholds per Amazon&apos;s 2026 fee schedule, {feeCategory} at{" "}
          {(threshold * 100).toFixed(1)}%. Disposal fees are measured per SKU from the FBA Removal Order Detail
          report — what Amazon actually charged, not a rate-card lookup; rows marked <em>est</em> use the
          nearest size tier because that SKU has no disposal history.
        </p>
        <p>
          <strong className="text-foreground">Limitations.</strong> Where the realised average selling price is
          still generating, current list price is used. Landed COGS is manufacturing plus freight; no duty is payable
          on this catalogue. Returnless counts come from the Return Insights paste — the only source that includes
          returnless refunds, since they appear in no downloadable report.
        </p>
      </div>
    </div>
  );
}

const STRIPE: Record<Call, string> = {
  switch: "border-l-success",
  keep: "border-l-destructive",
  exclude: "border-l-muted-foreground/40",
  immaterial: "border-l-border",
};
const TONE: Record<Call, string> = {
  switch: "text-success",
  keep: "text-destructive",
  exclude: "",
  immaterial: "",
};
const PILL: Record<Call, string> = {
  switch: "bg-success/15 text-success",
  keep: "bg-destructive/15 text-destructive",
  exclude: "bg-muted text-muted-foreground",
  immaterial: "bg-muted text-muted-foreground",
};
const LABEL: Record<Call, string> = {
  switch: "Switch",
  keep: "Keep returnless",
  exclude: "Exclude",
  immaterial: "Immaterial",
};
