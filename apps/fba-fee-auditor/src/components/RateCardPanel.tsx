"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card, CardContent, CardHeader, CardTitle, Button, Badge, Input, cn,
} from "@platform/ui";
import { Info, Trash2, Loader2, Link2, ClipboardPaste, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

interface Diff {
  tier: string;
  weightRange: string;
  hazmat: boolean;
  builtIn: number | null;
  published: number;
  delta: number | null;
}

interface Coverage {
  label: string;
  kind: string;
  taken: number;
  merged: number;
  skipped: number;
}

interface Card_ {
  savedAt: string;
  source: string;
  fuelSurchargeRate: number | null;
  rows: unknown[];
  unparsedSample: string[];
  coverage?: Coverage[];
  sipp?: unknown[];
  sippSavedAt?: string;
}

interface State {
  stored: Card_ | null;
  diff?: Diff[];
  builtInRowCount: number;
  canReparse?: boolean;
  reparseVia?: "url" | "raw" | null;
}

/**
 * The audit needs a reference rate that does NOT come from Amazon's invoice.
 * Deriving it from what Amazon billed would be circular — a billing error
 * would define itself as correct. So the published card is entered here, and
 * the audit compares billed-vs-published.
 */
export function RateCardPanel({ onChanged }: { onChanged?: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [diff, setDiff] = useState<Diff[] | null>(null);
  const [parseHelp, setParseHelp] = useState<{ message: string; sample: string[] } | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/rate-card");
    const j = (await r.json()) as State;
    setState(j);
    if (j.diff) setDiff(j.diff);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const submit = useCallback(
    async (body: Record<string, unknown>, label: string) => {
      setBusy(true);
      try {
        const r = await fetch("/api/rate-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (!r.ok) {
          toast.error(j.error ?? `${label} failed.`);
          // Keep what the parser actually read on screen, so a failed paste can
          // be diagnosed without going back to the server logs.
          setParseHelp(
            j.diagnostics
              ? { message: j.error as string, sample: (j.diagnostics.sample ?? []) as string[] }
              : null,
          );
          return;
        }
        setParseHelp(null);
        const d = j.drift;
        const sp = j.sincePrevious as
          | { added: number; removed: number; changed: Diff[] }
          | null;
        if (j.reparsed) {
          const moved = (sp?.changed.length ?? 0) + (sp?.added ?? 0) + (sp?.removed ?? 0);
          toast.success(
            moved === 0
              ? `Reparsed ${j.card.rows.length} rows — nothing changed.`
              : `Reparsed: ${sp?.changed.length ?? 0} rate(s) changed` +
                  ((sp?.added ?? 0) > 0 ? `, ${sp?.added} added` : "") +
                  ((sp?.removed ?? 0) > 0 ? `, ${sp?.removed} dropped` : "") + ".",
          );
        } else {
          toast.success(
            `${label}: ${j.card.rows.length} rows. ${d.differing} differ from the built-in table` +
              (d.maxDelta > 0 ? ` (largest ${money(d.maxDelta)})` : "") +
              (d.newRows > 0 ? `, ${d.newRows} new` : "") + ".",
          );
        }
        setDiff(j.diff);
        setUrl(""); setText("");
        await refresh();
        onChanged?.();
      } finally {
        setBusy(false);
      }
    },
    [refresh, onChanged],
  );

  const clear = useCallback(async () => {
    setBusy(true);
    try {
      await fetch("/api/rate-card", { method: "DELETE" });
      setDiff(null);
      toast.success("Rate card cleared — the audit falls back to the built-in table.");
      await refresh();
      onChanged?.();
    } finally { setBusy(false); }
  }, [refresh, onChanged]);

  const stored = state?.stored ?? null;
  const changed = (diff ?? []).filter((d) => d.delta != null && Math.abs(d.delta) > 0.005);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          Published FBA rate card
          {stored ? (
            <Badge variant="secondary">{stored.rows.length} rows</Badge>
          ) : (
            <Badge variant="outline">not set — using built-in table</Badge>
          )}
        </CardTitle>
        <div className="flex gap-2">
          {stored && state?.canReparse && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              title={
                state.reparseVia === "url"
                  ? "Re-fetch the page and parse it again"
                  : "Parse the saved paste again"
              }
              onClick={() => submit({ reparse: true }, "Reparsed")}
            >
              <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
            </Button>
          )}
          {stored && (
            <Button size="sm" variant="ghost" onClick={clear} disabled={busy}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setShow((s) => !s)}>
            {show ? "Hide" : stored ? "Update" : "Set up"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground flex gap-2">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            The audit compares what Amazon charged against what Amazon
            <strong> publishes</strong>. Taking the reference from your invoices
            instead would be circular — a billing mistake would define itself as
            correct. Point this at the published fee page, or paste the table
            from it.
          </span>
        </p>

        {stored && (
          <div className="text-xs text-muted-foreground">
            From <span className="font-mono break-all">{stored.source}</span> on{" "}
            {new Date(stored.savedAt).toLocaleDateString()}
            {stored.fuelSurchargeRate != null &&
              ` · fuel surcharge ${(stored.fuelSurchargeRate * 100).toFixed(1)}%`}
            {state?.canReparse === false && (
              <span className="ml-1">
                · paste it again to enable reparse
              </span>
            )}
          </div>
        )}

        {stored && (
          <div className="text-xs text-muted-foreground">
            {(stored.sipp?.length ?? 0) > 0 ? (
              <>
                SIPP discounts: <strong>{stored.sipp!.length} rows</strong> from your pasted SIPP rate
                card
                {stored.sippSavedAt && ` (${new Date(stored.sippSavedAt).toLocaleDateString()})`}.
              </>
            ) : (
              <>
                SIPP discounts: using the <strong>built-in table</strong>. It matches what Amazon
                currently bills, but to audit against Amazon&apos;s own figures open the fee
                page&apos;s &quot;Ships in Product Packaging (SIPP)&quot; rate-card link and paste that
                table here — it&apos;s added to this card, not swapped for it.
              </>
            )}
          </div>
        )}

        {parseHelp && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
            <div className="font-medium text-destructive">{parseHelp.message}</div>
            {parseHelp.sample.length > 0 && (
              <>
                <div className="mt-2 text-muted-foreground">What was read:</div>
                <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                  {parseHelp.sample.map((l, i) => (
                    <li key={i} className="truncate">{l}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {show && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="space-y-1">
              <label className="text-xs font-medium flex items-center gap-1">
                <ClipboardPaste className="h-3 w-3" /> Paste the fee table
              </label>
              <textarea
                className="w-full h-32 rounded-md border bg-background p-2 text-xs font-mono"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={"Large standard-size\n4 oz or less\t$3.31\t$4.42\n4+ to 8 oz\t$3.95\t$5.33"}
              />
              <Button
                size="sm"
                disabled={busy || text.trim().length === 0}
                onClick={() => submit({ text }, "Parsed")}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Parse and save"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Open Amazon&apos;s fee page in your browser, select the table
                including its tier heading, and paste it here.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium flex items-center gap-1">
                <Link2 className="h-3 w-3" /> …or fetch a public URL
              </label>
              <div className="flex gap-2">
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://..."
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || url.trim().length === 0}
                  onClick={() => submit({ url }, "Fetched")}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fetch"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Only works for pages that need no login. Seller Central URLs
                return a sign-in page to the server, not the fee table.
              </p>
            </div>
          </div>
        )}

        {diff && diff.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">
              {changed.length === 0
                ? "Built-in table matches the published card."
                : `${changed.length} rate${changed.length === 1 ? "" : "s"} differ from the built-in table`}
            </div>
            {changed.length > 0 && (
              <div className="max-h-72 overflow-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr className="text-left">
                      <th className="p-2">Tier</th>
                      <th className="p-2">Weight</th>
                      <th className="p-2 text-right">Built-in</th>
                      <th className="p-2 text-right">Published</th>
                      <th className="p-2 text-right">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changed.map((d, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2">
                          {d.tier}
                          {d.hazmat && (
                            <Badge variant="outline" className="ml-1 text-[10px]">
                              hazmat
                            </Badge>
                          )}
                        </td>
                        <td className="p-2">{d.weightRange}</td>
                        <td className="p-2 text-right tabular-nums">
                          {d.builtIn == null ? "—" : money(d.builtIn)}
                        </td>
                        <td className="p-2 text-right tabular-nums">{money(d.published)}</td>
                        <td
                          className={cn(
                            "p-2 text-right tabular-nums font-medium",
                            (d.delta ?? 0) > 0 ? "text-red-600" : "text-emerald-600",
                          )}
                        >
                          {d.delta == null ? "new" : `${d.delta > 0 ? "+" : ""}${money(d.delta)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {stored && (stored.coverage?.length ?? 0) > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              What was read from each fee table on the page
            </summary>
            <div className="mt-2 overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted">
                  <tr className="text-left">
                    <th className="p-2">Table</th>
                    <th className="p-2">Kind</th>
                    <th className="p-2 text-right">Rates used</th>
                    <th className="p-2 text-right">Peak merged</th>
                    <th className="p-2 text-right">Skipped</th>
                  </tr>
                </thead>
                <tbody>
                  {stored.coverage!.map((c, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2">{c.label}</td>
                      <td className="p-2 text-muted-foreground">{c.kind}</td>
                      <td className="p-2 text-right tabular-nums">{c.taken || "—"}</td>
                      <td className="p-2 text-right tabular-nums">{c.merged || "—"}</td>
                      <td className="p-2 text-right tabular-nums">{c.skipped || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-muted-foreground">
              Apparel tables are skipped on purpose — a different schedule for a
              different kind of product. Peak rates are merged onto their
              non-peak row rather than dropped as duplicates. Rows Amazon states
              as a formula (&quot;$6.97 + $0.08 per 4 oz interval above first
              3 lb&quot;) are stored as a base plus a surcharge per interval,
              keeping the interval size Amazon states — a pound, a half-pound
              or 4 oz — since assuming a pound understates those rows.
            </p>
            <p className="mt-2 text-muted-foreground">
              A <strong>skipped</strong> count outside the apparel rows means a
              priced row was found and not read; every such line is listed
              below, so nothing is dropped out of sight.
            </p>
          </details>
        )}

        {stored && stored.unparsedSample.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">
              {stored.unparsedSample.length} line(s) not understood
            </summary>
            <ul className="mt-1 space-y-0.5 font-mono">
              {stored.unparsedSample.map((l, i) => (
                <li key={i} className="truncate">{l}</li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
