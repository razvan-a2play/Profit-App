"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Button, Badge, cn } from "@platform/ui";
import { Info, Loader2, Upload, Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import type { SourcingComparisonRow, SourcingStatus, SourcingSummary } from "@/lib/sourcingCost";

const money = (n: number | null) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

interface Result {
  fileName: string;
  skippedRows: number;
  pnlSkus: number;
  summary: SourcingSummary;
  rows: SourcingComparisonRow[];
}

const STATUS: Record<SourcingStatus, { label: string; className: string; help: string }> = {
  amazon_lower: {
    label: "Claim",
    className: "bg-warning text-warning-foreground",
    help: "Amazon's approved cost is below ours — we are under-reimbursed on every lost or damaged unit.",
  },
  no_cost_on_file: {
    label: "Nothing on file",
    className: "bg-warning text-warning-foreground",
    help: "Amazon has no approved cost for this ASIN at all.",
  },
  amazon_higher: {
    label: "Leave it",
    className: "bg-success text-success-foreground",
    help: "Amazon already values the unit above our cost. Submitting ours would cut the payout.",
  },
  match: {
    label: "Agrees",
    className: "bg-muted text-muted-foreground",
    help: "Amazon's approved cost matches the PNL app.",
  },
  no_pnl_version: {
    label: "No PNL cost",
    className: "bg-muted text-muted-foreground",
    help: "The SKU exists, but has no saved PNL version to compare against.",
  },
  unknown_asin: {
    label: "Not our ASIN",
    className: "bg-muted text-muted-foreground",
    help: "This ASIN is not in the Product Library, so it cannot be matched to a SKU.",
  },
};

const ORDER: SourcingStatus[] = [
  "amazon_lower",
  "no_cost_on_file",
  "amazon_higher",
  "match",
  "no_pnl_version",
  "unknown_asin",
];

export function SourcingCostPanel() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<SourcingStatus | "all">("all");

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/sourcing-cost", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Upload failed");
      setResult(j as Result);
      // Pre-tick only the rows that are worth claiming.
      const next: Record<string, boolean> = {};
      for (const row of (j as Result).rows) {
        if (row.suggested != null) next[row.asin] = true;
      }
      setAccepted(next);
      const s = (j as Result).summary;
      toast.success(`${s.total} ASINs checked — ${s.claimable} worth claiming`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (!result) return;
    const newCostByAsin: Record<string, number> = {};
    for (const row of result.rows) {
      if (accepted[row.asin] && row.suggested != null) newCostByAsin[row.asin] = row.suggested;
    }
    if (Object.keys(newCostByAsin).length === 0) {
      toast.error("Nothing ticked, so the file would be empty of changes.");
      return;
    }
    const r = await fetch("/api/sourcing-cost", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: result.rows, newCostByAsin }),
    });
    if (!r.ok) {
      toast.error("Could not build the upload file.");
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sourcing-cost-upload.txt";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${Object.keys(newCostByAsin).length} costs written to the upload file`);
  }

  const shown = useMemo(
    () =>
      (result?.rows ?? [])
        .filter((r) => filter === "all" || r.status === filter)
        .sort(
          (a, b) =>
            ORDER.indexOf(a.status) - ORDER.indexOf(b.status) ||
            (b.delta ?? 0) - (a.delta ?? 0),
        ),
    [result, filter],
  );

  const s = result?.summary;
  const ticked = Object.values(accepted).filter(Boolean).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Sourcing cost vs the PNL app</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Amazon reimburses lost and warehouse-damaged units at its own{" "}
                <em>approved sourcing cost</em>, not at what the unit actually costs us.
              </p>
            </div>
            {s && (
              <Badge className={s.claimable > 0 ? "bg-warning text-warning-foreground" : "bg-success text-success-foreground"}>
                {s.claimable} worth claiming
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="rounded-md border border-info/30 bg-info-light/40 p-3 text-xs">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
              <div className="space-y-1">
                <p>
                  There is no SP-API for sourcing cost — both halves are Seller Central only —
                  so this page is the bridge: upload what Amazon has, get back the file to send.
                </p>
                <p>
                  Seller Central →{" "}
                  <span className="font-medium">
                    Inventory Defect and Reimbursement → Manage Your Sourcing Cost → Bulk
                  </span>{" "}
                  → <strong>Download sourcing cost</strong>.
                  <a
                    href="https://sellercentral.amazon.com/inventory-defect-reimbursement/sourcing-cost/bulk"
                    target="_blank"
                    rel="noreferrer"
                    className="ml-1 inline-flex items-center gap-1 underline"
                  >
                    open <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              </div>
            </div>
          </div>

          <label className="flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed border-border p-6 text-center hover:bg-muted/40">
            <input
              type="file"
              accept=".xlsx,.txt,.tsv,.csv"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
            {busy ? (
              <Loader2 className="mb-2 h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Upload className="mb-2 h-5 w-5 text-muted-foreground" />
            )}
            <span className="text-sm font-medium">
              {busy ? "Checking against the PNL app…" : "Drop the sourcing cost file here"}
            </span>
            <span className="mt-0.5 text-xs text-muted-foreground">
              .xlsx as downloaded, or the tab-delimited export
            </span>
          </label>

          {result && s && (
            <>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {(
                  [
                    ["ASINs in file", s.total, "all"],
                    ["Worth claiming", s.claimable, "amazon_lower"],
                    ["Nothing on file", s.noCostOnFile, "no_cost_on_file"],
                    ["Amazon pays more", s.amazonHigher, "amazon_higher"],
                    ["No PNL cost", s.noPnlVersion, "no_pnl_version"],
                    ["Not our ASIN", s.unknownAsin, "unknown_asin"],
                  ] as const
                ).map(([label, value, key]) => (
                  <button
                    key={label}
                    onClick={() => setFilter(key as SourcingStatus | "all")}
                    className={cn(
                      "rounded-md border p-2 text-left transition-colors",
                      filter === key ? "border-primary bg-muted" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <div className="text-lg font-semibold tabular-nums">{value}</div>
                    <div className="text-[11px] text-muted-foreground">{label}</div>
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  <strong className="text-foreground">{money(s.claimableDelta)}</strong> of per-unit
                  reimbursement currently unclaimed across {s.claimable} ASINs
                </span>
                <span>·</span>
                <span>{result.pnlSkus} SKUs costed in the PNL app</span>
                <Button size="sm" className="ml-auto" disabled={ticked === 0} onClick={download}>
                  <Download className="mr-2 h-3 w-3" />
                  Build upload file ({ticked})
                </Button>
              </div>

              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="w-8 p-2"></th>
                      <th className="p-2 text-left">ASIN</th>
                      <th className="p-2 text-left">SKU</th>
                      <th className="p-2 text-right">Amazon approved</th>
                      <th className="p-2 text-right">PNL cost</th>
                      <th className="p-2 text-right">Difference</th>
                      <th className="p-2 text-right">Propose</th>
                      <th className="p-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.asin} className="border-t border-border">
                        <td className="p-2">
                          <input
                            type="checkbox"
                            disabled={r.suggested == null}
                            checked={!!accepted[r.asin]}
                            onChange={(e) =>
                              setAccepted((a) => ({ ...a, [r.asin]: e.target.checked }))
                            }
                          />
                        </td>
                        <td className="p-2 font-mono text-xs">{r.asin}</td>
                        <td className="p-2 font-mono text-xs">{r.sku ?? "—"}</td>
                        <td className="p-2 text-right tabular-nums">{money(r.latestApproved)}</td>
                        <td className="p-2 text-right tabular-nums">{money(r.ourCost)}</td>
                        <td
                          className={cn(
                            "p-2 text-right tabular-nums",
                            (r.delta ?? 0) > 0 && "text-warning",
                          )}
                        >
                          {r.delta == null ? "—" : (r.delta > 0 ? "+" : "") + money(r.delta)}
                        </td>
                        <td className="p-2 text-right tabular-nums font-medium">
                          {r.suggested == null ? "—" : money(r.suggested)}
                        </td>
                        <td className="p-2">
                          <Badge className={STATUS[r.status].className} title={STATUS[r.status].help}>
                            {STATUS[r.status].label}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                    {shown.length === 0 && (
                      <tr>
                        <td colSpan={8} className="p-6 text-center text-sm text-muted-foreground">
                          Nothing in this group.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-muted-foreground">
                Ticked rows are written into <code className="rounded bg-muted px-1">Seller New Cost</code>{" "}
                and everything else is left blank, so uploading only ever raises a cost Amazon has
                undervalued. Amazon reviews submissions for up to five business days and locks a
                decision for 30 days, so send it once.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
