"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
import {
  AlertTriangle,
  CheckCircle2,
  Search,
  Loader2,
  PackageSearch,
  TrendingDown,
  HelpCircle,
  Ruler,
  ExternalLink,
  History,
} from "lucide-react";
import { toast } from "sonner";
import type { AuditFinding, AuditResult } from "@platform/calc";
import type { AuditResponse, ConfigStatus, HistoryInfo } from "@/lib/auditTypes";
import { SkuHistoryDialog } from "./SkuHistoryDialog";
import { RateCardPanel } from "./RateCardPanel";
import { SippReportPanel } from "./SippReportPanel";

const money = (n: number | null | undefined, ccy = "USD") =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: ccy }).format(n);

const STATUS_META: Record<
  AuditFinding["status"],
  { label: string; className: string }
> = {
  overcharge: { label: "Overcharge", className: "bg-destructive text-destructive-foreground" },
  measurement_variance: {
    label: "Weight variance",
    className: "bg-warning text-warning-foreground",
  },
  undercharge: { label: "Undercharge", className: "bg-info text-info-foreground" },
  ok: { label: "OK", className: "bg-success text-success-foreground" },
  missing_measurement: { label: "No box dims", className: "bg-warning text-warning-foreground" },
  missing_amazon: { label: "Not in report", className: "bg-muted text-muted-foreground" },
};

const CONFIDENCE_META: Record<AuditFinding["confidence"], string> = {
  high: "border-destructive/40 text-destructive",
  medium: "border-warning/50 text-warning",
  low: "border-border text-muted-foreground",
};

