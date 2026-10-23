"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  aggregatePeriods,
  classifySkus,
  comparePeriods,
  monthsForSkus,
  SKU_CLASSES,
  type SkuClass,
  type SkuClassInfo,
  matchScorecard,
  skuPeriodRows,
  type Granularity,
  type InventoryMonthSummary,
  type InventorySkuRow,
  type PeriodSummary,
} from "@platform/supply-chain-data";
import { cn } from "@platform/ui";
import type { MonthStatus } from "@/app/api/months/route";
import { CostChart } from "@/components/CostChart";
import { ShareChart } from "@/components/ShareChart";
import { PeriodTable, type CompareTo } from "@/components/PeriodTable";
import { SkuTable } from "@/components/SkuTable";
import { AgePanel, type AgeNow } from "@/components/AgePanel";
import { Change, changeOf } from "@/components/Change";
import { Scorecard } from "@/components/Scorecard";
import { CoverSection } from "@/components/CoverSection";
import { CategoryContext, CLASS_LABEL, CLASS_MEANING, SkuClassContext } from "@/components/ClassTag";
import { Segmented } from "@/components/ui";
import { Definitions } from "@/components/PeriodTable";
import { count, money, monthLabel, setCurrency } from "@/lib/format";
import { METRICS, periodLabel, type MetricKey } from "@/lib/metrics";

type SourceState = "ready" | "scanning" | "failed" | "unavailable";

interface Payload {
  months: InventoryMonthSummary[];
  skus: InventorySkuRow[];
  status: MonthStatus[];
  market: "US" | "CA";
  currency: string;
  busy: boolean;
  blocked: MonthStatus | null;
  inventory: {
    ledger: SourceState;
    awd: SourceState;
    inStock: SourceState;
    aged: SourceState;
    agedPending: string[];
    snapshotDays: number;
    ageNow: AgeNow | null;
  };
  /** SKU -> category (product line) from the Product Library. */
  categories: Record<string, string>;
  categoryLines: string[];
  categoriesError: string | null;
  error?: string;
}

const RANGES = [12, 24, "all"] as const;

const TABS = [
  ["overview", "Overview"],
  ["storage", "Storage vs target"],
  ["periods", "By period"],
  ["skus", "SKUs"],
  ["age", "Inventory age"],
] as const;
type Tab = (typeof TABS)[number][0];
const POLL_MS = 20_000;

const HEADLINE: MetricKey[][] = [
  ["netSales", "supplyChainCost", "supplyChainShareOfSales", "controllablePerUnit", "storageShareOfSales", "contributionShare"],
  ["turnover", "daysOfInventory", "inventoryValue", "sellThrough", "excessShare", "gmroi"],
];

