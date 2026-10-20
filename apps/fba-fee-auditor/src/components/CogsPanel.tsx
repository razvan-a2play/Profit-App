"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card, CardContent, CardHeader, CardTitle, Button, Badge, Input, cn,
} from "@platform/ui";
import { Info, Trash2, Loader2, DownloadCloud } from "lucide-react";
import { toast } from "sonner";

const money2 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

interface Entry {
  sku: string;
  manufacturing?: number;
  freight?: number;
  other?: number;
  override?: number;
  landed: number | null;
  source: string;
}

interface State {
  count: number;
  defaultRatioOfPrice: number | null;
  entries: Entry[];
}

/**
 * Landed COGS = manufacturing + freight.
 *  - manufacturing: PNL calculator "Total Manufacturing Cost"
 *  - freight:       Inbound Pathfinder → Reports → Freight COGS → Download CSV
 */
export function CogsPanel({ onChanged }: { onChanged: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [mfgText, setMfgText] = useState("");
  const [freightText, setFreightText] = useState("");

  const refresh = useCallback(async () => {
    const r = await fetch("/api/uploads/cogs");
    setState(await r.json());
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const post = useCallback(
    async (body: Record<string, unknown>, label: string, after?: () => void) => {
      setBusy(true);
      try {
        const r = await fetch("/api/uploads/cogs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const b = await r.json();
        if (b.error) throw new Error(b.error);
        toast.success(b.added != null ? `${label}: saved ${b.added} SKUs.` : `${label} updated.`);
        after?.();
        await refresh();
        onChanged();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [refresh, onChanged],
  );

  const uploadCsv = useCallback(
    async (file: File, field: string, label: string) => {
      setBusy(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("field", field);
        const r = await fetch("/api/uploads/cogs", { method: "POST", body: fd });
        const b = await r.json();
        if (b.error) throw new Error(b.error);
        toast.success(`${label}: saved ${b.added} SKUs.`);
        await refresh();
        onChanged();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [refresh, onChanged],
  );

  const pull = useCallback(
    async (endpoint: string, label: string) => {
      setBusy(true);
      try {
        const r = await fetch(endpoint, { method: "POST" });
        const b = await r.json();
        if (b.error) throw new Error(b.error);
        toast.success(`${label}: imported ${b.imported} SKUs.`);
        await refresh();
        onChanged();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [refresh, onChanged],
  );

  const clear = async () => {
    await fetch("/api/uploads/cogs", { method: "DELETE" });
    toast.success("COGS cleared.");
    await refresh();
    onChanged();
  };

  const costed = state?.entries.filter((e) => e.landed != null).length ?? 0;
  const ready = costed > 0 || state?.defaultRatioOfPrice != null;

  return (
    <Card className={ready ? "border-success/40" : "border-warning/50"}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Step 1 — Landed COGS</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              <code className="rounded bg-muted px-1">manufacturing + freight</code>. Manufacturing from the
              PNL calculator, freight from Inbound Pathfinder&apos;s Freight COGS report.
            </p>
          </div>
          <Badge className={ready ? "bg-success text-success-foreground" : "bg-warning text-warning-foreground"}>
            {costed} SKUs costed
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="rounded-md border border-info/30 bg-info-light/40 p-3 text-xs">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
            <div className="space-y-0.5">
              <p><strong>Manufacturing</strong> — PNL calculator → <em>Total Manufacturing Cost</em> (product + box + inserts).</p>
              <p>
                <strong>Freight</strong> — Inbound Pathfinder → Reports → Freight COGS →{" "}
                <strong>Download CSV</strong>. The <code className="rounded bg-muted px-1">$ / unit</code> column is
                picked automatically.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy}
            onClick={() => pull("/api/pnl-manufacturing", "Manufacturing")}>
            {busy ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <DownloadCloud className="mr-2 h-3 w-3" />}
            Pull manufacturing from PNL
          </Button>
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => pull("/api/freight-cogs", "Freight")}>
            {busy ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <DownloadCloud className="mr-2 h-3 w-3" />}
            Pull freight from Inbound Pathfinder
          </Button>
        </div>

        <button onClick={() => setShow((v) => !v)} className="text-sm font-medium">
          {show ? "▲ Hide manual entry" : "▼ Manual entry / overrides"}
        </button>

        {show && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase text-muted-foreground">Manufacturing (PNL)</div>
              <textarea
                value={mfgText}
                onChange={(e) => setMfgText(e.target.value)}
                rows={6}
                placeholder={"SPBATH0034, 3.55\nSEZ0101002, 4.20"}
                className="w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
              />
              <Button
                size="sm"
                disabled={busy || !mfgText.trim()}
                onClick={() => post({ field: "manufacturing", text: mfgText }, "Manufacturing", () => setMfgText(""))}
              >
                {busy && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}Save manufacturing
              </Button>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium uppercase text-muted-foreground">Freight per unit</div>
              <label className="flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed border-border p-4 text-center hover:bg-muted/40">
                <input
                  type="file"
                  accept=".csv,.tsv,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadCsv(f, "freight", "Freight");
                  }}
                />
                <span className="text-xs font-medium">Drop Inbound Pathfinder CSV</span>
                <span className="mt-0.5 text-[10px] text-muted-foreground">or paste below</span>
              </label>
              <textarea
                value={freightText}
                onChange={(e) => setFreightText(e.target.value)}
                rows={3}
                placeholder={"SPBATH0034, 0.1128"}
                className="w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !freightText.trim()}
                onClick={() => post({ field: "freight", text: freightText }, "Freight", () => setFreightText(""))}
              >
                Save freight
              </Button>
            </div>

            <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3 md:col-span-2">
              {(state?.count ?? 0) > 0 && (
                <Button variant="ghost" size="sm" className="ml-auto" onClick={clear}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>
        )}

        {(state?.entries.length ?? 0) > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Costed SKUs ({state!.entries.length})
            </summary>
            <div className="mt-2 max-h-56 overflow-auto rounded border border-border">
              <table className="w-full">
                <thead className="sticky top-0 bg-muted/80">
                  <tr>
                    <th className="p-1.5 text-left font-medium">SKU</th>
                    <th className="p-1.5 text-right font-medium">Mfg</th>
                    <th className="p-1.5 text-right font-medium">Freight</th>
                    <th className="p-1.5 text-right font-medium">Landed</th>
                  </tr>
                </thead>
                <tbody>
                  {state!.entries.map((e) => (
                    <tr key={e.sku} className={cn("border-t border-border", e.landed == null && "opacity-60")}>
                      <td className="p-1.5 font-mono">{e.sku}</td>
                      <td className="p-1.5 text-right tabular-nums">{e.manufacturing != null ? money2(e.manufacturing) : "—"}</td>
                      <td className="p-1.5 text-right tabular-nums">{e.freight != null ? `$${e.freight.toFixed(4)}` : "—"}</td>
                      <td className="p-1.5 text-right font-semibold tabular-nums">{e.landed != null ? money2(e.landed) : "—"}</td>
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
