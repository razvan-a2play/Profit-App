"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@platform/ui";
import { AlertTriangle, PackageX, Loader2, RefreshCw, ExternalLink, Boxes } from "lucide-react";
import { toast } from "sonner";
import type { StrandedRow, UnfulfillableRow } from "@/lib/amazonInventory";

interface InventoryReportBlock<Row> {
  ready: boolean;
  status?: string;
  reportId: string | null;
  dataAsOf: string | null;
  stale: boolean;
  rows: Row[];
}

interface InventoryResponse {
  stranded: InventoryReportBlock<StrandedRow>;
  unfulfillable: InventoryReportBlock<UnfulfillableRow>;
  libraryAppUrl: string | null;
  libraryIndex: Record<string, string>;
  error?: string;
}

/** Human-readable "N minutes/hours/days ago" for an ISO timestamp. */
function timeAgo(iso: string | null): string {
  if (!iso) return "unknown";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "unknown";
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

const money = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

type Tab = "stranded" | "unfulfillable";

export function InventoryIssuesDashboard() {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<InventoryResponse | null>(null);
  const [tab, setTab] = useState<Tab>("stranded");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/inventory-issues", { cache: "no-store" });
      const body = (await res.json()) as InventoryResponse;
      if (body.error) {
        toast.error(body.error);
      } else {
        const s = body.stranded.rows.length;
        const u = body.unfulfillable.rows.length;
        const pendingS = !body.stranded.ready;
        const pendingU = !body.unfulfillable.ready;
        // Distinguish "gateway/error" from "amazon still generating" so the
        // user isn't staring at a fake "generating" state when the pipe is broken.
        // "throttled" / "unavailable" now come back cleanly from the gateway
        // (Amazon quota exceeded etc.) — treat as pending, not as a hard error.
        const isBackendErr = (msg?: string) =>
          !!msg &&
          /→ \d{3}|failed|not configured/i.test(msg) &&
          !/throttled|unavailable/i.test(msg);
        const errs: string[] = [];
        if (isBackendErr(body.stranded.status)) errs.push(`stranded: ${body.stranded.status}`);
        if (isBackendErr(body.unfulfillable.status)) errs.push(`unfulfillable: ${body.unfulfillable.status}`);
        if (errs.length > 0) {
          toast.error(errs.join(" · "));
        } else if (pendingS || pendingU) {
          toast.message(
            `Amazon is generating ${[pendingS && "stranded", pendingU && "unfulfillable"]
              .filter(Boolean)
              .join(" + ")} report(s). Try again shortly.`,
          );
        } else {
          toast.success(`Loaded ${s} stranded · ${u} unfulfillable SKU${u === 1 ? "" : "s"}.`);
        }
      }
      setData(body);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load inventory issues.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const strandedRows = data?.stranded.rows ?? [];
  const unfulfillableRows = data?.unfulfillable.rows ?? [];

  const totalUnsellable = unfulfillableRows.reduce((s, r) => s + r.unsellableTotal, 0);
  const tiedUpUsd = unfulfillableRows.reduce(
    (s, r) => s + (r.yourPrice ?? 0) * r.unsellableTotal,
    0,
  );
  const reimbursableUsd = unfulfillableRows.reduce((s, r) => s + (r.reimbursableUsd ?? 0), 0);

  const libraryHref = (sku: string): string | null => {
    if (!data?.libraryAppUrl) return null;
    const id = data.libraryIndex[sku.trim().toLowerCase()];
    return id ? `${data.libraryAppUrl}/products/${id}?tab=specs` : `${data.libraryAppUrl}/products`;
  };

  const strandedNotReady = data && !data.stranded.ready;
  const unfulfillableNotReady = data && !data.unfulfillable.ready;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={load} disabled={busy} variant="outline">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Reload
        </Button>
        {data && <FreshnessBadges data={data} />}
        {(strandedNotReady || unfulfillableNotReady) && (
          <span className="text-sm text-warning">
            Some reports still generating — will show up on next reload.
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Stranded SKUs"
          value={String(strandedRows.length)}
          icon={AlertTriangle}
          tone="text-warning"
        />
        <SummaryCard
          label="Unsellable units"
          value={totalUnsellable.toLocaleString()}
          icon={PackageX}
          tone="text-destructive"
        />
        <SummaryCard
          label="~$ tied up"
          value={money(tiedUpUsd)}
          icon={Boxes}
          tone="text-info"
          hint="Amazon list price × unsellable qty"
        />
        <SummaryCard
          label="~$ reimbursable"
          value={money(reimbursableUsd)}
          icon={PackageX}
          tone="text-success"
          hint="Warehouse + carrier + distributor damage — file within 18 mo"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: "stranded", label: "Stranded", count: strandedRows.length },
            { key: "unfulfillable", label: "Unfulfillable", count: unfulfillableRows.length },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              tab === t.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted",
            )}
          >
            {t.label}
            <span className="ml-1.5 tabular-nums opacity-70">{t.count}</span>
          </button>
        ))}
      </div>

      {tab === "stranded" ? (
        <StrandedTable rows={strandedRows} libraryHref={libraryHref} notReady={!!strandedNotReady} />
      ) : (
        <UnfulfillableTable
          rows={unfulfillableRows}
          libraryHref={libraryHref}
          notReady={!!unfulfillableNotReady}
        />
      )}
    </div>
  );
}