export default function Page() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("all");
  const [market, setMarket] = useState<"US" | "CA">("US");
  // A quarter against the same quarter last year is the fair default for a
  // seasonal business: long enough to smooth a month's noise, and judged
  // against its own season.
  const [granularity, setGranularity] = useState<Granularity>("quarter");
  const [compare, setCompare] = useState<CompareTo>("yoy");
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollTick, setPollTick] = useState(0);
  const [tab, setTab] = useState<Tab>("overview");
  const [segment, setSegment] = useState<"all" | SkuClass>("all");
  /** "all", a product line, or "" for SKUs with no category in the Library. */
  const [category, setCategory] = useState<string>("all");
  const [channel, setChannel] = useState<"fba" | "awd">("fba");
  const [seasonal, setSeasonal] = useState<Record<string, number>>({});
  useEffect(() => {
    fetch("/api/seasonal", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: Record<string, number>) => setSeasonal(j))
      .catch(() => {
        /* no saved setting: nothing is seasonal */
      });
  }, []);
  const saveSeasonal = (next: Record<string, number>) => {
    setSeasonal(next);
    void fetch("/api/seasonal", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
  };

  // The tab lives in the address (#storage) so a reload or a shared link opens it.
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (TABS.some(([k]) => k === h)) setTab(h as Tab);
  }, []);
  const chooseTab = (t: Tab) => {
    setTab(t);
    window.history.replaceState(null, "", `#${t}`);
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/months?count=${range}&market=${market}`, { cache: "no-store" });
      const j = (await res.json()) as Payload & { productNames?: Record<string, string> };
      if (!res.ok || j.error) throw new Error(j.error ?? `HTTP ${res.status}`);
      // Names come once per product; put them back on the rows.
      const names = j.productNames ?? {};
      j.skus = j.skus.map((r) => ({ ...r, productName: names[r.sku] ?? "" }));
      setData(j);
      setError(null);
      lastFull.current = Date.now();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [range, market]);
  const lastFull = useRef(0);
  const lastSignature = useRef<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  // While history is still loading, ask the small status endpoint what has
  // changed and fetch the full figures only when a month has finished (or
  // every five minutes, for the slower inventory pulls). The gateway does the
  // loading itself; the page only has to notice.
  useEffect(() => {
    if (!data?.busy && !error) return;
    const t = setTimeout(async () => {
      try {
        const s = (await (await fetch("/api/status", { cache: "no-store" })).json()) as { cached?: number; current?: string | null };
        const signature = `${s.cached}|${s.current}`;
        const stale = Date.now() - lastFull.current > 5 * 60_000;
        if (error || signature !== lastSignature.current || stale) {
          lastSignature.current = signature;
          await load();
        } else {
          // Nothing new: schedule the next look without re-rendering the page.
          setPollTick((n) => n + 1);
        }
      } catch {
        setPollTick((n) => n + 1);
      }
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [data, error, load, pollTick]);

  const feeReady = useMemo(
    () => new Set(data?.status.filter((s) => s.fees === "ready").map((s) => s.month)),
    [data],
  );
  // Canada sells in C$ but its stock is costed at landed cost in US$, so the
  // measures that set one against the other are left out rather than shown wrong.
  const isCA = data?.market === "CA";
  const noMixedCurrency = useCallback(
    (ps: PeriodSummary[]) =>
      isCA ? ps.map((p) => ({ ...p, contributionMargin: null, contributionShare: null, gmroi: null, landedCostPerUnit: null })) : ps,
    [isCA],
  );
  // Classes are as of the newest month whose fees are read, and stay put
  // whatever period is on screen: "how did today's top sellers do last year".
  const asOf = useMemo(() => [...feeReady].sort().at(-1) ?? null, [feeReady]);
  const classes = useMemo(() => (data && asOf ? classifySkus(data.skus, asOf) : {}), [data, asOf]);
  // Class and category narrow together: "A sellers among the splash pads".
  const keep = useMemo(() => {
    if (segment === "all" && category === "all") return null;
    const cats = data?.categories ?? {};
    const skus = new Set([...(data?.skus ?? []).map((r) => r.sku)]);
    return new Set(
      [...skus].filter(
        (sku) =>
          (segment === "all" || classes[sku]?.cls === segment) &&
          (category === "all" || (cats[sku] ?? "") === category),
      ),
    );
  }, [classes, segment, category, data]);
  const skusShown = useMemo(() => (data ? (keep ? data.skus.filter((r) => keep.has(r.sku)) : data.skus) : []), [data, keep]);
  const monthsShown = useMemo(
    () => (data ? (keep ? monthsForSkus(data.months, data.skus, keep) : data.months) : []),
    [data, keep],
  );

  const periods = useMemo(
    () => (data ? noMixedCurrency(aggregatePeriods(monthsShown, granularity, feeReady)) : []),
    [data, monthsShown, granularity, feeReady, noMixedCurrency],
  );
  const monthly = useMemo(
    () => (data ? noMixedCurrency(aggregatePeriods(monthsShown, "month", feeReady)) : []),
    [data, monthsShown, feeReady, noMixedCurrency],
  );
  const changes = useMemo(
    () => (data ? comparePeriods(periods, monthsShown, feeReady) : new Map()),
    [data, monthsShown, periods, feeReady],
  );

  // Default to the newest period whose costs are complete, storage included:
  // the month just closed has no storage bill yet and would read as cheap.
  const complete = periods.filter((p) => p.feeMonths === p.months.length);
  const fallback =
    complete.filter((p) => p.storageShareOfSales != null).at(-1) ?? complete.at(-1) ?? periods.at(-1) ?? null;
  const current = periods.find((p) => p.key === selected) ?? fallback;
  const base = current ? changes.get(current.key)?.[compare] ?? null : null;

  const vsLabel = compare === "yoy" ? "YoY" : granularity === "month" ? "MoM" : granularity === "quarter" ? "QoQ" : "YoY";
  const baseName = base ? periodLabel(base.key, base.granularity, true) : null;
  const matched = useMemo(
    () => (data && current ? matchScorecard(current, base, monthsShown, feeReady) : {}),
    [data, monthsShown, current, base, feeReady],
  );
  const agedByMonth = useMemo(
    () => Object.fromEntries(monthsShown.map((m) => [m.month, m.agedSurcharge])),
    [monthsShown],
  );
  const skuRows = useMemo(
    () => (data && current ? skuPeriodRows(skusShown, current.months, base?.months ?? null) : []),
    [data, skusShown, current, base],
  );
  // A class filter shares out the aged surcharge for months before Amazon's per-SKU aged report:
  // fine inside the storage totals, but not a fair basis for judging the surcharge itself.
  const agedEstimated = useMemo(() => {
    if (!keep || !data || !current) return false;
    const perSku = new Set(data.skus.filter((r) => r.agedSurcharge != null).map((r) => r.month));
    return [...current.months, ...(base?.months ?? [])].some((m) => !perSku.has(m));
  }, [keep, data, current, base]);
  // SKUs per category, among those with a class (sold or held stock).
  const categoryCount = useMemo(() => {
    const out: Record<string, number> = {};
    for (const sku of Object.keys(classes)) {
      const c = data?.categories[sku] ?? "";
      out[c] = (out[c] ?? 0) + 1;
    }
    return out;
  }, [classes, data]);
  const classCount = useMemo(() => {
    const out: Partial<Record<SkuClass, number>> = {};
    for (const c of Object.values(classes)) out[c.cls] = (out[c.cls] ?? 0) + 1;
    return out;
  }, [classes]);
  const names = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of data?.skus ?? []) if (r.productName) out[r.sku] = r.productName;
    return out;
  }, [data]);

  const scanningNow = data?.status.find((s) => s.fees === "scanning")?.month ?? null;
  const heliumMonths = useMemo(() => new Set(data?.status.filter((s) => s.source === "helium").map((s) => s.month)), [data]);
  const unavailableMonths = useMemo(() => new Set(data?.status.filter((s) => s.fees === "unavailable").map((s) => s.month)), [data]);
  const periodFromHelium = current ? current.months.every((m) => heliumMonths.has(m)) : false;
  const waiting = data?.status.filter((s) => s.fees === "queued" || s.fees === "scanning").length ?? 0;
  const loadingSources = data
    ? ([
        ["inventory ledger", data.inventory.ledger],
        ["AWD shipments and orders", data.inventory.awd],
        ["daily in-stock ledger", data.inventory.inStock],
        ["aged-surcharge reports", data.inventory.aged],
      ] as const).filter(([, st]) => st !== "ready")
    : [];

  setCurrency(data?.currency ?? "USD");

  return (
    <SkuClassContext.Provider value={classes}>
    <CategoryContext.Provider value={data?.categories ?? {}}>
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight">Supply chain</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isCA
              ? "Amazon.ca: what FBA cost, against what the stock sold, in Canadian dollars."
              : "Amazon.com: what FBA and AWD cost, against what the stock sold, in US dollars."}
          </p>
        </header>

        {error && (
          <div role="alert" className="mb-6 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
            <p className="font-medium">Couldn&apos;t load the figures.</p>
            <p className="mt-1 text-muted-foreground">
              {/fetch/i.test(error)
                ? "The app's server didn't answer. Start it (pnpm --filter @platform/supply-chain dev) and this page retries on its own."
                : error}
            </p>
          </div>
        )}
        {!data && !error && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading the figures…
          </p>
        )}

        {data?.blocked && (
          <div role="alert" className="mb-6 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
            <p className="font-medium">Reading {monthLabel(data.blocked.month, "long")} failed, so the months behind it are on hold.</p>
            <p className="mt-1 text-muted-foreground">{explain(data.blocked.error)}</p>
            <button type="button" onClick={() => void load()} className="mt-2 min-h-11 rounded-md border border-border bg-background px-3 py-1 text-sm hover:bg-muted sm:min-h-0">
              Retry
            </button>
          </div>
        )}

        {data && !data.blocked && (waiting > 0 || loadingSources.length > 0) && (
          <p role="status" className="mb-4 text-sm text-muted-foreground">
            {waiting > 0 &&
              `${scanningNow ? `Reading ${monthLabel(scanningNow, "long")} from Amazon. ` : ""}${waiting} month${waiting === 1 ? "" : "s"} of fees still to read, about six minutes each; finished months are kept. `}
            {loadingSources.map(([name, st]) => `${name}: ${st === "scanning" ? "loading" : st}`).join(" · ")}
            {data.inventory.agedPending.length ? ` (${data.inventory.agedPending.length} months of aged surcharge to fetch)` : ""}
          </p>
        )}

        {/* One place for every choice that changes what the tabs show. */}
        <div className="-mx-4 mb-6 border-b border-border bg-background px-4 pt-3 sm:sticky sm:top-0 sm:z-20 sm:-mx-6 sm:px-6">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Segmented
              label="Marketplace"
              value={market}
              options={[["US", "US"], ["CA", "Canada"]]}
              onChange={(m) => {
                setMarket(m);
                setSelected(null);
                setData(null);
                if (m === "CA") setChannel("fba"); // no AWD in Canada
              }}
            />
            <Segmented
              label="Period length"
              value={granularity}
              options={[["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]]}
              onChange={(g) => {
                setGranularity(g);
                setSelected(null);
              }}
            />
            {current ? (
              <>
                <label htmlFor="period" className="sr-only">
                  Period
                </label>
                <select
                  id="period"
                  value={current.key}
                  onChange={(e) => setSelected(e.target.value)}
                  className="h-11 rounded-md border border-input bg-background px-2 font-medium sm:h-8"
                >
                  {[...periods].reverse().map((p) => (
                    <option key={p.key} value={p.key}>
                      {periodLabel(p.key, p.granularity, true)}
                      {p.toDate ? " to date" : ""}
                      {p.feeMonths < p.months.length ? " (incomplete)" : ""}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">compared with</span>
                <ComparePicker period={current} changes={changes} compare={compare} onChange={setCompare} />
              </>
            ) : null}
            <Segmented
              label="SKU class"
              value={segment}
              options={[
                ["all", "All SKUs"],
                ...SKU_CLASSES.map((c) => [c, `${CLASS_LABEL[c]} ${classCount[c] ?? 0}`] as const),
              ]}
              onChange={(v) => setSegment(v)}
            />
            {data && data.categoryLines.length ? (
              <>
                <label htmlFor="category" className="sr-only">
                  Category
                </label>
                <select
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="h-11 rounded-md border border-input bg-background px-2 sm:h-8"
                >
                  <option value="all">All categories</option>
                  {data.categoryLines.map((l) => (
                    <option key={l} value={l}>
                      {l} ({categoryCount[l] ?? 0})
                    </option>
                  ))}
                  <option value="">No category in Product Library ({categoryCount[""] ?? 0})</option>
                </select>
              </>
            ) : null}
            <Segmented
              label="History loaded"
              value={range}
              options={RANGES.map((r) => [r, r === "all" ? "All" : `${r} mo`] as const)}
              onChange={setRange}
              className="sm:ml-auto"
            />
          </div>
          <div role="tablist" aria-label="Views" className="mt-3 flex gap-1 overflow-x-auto overflow-y-hidden">
            {TABS.map(([key, text]) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`tab-${key}`}
                aria-selected={tab === key}
                aria-controls={`panel-${key}`}
                onClick={() => chooseTab(key)}
                className={cn(
                  "-mb-px min-h-11 whitespace-nowrap border-b-2 px-3 text-sm sm:min-h-0 sm:py-2",
                  tab === key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {key === "periods" ? `By ${granularity}` : text}
              </button>
            ))}
          </div>
        </div>

        {keep && (
          <p className="-mt-3 mb-6 text-sm text-muted-foreground">
            Showing {[...keep].filter((sku) => classes[sku]).length} SKUs:{" "}
            {segment !== "all" ? `class ${CLASS_LABEL[segment]} (${CLASS_MEANING[segment].toLowerCase()}, as of ${asOf ? monthLabel(asOf, "long") : "the newest month"})` : "every class"}
            {category !== "all" ? `, ${category ? `category ${category}` : "no category in the Product Library"}` : ""}. Inbound, removals and other order fees are shared out by units
            received and sales, and aged surcharge before October 2025 by FBA storage cost; Amazon&apos;s storage utilisation ratio exists for the whole account only.
          </p>
        )}

        {current && data && (
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "overview" && (
              <>
                <section className="mb-12">
                  <h2 className="mb-1 text-xl font-semibold tracking-tight">Is the supply chain improving?</h2>
                  <p className="mb-4 text-sm text-muted-foreground">
                    Measures you move, per unit or per dollar of stock so sales volume can&apos;t flatter them; in-stock rate is
                    there so a leaner inventory only counts if customers could still buy.
                  </p>
                  <Scorecard
                    current={current}
                    base={base}
                    currentName={periodLabel(current.key, current.granularity)}
                    baseName={base ? periodLabel(base.key, base.granularity) : null}
                    history={monthly}
                    exclude={[...(isCA ? ["awdStoragePerUnitMonth", "gmroi"] : []), ...(agedEstimated ? ["agedSurcharge"] : [])]}
                    matched={matched}
                  />
                </section>

                <section className="mb-12">
                  <h2 className="mb-4 text-xl font-semibold tracking-tight">Headline figures</h2>
                  {HEADLINE.map((row, i) => (
                    <dl
                      key={i}
                      className={cn("grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3 lg:grid-cols-6", i > 0 && "mt-6 border-t border-border pt-6")}
                    >
                      {row.map((k) => (
                        <Stat key={k} p={current} base={base} k={k} />
                      ))}
                    </dl>
                  ))}
                  {isCA ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Sales and fees are in Canadian dollars; stock is valued at landed cost in US dollars, so contribution, GMROI
                      and landed cost per unit aren&apos;t shown for Canada. There is no AWD in Canada.
                    </p>
                  ) : null}
                  <Definitions metrics={HEADLINE.flat().map((k) => METRICS[k])} />
                </section>

                {complete.length > 0 && (
                  <section className="grid gap-10 lg:grid-cols-2">
                    <div>
                      <h2 className="mb-3 font-medium">Supply-chain cost</h2>
                      <CostChart
                        periods={complete}
                        bases={complete.map((p) => changes.get(p.key)?.[compare] ?? null)}
                        baseLabel={compare === "yoy" ? "Same period last year" : "Prior period"}
                      />
                    </div>
                    <div>
                      <h2 className="mb-3 font-medium">Cost as a share of net sales</h2>
                      <ShareChart periods={complete} />
                    </div>
                  </section>
                )}
              </>
            )}

            {tab === "storage" && (
              <section>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-xl font-semibold tracking-tight">
                    {channel === "awd" ? "AWD" : "FBA"} storage against target days of cover
                  </h2>
                  {!isCA ? (
                    <Segmented
                      label="Storage"
                      value={channel}
                      options={[["fba", "FBA"], ["awd", "AWD"]]}
                      onChange={setChannel}
                    />
                  ) : null}
                </div>
                <p className="mb-4 text-sm text-muted-foreground">
                  {channel === "awd"
                    ? "Stock waiting at AWD: what AWD storage would have cost holding the target days there, against what Amazon charged."
                    : "What FBA storage would have cost holding the target days of stock in FBA on every day, against what Amazon charged."}
                </p>
                <CoverSection
                  key={channel}
                  rows={skusShown}
                  period={current}
                  base={base}
                  agedByMonth={agedByMonth}
                  seasonal={seasonal}
                  onSeasonalChange={saveSeasonal}
                  channel={isCA ? "fba" : channel}
                />
              </section>
            )}

            {tab === "periods" && (
              <section>
                <h2 className="mb-1 text-xl font-semibold tracking-tight">By {granularity}</h2>
                <p className="mb-3 text-sm text-muted-foreground">
                  Changes are {compare === "yoy" ? "against the same months a year earlier" : `against the prior ${granularity}`},
                  like for like. Storage is filed under the month it was for. FBA stock is Amazon&apos;s ledger; AWD stock is worked
                  back from today&apos;s. Click a row to make it the period every tab shows.
                </p>
                <PeriodTable
                  periods={periods}
                  changes={changes}
                  compare={compare}
                  selected={current.key}
                  onSelect={setSelected}
                  scanning={scanningNow}
                  heliumMonths={heliumMonths}
                  unavailableMonths={unavailableMonths}
                />
              </section>
            )}

            {tab === "skus" && (
              <section>
                <h2 className="mb-1 text-xl font-semibold tracking-tight">
                  SKUs in {periodLabel(current.key, current.granularity, true)}
                  {baseName ? <span className="font-normal text-muted-foreground"> · changes vs {baseName}</span> : null}
                </h2>
                <ClassSummary classes={classes} asOf={asOf} />
                <CategorySummary classes={classes} categories={data.categories} lines={data.categoryLines} error={data.categoriesError} />
                <p className="mb-3 text-sm text-muted-foreground">
                  Sales and fulfilment fees per order line; FBA storage from Amazon&apos;s per-ASIN report; AWD processing and
                  transport traced to the shipments and orders that moved each SKU, AWD storage shared by units held.
                </p>
                {periodFromHelium ? (
                  <p className="text-sm text-muted-foreground">
                    No per-SKU detail for this period: it is older than Amazon&apos;s finance API keeps (730 days), and the Helium
                    10 history it comes from is account totals only.
                  </p>
                ) : (
                  <SkuTable rows={skuRows} vsLabel={vsLabel} />
                )}
              </section>
            )}

            {tab === "age" && (
              <section>
                <h2 className="mb-1 text-xl font-semibold tracking-tight">Inventory age</h2>
                {isCA ? (
                  <p className="text-sm text-muted-foreground">
                    The daily inventory-age snapshot reads Amazon&apos;s US planning report only. Canada&apos;s aged surcharge is in
                    the storage tab.
                  </p>
                ) : (
                  <AgePanel
                    ageNow={
                      data.inventory.ageNow && keep
                        ? { ...data.inventory.ageNow, bySku: Object.fromEntries(Object.entries(data.inventory.ageNow.bySku).filter(([sku]) => keep.has(sku.toUpperCase()))) }
                        : data.inventory.ageNow
                    }
                    days={data.inventory.snapshotDays}
                    names={names}
                  />
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </main>
    </CategoryContext.Provider>
    </SkuClassContext.Provider>
  );
}

/**
 * The comparison, chosen where it is stated: each option names the period it
 * means ("July 2026", "August 2025"), so nobody has to work out what "prior"
 * points at. An option with no data says so instead of offering an empty choice.
 */
function ComparePicker({
  period,
  changes,
  compare,
  onChange,
}: {
  period: PeriodSummary;
  changes: Map<string, { prev: PeriodSummary | null; yoy: PeriodSummary | null }>;
  compare: CompareTo;
  onChange: (c: CompareTo) => void;
}) {
  const c = changes.get(period.key);
  const g = period.granularity;
  const opts: Array<[CompareTo, string, PeriodSummary | null | undefined]> =
    g === "year"
      ? [["yoy", "last year", c?.yoy]]
      : [
          ["prev", g === "month" ? "prior month" : "prior quarter", c?.prev],
          ["yoy", "same period last year", c?.yoy],
        ];
  return (
    <div role="group" aria-label="Compare with" className="flex flex-wrap rounded-md border border-border p-0.5">
      {opts.map(([key, kind, base]) => (
        <button
          key={key}
          type="button"
          aria-pressed={compare === key || g === "year"}
          onClick={() => onChange(key)}
          className={cn(
            "min-h-11 rounded px-3 whitespace-nowrap sm:min-h-0 sm:py-1",
            compare === key || g === "year" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {base ? periodLabel(base.key, base.granularity, true) : `${kind} (no data)`}
          <span className="ml-1 text-xs opacity-75">
            <span aria-hidden="true">{kind === "same period last year" || kind === "last year" ? "YoY" : g === "month" ? "MoM" : "QoQ"}</span>
            <span className="sr-only">, {kind}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Stat({ p, base, k }: { p: PeriodSummary; base: PeriodSummary | null; k: MetricKey }) {
  const m = METRICS[k];
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{m.label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{m.format(p[k] as number | null)}</dd>
      <dd className="mt-0.5 min-h-4">
        <Change metric={m} value={changeOf(m, p, base)} />
      </dd>
    </div>
  );
}

/** Amazon's errors, in words that say what to do. */
function explain(error?: string): string {
  if (!error) return "No reason was given.";
  if (/invalid_client|Client authentication failed/i.test(error)) {
    return "Amazon rejected the gateway's Login with Amazon client credentials (invalid_client). The client secret has most likely expired: rotate it in the Seller Central developer console, put the new one in seller-central-api/.env as AMAZON_CLIENT_SECRET, and restart the gateway.";
  }
  if (/invalid_grant/i.test(error)) {
    return "Amazon rejected the gateway's refresh token (invalid_grant). Re-authorise the app in Seller Central and update AMAZON_REFRESH_TOKEN in seller-central-api/.env.";
  }
  return error;
}

/** How the catalogue splits into classes: SKUs, sales and stock in each. */
function ClassSummary({ classes, asOf }: { classes: Record<string, SkuClassInfo>; asOf: string | null }) {
  const all = Object.values(classes);
  if (!all.length) return null;
  const total = all.reduce((a, c) => a + c.sales12, 0);
  return (
    <div className="mb-6">
      <h3 className="mb-1 text-sm font-medium">SKU classes{asOf ? `, as of ${monthLabel(asOf, "long")}` : ""}</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        Ranked by net sales over the last 12 months. A SKU moves class as its sales move. Use the class filter at the top to
        see any tab for one class.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Class</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">What it is</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">SKUs</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Net sales, 12 months</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {SKU_CLASSES.map((c) => {
              const rows = all.filter((x) => x.cls === c);
              const sales = rows.reduce((a, x) => a + x.sales12, 0);
              return (
                <tr key={c} className="border-t border-border">
                  <th scope="row" className="px-3 py-2 text-left font-medium">{CLASS_LABEL[c]}</th>
                  <td className="px-3 py-2 text-muted-foreground">{CLASS_MEANING[c]}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{count(rows.length)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(sales)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{total > 0 ? `${((sales / total) * 100).toFixed(1)}%` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Sales and class mix per category (product line), over the same 12 months as the classes. */
function CategorySummary({
  classes,
  categories,
  lines,
  error,
}: {
  classes: Record<string, SkuClassInfo>;
  categories: Record<string, string>;
  lines: string[];
  error: string | null;
}) {
  const all = Object.values(classes);
  if (!all.length) return null;
  const total = all.reduce((a, c) => a + c.sales12, 0);
  const groups = [...lines, ""].map((line) => {
    const rows = all.filter((c) => (categories[c.sku] ?? "") === line);
    const sales = rows.reduce((a, c) => a + c.sales12, 0);
    const mix = SKU_CLASSES.map((k) => [k, rows.filter((r) => r.cls === k).length] as const).filter(([, n]) => n > 0);
    return { line, rows, sales, mix };
  });
  return (
    <div className="mb-6">
      <h3 className="mb-1 text-sm font-medium">Categories</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        Each SKU&apos;s product line in the Product Library. Use the category filter at the top to see any tab for one category.
        {error ? ` The Library couldn't be read just now (${error}); these are the last categories it gave.` : ""}
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Category</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">SKUs</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">By class</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Net sales, 12 months</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {groups
              .filter((g) => g.rows.length)
              .map((g) => (
                <tr key={g.line || "none"} className="border-t border-border">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    {g.line || <span className="font-normal text-muted-foreground">No category in Product Library</span>}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">{count(g.rows.length)}</td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{g.mix.map(([k, n]) => `${n} ${CLASS_LABEL[k]}`).join(" · ")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(g.sales)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{total > 0 ? `${((g.sales / total) * 100).toFixed(1)}%` : "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
