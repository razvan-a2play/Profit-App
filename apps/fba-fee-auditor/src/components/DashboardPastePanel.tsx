"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  cn,
} from "@platform/ui";
import {
  ClipboardPaste,
  Loader2,
  CheckCircle2,
  Trash2,
  AlertCircle,
  ExternalLink,
  Info,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

interface PastedRow {
  asin: string;
  returnUnits: number;
  returnRatePct?: number;
}

interface PasteState {
  present: boolean;
  pastedAt?: string;
  asinCount?: number;
  totalUnits?: number;
  unparsedSample?: string[];
  rows?: PastedRow[];
}

export function DashboardPastePanel({ onChanged }: { onChanged?: () => void }) {
  const [state, setState] = useState<PasteState>({ present: false });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/uploads/dashboard-paste");
    setState(await res.json());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = useCallback(
    async (append: boolean) => {
      if (!text.trim()) return toast.error("Paste a page of the dashboard table first.");
      setBusy(true);
      try {
        const res = await fetch("/api/uploads/dashboard-paste", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, append }),
        });
        const body = await res.json();
        if (body.error) throw new Error(body.error);
        toast.success(
          append
            ? `Added ${body.addedThisPaste} ASINs from this page — ${body.asinCount} total, ${body.totalUnits.toLocaleString()} units.`
            : `Parsed ${body.asinCount} ASINs · ${body.totalUnits.toLocaleString()} total return units.`,
        );
        setText("");
        await refresh();
        onChanged?.();
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [text, refresh, onChanged],
  );

  const clear = useCallback(async () => {
    await fetch("/api/uploads/dashboard-paste", { method: "DELETE" });
    toast.success("Cleared pasted dashboard data.");
    await refresh();
    onChanged?.();
  }, [refresh, onChanged]);

  return (
    <Card className={cn(state.present ? "border-success/40" : "border-warning/50")}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardPaste className="h-4 w-4" />
              Step 1 — Paste Amazon&apos;s Return Insights table
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Required for accurate returnless counts. Amazon has <strong>no CSV export</strong> for this page, and no
              SP-API report contains returnless refunds — so this paste is the only way to get the real numbers.
            </p>
          </div>
          {state.present ? (
            <Badge className="bg-success text-success-foreground">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Data loaded
            </Badge>
          ) : (
            <Badge className="bg-warning text-warning-foreground">
              <AlertCircle className="mr-1 h-3 w-3" />
              Not yet pasted
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Why this is needed ─────────────────────────────────── */}
        <div className="rounded-md border border-info/30 bg-info-light/40 p-3 text-xs">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">Why we need the paste</p>
              <p>
                Amazon&apos;s <strong>FBA Customer Returns report</strong> (available via API) only contains units that{" "}
                <strong>physically arrived at a fulfillment center</strong>. Returnless refunds never reach an FC, so
                they appear in <em>no</em> SP-API report — only on the dashboard.
              </p>
              <p className="font-mono text-[11px] bg-background/60 rounded px-2 py-1 mt-1">
                returnless = dashboard_total − FBA_returns_report
              </p>
              <p>
                Without the paste, the app undercounts your returnless refunds by roughly <strong>65%</strong> and
                understates the savings opportunity by the same margin.
              </p>
            </div>
          </div>
        </div>

        {/* ── Step-by-step instructions ──────────────────────────── */}
        <div className="rounded-md border border-border p-3">
          <button
            onClick={() => setShowHelp((v) => !v)}
            className="flex w-full items-center justify-between text-sm font-medium"
          >
            <span>How to copy the table (click to {showHelp ? "hide" : "show"})</span>
            <span className="text-xs text-muted-foreground">{showHelp ? "▲" : "▼"}</span>
          </button>
          {showHelp && (
            <ol className="mt-3 space-y-2 pl-5 text-xs list-decimal marker:text-muted-foreground">
              <li>
                Open{" "}
                <a
                  href="https://sellercentral.amazon.com/returns-insights/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  Returns &amp; Recovery: Insights and Opportunities
                  <ExternalLink className="h-3 w-3" />
                </a>{" "}
                (or: Seller Central menu → <strong>Reports</strong> → <strong>Returns &amp; Recovery</strong>).
              </li>
              <li>
                Set <strong>Time period = 365 days</strong>, Marketplace = <strong>United States</strong>, Fulfillment ={" "}
                <strong>Amazon &amp; Merchant Fulfilled</strong>.
              </li>
              <li>
                Scroll to the <strong>&quot;Return insights and suggested actions&quot;</strong> table.
              </li>
              <li>
                If there&apos;s a <strong>rows-per-page</strong> selector at the bottom of the table, set it to the
                highest value (100) — fewer pages to copy.
              </li>
              <li>
                Select the visible table rows: click just above the first row and{" "}
                <strong>drag-select down</strong> past the last, or press{" "}
                <kbd className="rounded border px-1">Ctrl</kbd>+<kbd className="rounded border px-1">A</kbd> then{" "}
                <kbd className="rounded border px-1">Ctrl</kbd>+<kbd className="rounded border px-1">C</kbd> (copying
                the whole page is fine — extra text is ignored).
              </li>
              <li>
                Paste into the box below → click <strong>Add this page</strong>.
              </li>
              <li>
                <strong>Multi-page tables:</strong> click Amazon&apos;s <em>next page</em> arrow, copy that page, paste,
                and click <strong>Add this page</strong> again. Repeat until the ASIN count in the green bar matches
                your catalog. Pages accumulate — re-pasting the same ASIN just updates it.
              </li>
            </ol>
          )}
          {showHelp && (
            <p className="mt-3 rounded bg-muted/50 p-2 text-[11px] text-muted-foreground">
              <strong>Don&apos;t worry about formatting.</strong> The parser finds every ASIN (B0…) and the return-units
              number next to it. Extra columns, images, and page furniture are ignored. Copying the whole page works
              fine.
              <br />
              <strong>Repeat monthly</strong> — Amazon&apos;s numbers shift as returns come in.
            </p>
          )}
        </div>

        {/* ── Current state ──────────────────────────────────────── */}
        {state.present && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-success/30 bg-success-light/30 p-3">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <div className="text-sm">
              <div className="font-medium">
                {state.asinCount} ASINs · {state.totalUnits?.toLocaleString()} total return units
              </div>
              <div className="text-xs text-muted-foreground">
                Pasted {state.pastedAt ? new Date(state.pastedAt).toLocaleString() : "—"}
              </div>
            </div>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={clear}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        )}

        {/* ── Paste box ──────────────────────────────────────────── */}
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              "Paste here…\n\nExample of what a copied row looks like:\nASIN: B07MNMT3M7   SplashEZ 3-in-1 Splash Pad…   3671   4.80%"
            }
            rows={8}
            className="w-full rounded-md border border-border bg-background p-3 font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => submit(true)} disabled={busy || !text.trim()}>
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              {state.present ? "Add this page" : "Parse & save"}
            </Button>
            {state.present && (
              <Button variant="outline" onClick={() => submit(false)} disabled={busy || !text.trim()}>
                Replace all
              </Button>
            )}
            {text.trim() && (
              <span className="text-xs text-muted-foreground">
                {text.split(/\r?\n/).filter((l) => l.trim()).length} lines ready
              </span>
            )}
          </div>
          {state.present && (
            <p className="text-xs text-muted-foreground">
              <strong>Multi-page table?</strong> Paste each page and click <strong>Add this page</strong> — ASINs
              accumulate. Re-pasting the same ASIN updates it rather than double-counting. Use{" "}
              <strong>Replace all</strong> only to start over.
            </p>
          )}
        </div>

        {/* ── Parse warnings ─────────────────────────────────────── */}
        {state.present && (state.unparsedSample?.length ?? 0) > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning-light/30 p-3 text-xs">
            <p className="font-medium">
              {state.unparsedSample!.length} line(s) had an ASIN but no readable number — check these:
            </p>
            <ul className="mt-1 space-y-0.5 font-mono">
              {state.unparsedSample!.map((l, i) => (
                <li key={i} className="truncate text-muted-foreground">
                  {l}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Preview of parsed rows ─────────────────────────────── */}
        {state.present && (state.rows?.length ?? 0) > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Preview parsed rows ({state.rows!.length})
            </summary>
            <div className="mt-2 max-h-56 overflow-auto rounded border border-border">
              <table className="w-full">
                <thead className="sticky top-0 bg-muted/80">
                  <tr>
                    <th className="p-1.5 text-left font-medium">ASIN</th>
                    <th className="p-1.5 text-right font-medium">Return units</th>
                    <th className="p-1.5 text-right font-medium">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {state.rows!.map((r) => (
                    <tr key={r.asin} className="border-t border-border">
                      <td className="p-1.5 font-mono">{r.asin}</td>
                      <td className="p-1.5 text-right tabular-nums">{r.returnUnits.toLocaleString()}</td>
                      <td className="p-1.5 text-right tabular-nums text-muted-foreground">
                        {r.returnRatePct != null ? `${r.returnRatePct}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