function FreshnessBadges({ data }: { data: InventoryResponse }) {
  const blocks: [string, InventoryReportBlock<unknown>][] = [
    ["Stranded", data.stranded],
    ["Unfulfillable", data.unfulfillable],
  ];
  const anyStale = data.stranded.stale || data.unfulfillable.stale;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {blocks.map(([label, b]) => (
        <span
          key={label}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-0.5",
            b.stale ? "border-warning/40 text-warning" : "border-border text-muted-foreground",
          )}
        >
          {label}: <span className="tabular-nums">{timeAgo(b.dataAsOf)}</span>
        </span>
      ))}
      {anyStale && (
        <span className="text-xs text-muted-foreground">
          · fresh report requested — reload in a minute to pick it up
        </span>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
  hint,
}: {
  label: string;
  value: string;
  icon: typeof AlertTriangle;
  tone: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <Icon className={cn("h-4 w-4", tone)} />
        </div>
        <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function SkuCell({
  sku,
  productName,
  href,
}: {
  sku: string;
  productName: string | null;
  href: string | null;
}) {
  return (
    <TableCell className="font-medium">
      <div className="flex items-center gap-1.5">
        <span>{sku}</span>
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" title="Open in Product Library">
            <ExternalLink className="h-3 w-3 opacity-60 hover:opacity-100" />
          </a>
        )}
      </div>
      {productName && <div className="text-xs text-muted-foreground line-clamp-1">{productName}</div>}
    </TableCell>
  );
}