export function AuditDashboard() {
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [source, setSource] = useState<"demo" | "live" | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<{ sku: string; reason: "absent" | "archived" }[]>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [libraryAppUrl, setLibraryAppUrl] = useState<string | null>(null);
  const [libraryIndex, setLibraryIndex] = useState<Record<string, string>>({});
  const [feeReport, setFeeReport] = useState<
    { cached: boolean; fetchedAt?: string; note?: string } | null
  >(null);
  const [history, setHistory] = useState<HistoryInfo | null>(null);
  const [historySku, setHistorySku] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // SKUs treated as SIPP-certified (lowercased), and the subset Amazon's SIPP
  // report certifies - those can't be unticked by hand.
  const [sippSkus, setSippSkus] = useState<Set<string>>(new Set());
  const [sippFromReport, setSippFromReport] = useState<Set<string>>(new Set());
  const loadSipp = useCallback(() => {
    fetch("/api/sipp")
      .then((r) => r.json())
      .then((d: { skus?: string[]; fromReport?: string[] }) => {
        setSippSkus(new Set(d.skus ?? []));
        setSippFromReport(new Set(d.fromReport ?? []));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/audit")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setConfig({ sellerCentral: false, productLibrary: false }));
    loadSipp();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [loadSipp]);

  const handleResponse = useCallback((data: AuditResponse) => {
    if (data.state === "result") {
      setResult(data.result);
      setSource(data.source);
      setSkipped(data.skippedSkus);
      setExcluded(data.excludedSkus ?? []);
      setLibraryAppUrl(data.libraryAppUrl);
      setLibraryIndex(data.libraryIndex);
      setHistory(data.history ?? null);
      setFeeReport(data.feeReport ?? null);
      setBusy(false);
      setStatusText(null);
      if (data.feeReport?.cached && data.feeReport.note) {
        toast.warning(data.feeReport.note);
      }
      const n = data.result.summary.overcharges;
      toast[n > 0 ? "warning" : "success"](
        n > 0
          ? `${n} overcharged SKU${n === 1 ? "" : "s"} — ${money(data.result.summary.recoverableTotal)} recoverable`
          : "No overcharges found",
      );
    } else if (data.state === "error") {
      setBusy(false);
      setStatusText(null);
      toast.error(data.message);
    }
    // "pending" is handled by the caller's polling loop.
  }, []);

  const runDemo = useCallback(async () => {
    setBusy(true);
    setStatusText("Auditing sample catalogue…");
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "demo" }),
      });
      handleResponse((await res.json()) as AuditResponse);
    } catch {
      setBusy(false);
      setStatusText(null);
      toast.error("Demo audit failed.");
    }
  }, [handleResponse]);

  const runLive = useCallback(
    async (reportId?: string) => {
      setBusy(true);
      setStatusText(reportId ? "Waiting for Amazon to finish the report…" : "Requesting fee report from Amazon…");
      try {
        const res = await fetch("/api/audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "live", reportId }),
        });
        const data = (await res.json()) as AuditResponse;
        if (data.state === "pending") {
          setStatusText(
            data.status
              ? `Amazon report status: ${data.status}. Re-checking shortly…`
              : "Amazon is generating the report. Re-checking shortly…",
          );
          pollRef.current = setTimeout(() => runLive(data.reportId), 8000);
          return;
        }
        handleResponse(data);
      } catch {
        setBusy(false);
        setStatusText(null);
        toast.error("Live audit failed.");
      }
    },
    [handleResponse],
  );

  const liveReady = config?.sellerCentral && config?.productLibrary;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <PackageSearch className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">FBA Fee Auditor</h1>
            <p className="text-sm text-muted-foreground">
              Compare Amazon&apos;s measured FBA fees against your real box measurements and flag overcharges.
            </p>
          </div>
        </div>
      </header>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <Button onClick={() => runLive()} disabled={busy || !liveReady}>
          {busy && source !== "demo" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
          Run live audit
        </Button>
        <Button variant="outline" onClick={runDemo} disabled={busy}>
          Run demo audit
        </Button>
        {statusText && <span className="text-sm text-muted-foreground">{statusText}</span>}
      </div>

      {!liveReady && <SetupChecklist config={config} />}

      {feeReport?.cached && (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <strong>Using the last good fee report</strong>
          {feeReport.fetchedAt &&
            ` (pulled ${new Date(feeReport.fetchedAt).toLocaleString()})`}
          . {feeReport.note}
        </div>
      )}

      <div className="mb-6">
        <RateCardPanel />
      </div>

      <div className="mb-6">
        <SippReportPanel
          onChanged={() => {
            loadSipp();
            // Re-audit against the new certification record, if one has run.
            if (result && source === "live") runLive();
          }}
        />
      </div>

      {result && (
        <>
          <SummaryCards result={result} source={source} />
          {skipped.length > 0 && (
            <p className="mb-4 text-sm text-warning">
              {skipped.length} SKU{skipped.length === 1 ? "" : "s"} in the Library had no usable dimensions and were skipped.
            </p>
          )}
          {excluded.length > 0 && <ExcludedNote excluded={excluded} />}
          {history && source === "live" && <HistoryBanner history={history} />}
          <FilterToolbar findings={result.findings} filter={filter} onChange={setFilter} />
          <FindingsTable
            findings={filterFindings(result.findings, filter)}
            filter={filter}
            libraryAppUrl={libraryAppUrl}
            libraryIndex={libraryIndex}
            changedSkus={new Set((history?.changedSkus ?? []).map((s) => s.toLowerCase()))}
            onOpenHistory={setHistorySku}
            sippSkus={sippSkus}
            sippFromReport={sippFromReport}
            sippEditable={source === "live"}
            onToggleSipp={async (sku, certified) => {
              const res = await fetch("/api/sipp", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sku, certified }),
              });
              if (!res.ok) {
                toast.error("Couldn't save the SIPP setting.");
                return;
              }
              const d = (await res.json()) as { skus: string[]; fromReport: string[] };
              setSippSkus(new Set(d.skus));
              setSippFromReport(new Set(d.fromReport));
              // Re-audit so the fee and notes reflect it straight away. This
              // reuses Amazon's latest finished report, so it costs no quota.
              runLive();
            }}
          />
        </>
      )}
      <SkuHistoryDialog sku={historySku} onClose={() => setHistorySku(null)} />
    </div>
  );
}

type FilterKey = "all" | "overcharge" | "measurement_variance" | "missing_measurement";

/** Apply the active filter and, for the "needs measurement" view, surface the
 *  highest-fee blind spots first (those cost the most to leave un-audited). */
/**
 * Say plainly which SKUs Amazon bills for that this audit left out, and why.
 * Silence here reads as "these were audited and are fine", which is the one
 * thing it doesn't mean.
 */
