"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from "@platform/ui";
import { Loader2, Package, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import type { SippSkuStatus, StoredPortfolio } from "@/lib/sippPortfolio";

const usd = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

/**
 * Amazon's SIPP Product Portfolio report. There's no API for it, so it's
 * uploaded as the CSV from Seller Central; it then decides which SKUs the audit
 * treats as SIPP-certified, and shows where enrolling would save money.
 */
export function SippReportPanel({ onChanged }: { onChanged: () => void }) {
  const [stored, setStored] = useState<StoredPortfolio | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/sipp/portfolio")
      .then((r) => r.json())
      .then((d: { stored: StoredPortfolio | null }) => setStored(d.stored))
      .catch(() => {});
  }, []);

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/sipp/portfolio", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Upload failed");
      setStored(j.stored as StoredPortfolio);
      if (j.warning) toast.warning(j.warning);
      const c = (j.stored as StoredPortfolio).counts;
      toast.success(`SIPP report read — ${c.certified} certified, ${c.eligible} eligible to enrol`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    await fetch("/api/sipp/portfolio", { method: "DELETE" });
    setStored(null);
    onChanged();
  }

  const { certified, opportunities, opportunity90d } = useMemo(() => {
    const all: SippSkuStatus[] = stored ? Object.values(stored.bySku) : [];
    const opp = all
      // Eligible with a real saving on offer - Amazon also lists some
      // size-excluded, decertified listings as "eligible" at $0.
      .filter((s) => s.eligibility === "eligible" && (s.perUnitSavings ?? 0) > 0)
      .sort((a, b) => (b.savings90d ?? 0) - (a.savings90d ?? 0));
    return {
      certified: all
        .filter((s) => s.eligibility === "certified" && !/decertified/i.test(s.certificationStatus))
        .sort((a, b) => a.sku.localeCompare(b.sku)),
      opportunities: opp,
      opportunity90d: opp.reduce((t, s) => t + (s.savings90d ?? 0), 0),
    };
  }, [stored]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Package className="h-4 w-4" />
          SIPP certification
          {stored && <Badge variant="outline">{certified.length} certified</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Upload Amazon&apos;s <strong>SIPP Product Portfolio</strong> report (Seller Central → Ships in
          Product Packaging → download). It isn&apos;t available through the API. The audit uses it as
          the record of which SKUs are certified, then checks Amazon actually applies the discount.
        </p>

        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-4 hover:bg-muted/40">
          <input
            type="file"
            accept=".csv"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Upload className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="font-medium">
            {busy ? "Reading the report…" : stored ? "Upload a newer SIPP report" : "Upload the SIPP report CSV"}
          </span>
        </label>

        {stored && (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                <span className="font-mono">{stored.fileName}</span>, uploaded{" "}
                {new Date(stored.importedAt).toLocaleDateString()}
              </span>
              <span>
                US: {stored.counts.certified} certified · {stored.counts.eligible} eligible ·{" "}
                {stored.counts.excluded} excluded
                {stored.counts.decertified > 0 && ` · ${stored.counts.decertified} decertified`}
              </span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={remove}>
                <Trash2 className="mr-1 h-3 w-3" /> Remove
              </Button>
            </div>

            {opportunities.length > 0 && (
              <div>
                <div className="mb-1 font-medium">
                  Eligible but not enrolled
                  {opportunity90d > 0 && (
                    <span className="ml-2 font-normal text-warning">
                      about {usd(opportunity90d)} over 90 days, by Amazon&apos;s estimate
                    </span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="p-1.5">SKU</th>
                        <th className="p-1.5">Status</th>
                        <th className="p-1.5 text-right">Per unit</th>
                        <th className="p-1.5 text-right">90 days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {opportunities.map((s) => (
                        <tr key={s.sku} className="border-t">
                          <td className="p-1.5 font-mono">{s.sku}</td>
                          <td className="p-1.5">
                            {/decertified/i.test(s.certificationStatus)
                              ? `decertified ${s.decertificationDate ?? ""}`.trim()
                              : "never enrolled"}
                          </td>
                          <td className="p-1.5 text-right tabular-nums">{usd(s.perUnitSavings)}</td>
                          <td className="p-1.5 text-right tabular-nums">
                            {s.savings90d != null ? usd(s.savings90d) : <span className="text-muted-foreground">no shipments</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Enrolling needs rigid, six-sided packaging with no windows, cut-outs, hang tags or
                  shrink-wrap, and no Dangerous Goods. The discount starts with units received after the
                  first-arrival date you give.
                </p>
              </div>
            )}

            {stored.unmatchedAsins.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  {stored.unmatchedAsins.length} US ASIN(s) in the report matched no SKU
                </summary>
                <p className="mt-1">
                  Not in the Product Library or the fee report, so they can&apos;t be tied to a SKU.
                </p>
                <p className="mt-1 font-mono">{stored.unmatchedAsins.join(", ")}</p>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