function StrandedTable({
  rows,
  libraryHref,
  notReady,
}: {
  rows: StrandedRow[];
  libraryHref: (sku: string) => string | null;
  notReady: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Stranded inventory</CardTitle>
        <p className="text-sm text-muted-foreground">
          FBA inventory that isn&apos;t buyable — usually because the listing is inactive, suppressed, or blocked.
          Fix the listing in Seller Central to unstrand.
        </p>
      </CardHeader>
      <CardContent>
        {notReady ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Amazon is generating the stranded report — reload in a minute.
          </p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing stranded. 🎉
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>ASIN</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Stranded since</TableHead>
                  <TableHead>Auto-remove on</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Fix</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...rows]
                  .sort((a, b) => (b.quantity ?? 0) - (a.quantity ?? 0))
                  .map((r) => {
                    const value = (r.yourPrice ?? 0) * (r.quantity ?? 0);
                    return (
                      <TableRow key={r.sku}>
                        <SkuCell sku={r.sku} productName={r.productName} href={libraryHref(r.sku)} />
                        <TableCell className="text-xs">{r.asin ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="border-warning/50 text-warning text-[10px]">
                            {r.reason ?? "unknown"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{r.strandedSince ?? "—"}</TableCell>
                        <TableCell className="text-xs text-destructive">{r.autoRemovalDate ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.quantity ?? "—"}
                          {r.quantity != null && r.quantity > 0 && (
                            <div className="text-[10px] text-muted-foreground">
                              {r.fulfillableQty > 0 && `${r.fulfillableQty} ok`}
                              {r.unfulfillableQty > 0 && ` · ${r.unfulfillableQty} bad`}
                              {r.reservedQty > 0 && ` · ${r.reservedQty} rsv`}
                              {r.inboundQty > 0 && ` · ${r.inboundQty} in`}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{money(r.yourPrice)}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {value > 0 ? money(value) : "—"}
                        </TableCell>
                        <TableCell>
                          <a
                            href="https://sellercentral.amazon.com/inventory?viewFilter=fba&query=&sort=none&filter=stranded"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            Fix stranded
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Plain-English recommendation for what to do with a single unfulfillable SKU.
 * Uses the damage-bucket breakdown to pick the highest-value action:
 *  - Reimbursable damage present → file a case (money you can recover)
 *  - Customer-damaged (returned in poor condition, still has resale value) →
 *    liquidate via Grade & Resell / Liquidation channel
 *  - Only defective / expired → dispose (zero recovery — just stop paying storage)
 *  - Mixed → do both (case first, then liquidate the rest)
 *  - No bucket data yet → generic remove hint
 */
type Verdict = {
  label: string;
  detail: string;
  primaryHref: string;
  primaryLabel: string;
  tone: "success" | "warning" | "muted" | "info";
};

function recommendAction(row: UnfulfillableRow): Verdict {
  const reimb = row.reimbursableTotal ?? 0;
  const reimbUsd = row.reimbursableUsd ?? 0;
  const nonReimb = row.nonReimbursableTotal ?? 0;
  const customerDamaged = row.customerDamaged ?? 0;
  const defective = row.defective ?? 0;
  const expired = row.expired ?? 0;
  const bucketsKnown = row.bucketsFromAdjustments === true;

  if (!bucketsKnown) {
    return {
      label: "Remove or dispose",
      detail: "Bucket data still generating — reload in a minute for a specific recommendation.",
      primaryHref: "https://sellercentral.amazon.com/gp/ssof/knight/create-removal-order.html",
      primaryLabel: "Removal order",
      tone: "muted",
    };
  }

  if (reimb > 0 && nonReimb > 0) {
    return {
      label: `File case for $${reimbUsd.toFixed(2)}, then liquidate rest`,
      detail: `${reimb} unit(s) are Amazon's fault ($${reimbUsd.toFixed(2)} recoverable) — file within 18 mo. The remaining ${nonReimb} unit(s) are your loss; liquidate or dispose.`,
      primaryHref: "https://sellercentral.amazon.com/reportcentral/REIMBURSEMENTS/1",
      primaryLabel: "File case",
      tone: "success",
    };
  }

  if (reimb > 0) {
    return {
      label: `File case for $${reimbUsd.toFixed(2)}`,
      detail: `All damage caused by Amazon FC / carrier / distributor — 100% reimbursable. Submit reimbursement within 18 months of the damage date.`,
      primaryHref: "https://sellercentral.amazon.com/reportcentral/REIMBURSEMENTS/1",
      primaryLabel: "File case",
      tone: "success",
    };
  }

  if (customerDamaged > 0 && defective + expired === 0) {
    return {
      label: "Liquidate (has resale value)",
      detail: `Customer-returned units usually still work — enable Grade & Resell + Liquidation in Automated Unfulfillable Removals to recover 30–60% of retail instead of $0.`,
      primaryHref: "https://sellercentral.amazon.com/gp/ssof/configuration/index.html",
      primaryLabel: "Enable liquidation",
      tone: "warning",
    };
  }

  if (expired > 0 && defective + customerDamaged === 0) {
    return {
      label: "Dispose (expired)",
      detail: "Expired items can't be resold. Dispose to stop paying storage & LTSF.",
      primaryHref: "https://sellercentral.amazon.com/gp/ssof/knight/create-removal-order.html",
      primaryLabel: "Dispose",
      tone: "muted",
    };
  }

  if (defective > 0 && customerDamaged + expired === 0) {
    return {
      label: "Dispose (defective)",
      detail: "Defective units have no resale value. Dispose to stop paying storage & LTSF.",
      primaryHref: "https://sellercentral.amazon.com/gp/ssof/knight/create-removal-order.html",
      primaryLabel: "Dispose",
      tone: "muted",
    };
  }

  // Mixed non-reimbursable (customer + defective/expired): liquidate what has value.
  return {
    label: "Liquidate what's salvageable, dispose rest",
    detail: `${customerDamaged} customer-returned unit(s) may still resell as Used; the other ${defective + expired} defective/expired should be disposed.`,
    primaryHref: "https://sellercentral.amazon.com/gp/ssof/configuration/index.html",
    primaryLabel: "Configure removals",
    tone: "warning",
  };
}

const VERDICT_TONE: Record<Verdict["tone"], string> = {
  success: "border-success/40 text-success bg-success-light/50",
  warning: "border-warning/50 text-warning bg-warning-light/50",
  info: "border-info/40 text-info bg-info-light/50",
  muted: "border-border text-muted-foreground",
};

function UnfulfillableTable({
  rows,
  libraryHref,
  notReady,
}: {
  rows: UnfulfillableRow[];
  libraryHref: (sku: string) => string | null;
  notReady: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Unfulfillable inventory</CardTitle>
        <p className="text-sm text-muted-foreground">
          Units in FBA that Amazon can&apos;t sell. Amazon still charges you monthly storage on these — and LTSF
          once they age past 181 days. Warehouse / carrier / distributor damage is reimbursable (18-month claim
          window); customer damage, defective, and expired are your loss.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <AutoRemoveBanner />
        {notReady ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Amazon is generating the inventory report — reload in a minute.
          </p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No unfulfillable inventory. 🎉
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Unsellable</TableHead>
                  <TableHead>Breakdown</TableHead>
                  <TableHead>What to do</TableHead>
                  <TableHead>Age in FC</TableHead>
                  <TableHead className="text-right">Tied up</TableHead>
                  <TableHead className="text-right">Reimbursable $</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...rows]
                  .sort((a, b) => (b.reimbursableUsd ?? 0) - (a.reimbursableUsd ?? 0) || b.unsellableTotal - a.unsellableTotal)
                  .map((r) => {
                    const tiedUp = (r.yourPrice ?? 0) * r.unsellableTotal;
                    const reimbUsd = r.reimbursableUsd ?? 0;
                    const verdict = recommendAction(r);
                    return (
                      <TableRow key={r.sku}>
                        <SkuCell sku={r.sku} productName={r.productName} href={libraryHref(r.sku)} />
                        <TableCell className="text-right font-semibold tabular-nums text-destructive">
                          {r.unsellableTotal}
                        </TableCell>
                        <TableCell>
                          <BreakdownBadges row={r} />
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          <Badge variant="outline" className={cn("mb-1 text-[11px]", VERDICT_TONE[verdict.tone])}>
                            {verdict.label}
                          </Badge>
                          <div className="text-[11px] text-muted-foreground leading-snug">{verdict.detail}</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.oldestAgeBucket ? (
                            <span
                              className={cn(
                                r.oldestAgeBucket.startsWith("365") || r.oldestAgeBucket.startsWith("331")
                                  ? "text-destructive font-medium"
                                  : r.oldestAgeBucket.startsWith("181") || r.oldestAgeBucket.startsWith("271")
                                    ? "text-warning"
                                    : "text-muted-foreground",
                              )}
                            >
                              {r.oldestAgeBucket}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {tiedUp > 0 ? money(tiedUp) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {reimbUsd > 0 ? (
                            <span className="font-semibold text-success">{money(reimbUsd)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <a
                            href={verdict.primaryHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={cn(
                              "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium hover:underline",
                              verdict.tone === "success"
                                ? "border-success/40 text-success"
                                : verdict.tone === "warning"
                                  ? "border-warning/50 text-warning"
                                  : "border-border text-primary",
                            )}
                          >
                            {verdict.primaryLabel}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AutoRemoveBanner() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info-light px-3 py-2 text-sm">
      <PackageX className="mt-0.5 h-4 w-4 shrink-0 text-info" />
      <span>
        Amazon does <strong>not</strong> auto-dispose unfulfillable inventory by default — it sits at FBA
        accumulating storage &amp; LTSF fees until you act. Turn on{" "}
        <a
          href="https://sellercentral.amazon.com/gp/ssof/configuration/index.html"
          target="_blank"
          rel="noopener noreferrer"
          className="text-info underline"
        >
          Automated Unfulfillable Removals
        </a>{" "}
        to auto-dispose or auto-return going forward.
      </span>
    </div>
  );
}

function BreakdownBadges({ row }: { row: UnfulfillableRow }) {
  const buckets: [string, number, string][] = [
    ["warehouse", row.warehouseDamaged, "border-destructive/40 text-destructive"],
    ["carrier", row.carrierDamaged, "border-destructive/40 text-destructive"],
    ["customer", row.customerDamaged, "border-warning/50 text-warning"],
    ["distributor", row.distributorDamaged, "border-warning/50 text-warning"],
    ["defective", row.defective, "border-warning/50 text-warning"],
    ["expired", row.expired, "border-muted-foreground/40 text-muted-foreground"],
  ];
  const visible = buckets.filter(([, n]) => n > 0);
  if (visible.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map(([label, n, cls]) => (
        <Badge key={label} variant="outline" className={cn("text-[10px]", cls)}>
          {label} {n}
        </Badge>
      ))}
    </div>
  );
}