function ExcludedNote({
  excluded,
}: {
  excluded: { sku: string; reason: "absent" | "archived" }[];
}) {
  const absent = excluded.filter((e) => e.reason === "absent");
  const archived = excluded.filter((e) => e.reason === "archived");
  const n = excluded.length;

  return (
    <details className="mb-4 text-sm text-muted-foreground">
      <summary className="cursor-pointer">
        Scoped to the Product Library — {n} FBA SKU{n === 1 ? "" : "s"} Amazon bills us for{" "}
        {n === 1 ? "isn't" : "aren't"} live in the Library, so {n === 1 ? "it was" : "they were"}{" "}
        left out.
      </summary>
      {absent.length > 0 && (
        <div className="mt-2">
          <p>
            <strong>{absent.length} not in the Library</strong> — usually bundles, variation
            parents, or listings never added. Add one to bring it into the audit.
          </p>
          <p className="mt-1 font-mono text-xs">{absent.map((e) => e.sku).join(", ")}</p>
        </div>
      )}
      {archived.length > 0 && (
        <div className="mt-2">
          <p>
            <strong>{archived.length} archived in the Library</strong> — retired on purpose, so
            they stay out. Un-archive one to audit it again.
          </p>
          <p className="mt-1 font-mono text-xs">{archived.map((e) => e.sku).join(", ")}</p>
        </div>
      )}
    </details>
  );
}

function filterFindings(findings: AuditFinding[], filter: FilterKey): AuditFinding[] {
  if (filter === "all") return findings;
  const subset = findings.filter((f) => f.status === filter);
  if (filter === "measurement_variance") {
    return findings.filter((f) => f.status === "measurement_variance");
  }
  if (filter === "missing_measurement") {
    return [...subset].sort((a, b) => (b.amazonFee ?? 0) - (a.amazonFee ?? 0));
  }
  return subset;
}

function FilterToolbar({
  findings,
  filter,
  onChange,
}: {
  findings: AuditFinding[];
  filter: FilterKey;
  onChange: (f: FilterKey) => void;
}) {
  const counts = {
    all: findings.length,
    overcharge: findings.filter((f) => f.status === "overcharge").length,
    measurement_variance: findings.filter((f) => f.status === "measurement_variance").length,
    missing_measurement: findings.filter((f) => f.status === "missing_measurement").length,
  };
  const tabs: { key: FilterKey; label: string }[] = [
    { key: "all", label: "All" },
    { key: "overcharge", label: "Overcharges" },
    { key: "measurement_variance", label: "Weight variance" },
    { key: "missing_measurement", label: "Needs measurement" },
  ];
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "rounded-full border px-3 py-1 text-sm transition-colors",
            filter === t.key
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-muted-foreground hover:bg-muted",
          )}
        >
          {t.label}
          <span className="ml-1.5 tabular-nums opacity-70">{counts[t.key]}</span>
        </button>
      ))}
    </div>
  );
}

function SummaryCards({ result, source }: { result: AuditResult; source: "demo" | "live" | null }) {
  const s = result.summary;
  const needsMeasurement = result.findings.filter((f) => f.status === "missing_measurement").length;
  const cards = [
    { label: "Recoverable (per-unit total)", value: money(s.recoverablePerUnitTotal), icon: TrendingDown, tone: "text-destructive" },
    { label: "Overcharged SKUs", value: String(s.overcharges), icon: AlertTriangle, tone: "text-warning" },
    {
      label: "Weight variance",
      value: String(s.measurementVariances ?? 0),
      icon: AlertTriangle,
      tone: "text-warning",
    },
    { label: "Needs measurement", value: String(needsMeasurement), icon: Ruler, tone: "text-info" },
    { label: "SKUs audited", value: String(s.totalSkus), icon: CheckCircle2, tone: "text-muted-foreground" },
  ];
  return (
    <div className="mb-6">
      {source === "demo" && (
        <Badge variant="outline" className="mb-3">
          Demo data — connect your accounts for a live audit
        </Badge>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{c.label}</span>
                <c.icon className={cn("h-4 w-4", c.tone)} />
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

const FILTER_TITLE: Record<FilterKey, string> = {
  all: "Findings",
  overcharge: "Overcharges",
  measurement_variance: "Amazon's weight crosses a fee band",
  missing_measurement: "SKUs needing measurement",
};

const FILTER_EMPTY: Record<FilterKey, string> = {
  all: "No findings.",
  overcharge: "No overcharges found — your measurements match Amazon's. 🎉",
  measurement_variance:
    "No SKUs where Amazon's weight pushes you into a higher fee band. 🎉",
  missing_measurement: "Every audited SKU has box dimensions in the Product Library. 🎉",
};

function FindingsTable({
  findings,
  filter,
  libraryAppUrl,
  libraryIndex,
  changedSkus,
  onOpenHistory,
  sippSkus,
  sippFromReport,
  sippEditable,
  onToggleSipp,
}: {
  findings: AuditFinding[];
  filter: FilterKey;
  libraryAppUrl: string | null;
  libraryIndex: Record<string, string>;
  changedSkus: Set<string>;
  onOpenHistory: (sku: string) => void;
  sippSkus: Set<string>;
  /** Certified by Amazon's SIPP report — shown ticked and locked. */
  sippFromReport: Set<string>;
  /** Only for a live audit - demo SKUs aren't yours to certify. */
  sippEditable: boolean;
  onToggleSipp: (sku: string, certified: boolean) => void;
}) {
  const isMissing = filter === "missing_measurement";

  // Deep link to the product's Packaging Specs tab in the supply-chain-app.
  // Known product id → straight to /products/{id}?tab=specs; unknown SKU →
  // the products list so it can be found or created.
  const libraryHref = (sku: string): string | null => {
    if (!libraryAppUrl) return null;
    const id = libraryIndex[sku.trim().toLowerCase()];
    return id ? `${libraryAppUrl}/products/${id}?tab=specs` : `${libraryAppUrl}/products`;
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{FILTER_TITLE[filter]}</CardTitle>
        {isMissing && findings.length > 0 && (
          <p className="text-sm text-muted-foreground">
            These SKUs sell on FBA but have no unit box dimensions in the Product Library, so they can&apos;t be
            audited yet. Add a <span className="font-medium">unit</span> packaging spec for each — highest Amazon fee
            first.
          </p>
        )}
      </CardHeader>
      <CardContent>
        {findings.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{FILTER_EMPTY[filter]}</p>
        ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Amazon tier → Correct tier</TableHead>
                <TableHead className="text-right">Amazon fee</TableHead>
                <TableHead className="text-right">Correct fee</TableHead>
                <TableHead className="text-right">Δ / unit</TableHead>
                <TableHead className="text-right">Recoverable</TableHead>
                <TableHead>Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {findings.map((f) => {
                const meta = STATUS_META[f.status];
                const href = libraryHref(f.sku);
                return (
                  <TableRow key={f.sku}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenHistory(f.sku)}
                          className="text-primary hover:underline"
                          title="View Amazon measurement history"
                        >
                          {f.sku}
                        </button>
                        {href && (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open in Product Library"
                          >
                            <ExternalLink className="h-3 w-3 opacity-60 hover:opacity-100" />
                          </a>
                        )}
                      </div>
                      {f.productName && <div className="text-xs text-muted-foreground">{f.productName}</div>}
                      {sippEditable && (
                        <label
                          className={cn(
                            "mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground",
                            sippFromReport.has(f.sku.toLowerCase()) ? "cursor-default" : "cursor-pointer",
                          )}
                          title={
                            sippFromReport.has(f.sku.toLowerCase())
                              ? "Certified in Amazon's SIPP report. Upload a newer report to change it."
                              : "Ships in Product Packaging. Tick only if Seller Central shows this listing as SIPP-certified - the audit then checks Amazon applies the discount."
                          }
                        >
                          <input
                            type="checkbox"
                            className="h-3 w-3"
                            checked={sippSkus.has(f.sku.toLowerCase())}
                            disabled={sippFromReport.has(f.sku.toLowerCase())}
                            onChange={(e) => onToggleSipp(f.sku, e.target.checked)}
                          />
                          SIPP-certified
                          {sippFromReport.has(f.sku.toLowerCase()) && <span>(SIPP report)</span>}
                          {f.sippDiscount != null && (
                            <span className="text-success">(−${f.sippDiscount.toFixed(2)}/unit)</span>
                          )}
                        </label>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge className={meta.className}>{meta.label}</Badge>
                        {f.status === "overcharge" && (
                          <Badge variant="outline" className={cn("text-[10px]", CONFIDENCE_META[f.confidence])}>
                            {f.confidence} confidence
                          </Badge>
                        )}
                        {(f.dimsDiffer || f.weightDiffer) && (
                          <Badge variant="outline" className="text-[10px] border-warning/50 text-warning">
                            Δ {[f.dimsDiffer && "dims", f.weightDiffer && "weight"].filter(Boolean).join(" + ")} differ
                          </Badge>
                        )}
                        {changedSkus.has(f.sku.toLowerCase()) && (
                          <Badge variant="outline" className="text-[10px] border-info/50 text-info">
                            ⟳ Amazon changed
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {f.amazonTier ?? "—"}
                      {f.tierInflated && f.correctTier && (
                        <span className="text-muted-foreground"> → {f.correctTier}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(f.amazonFee)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(f.correctFee)}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        f.feeDeltaPerUnit > 0 ? "text-destructive" : f.feeDeltaPerUnit < 0 ? "text-info" : "",
                      )}
                    >
                      {f.feeDeltaPerUnit > 0 ? "+" : ""}
                      {money(f.feeDeltaPerUnit)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {f.recoverablePerUnit > 0 ? money(f.recoverablePerUnit) : "—"}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      {f.status === "missing_measurement" && href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                        >
                          Add dimensions
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : f.notes.length > 0 ? (
                        <span className="text-xs text-muted-foreground">{f.notes[0]}</span>
                      ) : f.status === "ok" ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                          Matches Amazon — no action
                        </span>
                      ) : (
                        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
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

function HistoryBanner({ history }: { history: HistoryInfo }) {
  if (!history.available) {
    return (
      <div className="mb-3 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <History className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Measurement history isn&apos;t set up yet — run the{" "}
          <code className="rounded bg-muted px-1">fba_measurement_snapshots</code> migration to track Amazon&apos;s
          measurements over time.
        </span>
      </div>
    );
  }
  if (history.baseline) {
    return (
      <div className="mb-3 flex items-start gap-2 rounded-md border border-info/30 bg-info-light px-3 py-2 text-sm">
        <History className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <span>Baseline saved — recorded Amazon&apos;s current measurements for {history.recorded} SKU(s). Future changes will be flagged here.</span>
      </div>
    );
  }
  if (history.changedSkus.length > 0) {
    return (
      <div className="mb-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning-light px-3 py-2 text-sm">
        <History className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <span>
          Amazon changed measurements on <strong>{history.changedSkus.length}</strong> SKU(s) since the last run:{" "}
          {history.changedSkus.slice(0, 8).join(", ")}
          {history.changedSkus.length > 8 ? "…" : ""}
        </span>
      </div>
    );
  }
  return (
    <div className="mb-3 flex items-start gap-2 rounded-md border border-success/30 bg-success-light px-3 py-2 text-sm">
      <History className="mt-0.5 h-4 w-4 shrink-0 text-success" />
      <span>No Amazon measurement changes since the last run.</span>
    </div>
  );
}

function SetupChecklist({ config }: { config: ConfigStatus | null }) {
  const items = [
    {
      ok: config?.sellerCentral ?? false,
      title: "Seller-Central API",
      detail: "Set SELLER_CENTRAL_API_URL and SELLER_CENTRAL_API_KEY to reach your SP-API gateway.",
    },
    {
      ok: config?.productLibrary ?? false,
      title: "Product Library (supply-chain-app Supabase)",
      detail: "Set PRODUCT_LIBRARY_SUPABASE_KEY to the project's service_role key (URL is pre-filled).",
    },
  ];
  return (
    <Card className="mb-8 border-warning/40">
      <CardHeader>
        <CardTitle className="text-base">Finish setup to run a live audit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((it) => (
          <div key={it.title} className="flex items-start gap-3">
            {it.ok ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 text-warning" />
            )}
            <div>
              <div className="font-medium">{it.title}</div>
              <div className="text-sm text-muted-foreground">{it.detail}</div>
            </div>
          </div>
        ))}
        <p className="pt-1 text-sm text-muted-foreground">
          Meanwhile, click <span className="font-medium">Run demo audit</span> to see how findings look.
        </p>
      </CardContent>
    </Card>
  );
}
