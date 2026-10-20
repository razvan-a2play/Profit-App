"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, Badge, cn } from "@platform/ui";
import {
  Loader2, CheckCircle2, AlertTriangle, Upload, RefreshCw, Lock, ExternalLink,
} from "lucide-react";

/** How old a returns CSV can be before it stops describing the current year. */
const RETURNS_CSV_STALE_DAYS = 45;

interface Loaded {
  returnsCsv: {
    present: boolean;
    filename?: string;
    uploadedAt?: string;
    windowStart?: string | null;
    windowEnd?: string | null;
    usRows?: number;
    canadaRows?: number;
    skuCount?: number;
  } | null;
  rateCard: { stored: { savedAt: string; source: string; rows: unknown[] } | null } | null;
  cogs: { count: number; updatedAt: string | null } | null;
}

const daysSince = (iso?: string | null) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null;

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

/** One line of the live state strip: what is loaded, and whether it is current. */
function StateRow({
  label, value, detail, tone, action,
}: {
  label: string;
  value: string;
  detail?: string;
  tone: "ok" | "warn" | "missing";
  action?: string;
}) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "warn" ? AlertTriangle : Upload;
  return (
    <div className="grid grid-cols-[1.2rem_1fr] gap-x-2 gap-y-0.5 py-2.5">
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          tone === "ok" && "text-success",
          tone === "warn" && "text-warning",
          tone === "missing" && "text-muted-foreground",
        )}
      />
      <div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium">{label}</span>
          <span className="font-mono text-xs text-muted-foreground">{value}</span>
        </div>
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
        {action && (
          <div className={cn("mt-0.5 text-xs", tone === "ok" ? "text-muted-foreground" : "text-warning")}>
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

function Tier({
  icon: Icon, title, blurb, tone, children,
}: {
  icon: typeof RefreshCw;
  title: string;
  blurb: string;
  tone: "live" | "manual" | "frozen";
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Icon
          className={cn(
            "h-4 w-4",
            tone === "live" && "text-success",
            tone === "manual" && "text-warning",
            tone === "frozen" && "text-muted-foreground",
          )}
        />
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <Badge
          className={cn(
            tone === "live" && "bg-success text-success-foreground",
            tone === "manual" && "bg-warning text-warning-foreground",
            tone === "frozen" && "bg-muted text-muted-foreground",
          )}
        >
          {tone === "live" ? "no action" : tone === "manual" ? "needs you" : "a snapshot"}
        </Badge>
      </div>
      <p className="max-w-[70ch] text-sm text-muted-foreground">{blurb}</p>
      <div className="divide-y divide-border rounded-md border border-border">{children}</div>
    </section>
  );
}

function Item({ what, how }: { what: string; how: React.ReactNode }) {
  return (
    <div className="p-3">
      <div className="text-sm font-medium">{what}</div>
      <div className="mt-0.5 max-w-[75ch] text-xs leading-relaxed text-muted-foreground">{how}</div>
    </div>
  );
}

const M = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{children}</code>
);

export function GuideDashboard() {
  const [s, setS] = useState<Loaded | null>(null);

  useEffect(() => {
    void (async () => {
      const get = async (u: string) => {
        try {
          const r = await fetch(u);
          return r.ok ? await r.json() : null;
        } catch {
          return null;
        }
      };
      const [returnsCsv, rateCard, cogs] = await Promise.all([
        get("/api/uploads/returns-csv"),
        get("/api/rate-card"),
        get("/api/uploads/cogs"),
      ]);
      setS({ returnsCsv, rateCard, cogs });
    })();
  }, []);

  const csvAge = daysSince(s?.returnsCsv?.uploadedAt);
  const csvTone: "ok" | "warn" | "missing" = !s?.returnsCsv?.present
    ? "missing"
    : csvAge != null && csvAge > RETURNS_CSV_STALE_DAYS
      ? "warn"
      : "ok";

  return (
    <div className="space-y-10">
      <Card>
        <CardContent className="p-4">
          <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            What is loaded right now
          </div>
          {!s ? (
            <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking…
            </div>
          ) : (
            <div className="divide-y divide-border">
              <StateRow
                label="Customer Returns report"
                value={s.returnsCsv?.present ? (s.returnsCsv.filename ?? "") : "not uploaded"}
                tone={csvTone}
                detail={
                  s.returnsCsv?.present
                    ? `covers ${s.returnsCsv.windowStart} to ${s.returnsCsv.windowEnd} · ` +
                      `${(s.returnsCsv.usRows ?? 0).toLocaleString()} US rows, ` +
                      `${(s.returnsCsv.canadaRows ?? 0).toLocaleString()} Canadian rows excluded · ` +
                      `uploaded ${when(s.returnsCsv.uploadedAt)}`
                    : undefined
                }
                action={
                  csvTone === "missing"
                    ? "Upload it on Returns Strategy — without it the returns model cannot run at all."
                    : csvTone === "warn"
                      ? `${csvAge} days old. Download a fresh one and re-upload on Returns Strategy.`
                      : undefined
                }
              />
              <StateRow
                label="Amazon fee card"
                value={s.rateCard?.stored ? `${s.rateCard.stored.rows.length} rows` : "built-in table"}
                tone={s.rateCard?.stored ? "ok" : "warn"}
                detail={
                  s.rateCard?.stored
                    ? `pasted ${when(s.rateCard.stored.savedAt)} from ${s.rateCard.stored.source}`
                    : undefined
                }
                action={
                  s.rateCard?.stored
                    ? undefined
                    : "Paste Amazon's published card on Fee Audit. Until you do, overcharges are measured against a table that goes stale."
                }
              />
              <StateRow
                label="Landed COGS"
                value={`${s.cogs?.count ?? 0} SKUs`}
                tone={(s.cogs?.count ?? 0) > 0 ? "ok" : "missing"}
                detail={s.cogs?.updatedAt ? `last changed ${when(s.cogs.updatedAt)}` : undefined}
                action={
                  (s.cogs?.count ?? 0) > 0
                    ? undefined
                    : "Pull manufacturing from the PNL calculator on Returns Strategy."
                }
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Tier
        icon={RefreshCw}
        tone="live"
        title="Refreshes itself"
        blurb="Anything pulled from an Amazon report. Each page uses the newest finished report; if that report is more than 24 hours old it shows the old figures, marks them stale, and requests a fresh one in the background. Leave it four months and it is still current."
      >
        <Item
          what="Price, referral fee, FBA fulfilment fee"
          how={<><M>GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA</M> — a snapshot of today&apos;s listing, so it moves whenever you reprice.</>}
        />
        <Item
          what="Aged inventory and the surcharge"
          how={<><M>GET_FBA_INVENTORY_PLANNING_DATA</M> — deliberately not the Aged Inventory report, which Amazon accepts and then fails. Eleven consecutive requests returned FATAL, so this reads the same age columns from the report that completes.</>}
        />
        <Item what="Stranded and unfulfillable units" how={<><M>GET_STRANDED_INVENTORY_UI_DATA</M> and <M>GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA</M>.</>} />
        <Item what="Realised ASP" how={<><M>GET_SALES_AND_TRAFFIC_REPORT</M> — ordered sales divided by units ordered, so it follows coupons and deals rather than list price.</>} />
        <Item what="Removal and disposal fees" how={<><M>GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA</M>.</>} />
        <Item what="Manufacturing cost" how={<>Read live from the PNL calculator. Save a new version there and this app picks it up.</>} />
      </Tier>

      <Card className="border-warning/50">
        <CardContent className="flex items-start gap-2 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>
            All of that needs the gateway running on <M>localhost:5001</M>. It starts with Windows.
            If pages sit empty, that is the first thing to check — run{" "}
            <M>C:\Claude\seller-central-api\start.bat</M> and reload.
          </p>
        </CardContent>
      </Card>

      <Tier
        icon={Upload}
        tone="manual"
        title="Waits for you"
        blurb="Amazon publishes these but offers no API, so nothing refreshes until someone downloads a file. Each takes a few minutes."
      >
        <Item
          what="Customer Returns report — the important one"
          how={<>Its <M>status</M> column is the only place that says whether Amazon donated, destroyed, reimbursed or relisted a unit. About 87% are donated, and Amazon still charges you to remove those. Reports ▸ Fulfilment ▸ Customer Concessions ▸ Returns, then upload on <strong>Returns Strategy</strong>.</>}
        />
        <Item
          what="Sourcing cost file"
          how={<>No API in either direction. Inventory Defect and Reimbursement ▸ Manage Your Sourcing Cost ▸ Bulk, then drop the file on <strong>Sourcing Cost</strong>. It only ever proposes raising a cost Amazon has undervalued, so uploading can never cut a payout.</>}
        />
        <Item
          what="Amazon's published fee card"
          how={<>Paste it on <strong>Fee Audit</strong> whenever rates change, or the auditor compares real charges against a stale table and invents overcharges. Amazon cut the 0–0.5 lb removal fee from $1.04 to $0.84 on 15 January 2026.</>}
        />
      </Tier>

      <Tier
        icon={Lock}
        tone="frozen"
        title="Frozen"
        blurb="The Excel workbook does not update, ever. Every input was baked in when it was built."
      >
        <Item
          what="Returnless analysis - all SKUs v26.xlsx"
          how={<>A photograph of the year to 31 August 2026. It will still say $25,274 and eight SKUs to switch in four months, and that is correct — it is the record of a decision made on a known set of numbers.</>}
        />
        <Item
          what="Rebuilding it on fresh data"
          how={<>The whole build chain runs standalone from <M>Desktop\Returnless data sources\rebuild kit\</M>. <M>build_cat25.py</M> writes the workbook, <M>check26.py</M> recalculates every formula independently, <M>check_walktabs.py</M> proves the six walkthrough tabs land on the cells they claim.</>}
        />
      </Tier>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">The order to work in</h2>
        <p className="max-w-[70ch] text-sm text-muted-foreground">
          Each step feeds the next, and the first two cost nothing to skip until you need the later ones.
        </p>
        <ol className="divide-y divide-border rounded-md border border-border">
          {[
            ["Check the gateway is up", "If tabs are empty, run start.bat and reload."],
            ["Upload a fresh Customer Returns report", "Everything about donations, disposals and the removal cost flows from this one file."],
            ["Re-paste the fee card if rates changed", "Check the removal and disposal card too, not only fulfilment."],
            ["Look at Aged Inventory first", "It is the only page where waiting costs money every month. Sort by what is crossing into a charged tier next."],
            ["Re-run the sourcing cost check", "29 of 41 SKUs had no cost on file at all — each one is money left on every future claim."],
            ["Only then revisit the returns decision", "It moves slowly. Four rounds of corrections changed the total by thousands and never changed which SKUs to switch."],
          ].map(([title, note], i) => (
            <li key={title} className="flex gap-3 p-3">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border font-mono text-[11px] text-muted-foreground">
                {i + 1}
              </span>
              <div>
                <div className="text-sm font-medium">{title}</div>
                <div className="text-xs text-muted-foreground">{note}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Known gaps</h2>
        <Card className="border-destructive/40">
          <CardContent className="space-y-2 p-4 text-sm">
            <div className="font-medium">The returns number here is an upper bound</div>
            <p className="max-w-[75ch] text-muted-foreground">
              The five-outcome model is ported from the workbook and reproduces it cell for cell in
              its tests. But this app has no reimbursement data yet — there is no FBA Reimbursements
              endpoint in the gateway — so it does not know about the payments you{" "}
              <em>stop</em> collecting when you require returns.
            </p>
            <div className="overflow-x-auto">
              <table className="text-sm tabular-nums">
                <tbody>
                  <tr className="border-b border-border">
                    <td className="py-1 pr-6">Workbook v26</td>
                    <td className="py-1 pr-6 text-right font-mono">$25,274</td>
                    <td className="py-1 text-muted-foreground">8 SKUs to switch</td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-6">This app, today</td>
                    <td className="py-1 pr-6 text-right font-mono">$38,685</td>
                    <td className="py-1 text-muted-foreground">10 SKUs</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="max-w-[75ch] text-muted-foreground">
              The whole gap is that missing input, and it biases toward switching.{" "}
              <strong className="text-foreground">Trust the workbook for the decision until reimbursements are wired.</strong>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 p-4 text-sm text-muted-foreground">
            <p className="max-w-[75ch]">
              <strong className="text-foreground">Two figures are typed in, not pulled.</strong>{" "}
              Refunds issued comes from the Return Insights dashboard, because no SP-API report
              includes refunds where the customer kept the item — and those are the whole point of
              the decision. Landed COGS comes from your own cost file.
            </p>
            <p className="max-w-[75ch]">
              <strong className="text-foreground">Canada leaks in if you are not careful.</strong>{" "}
              The Customer Returns and Removal Order downloads cover every marketplace: 446 of 1,631
              unsellable returns came back to Canadian centres, billed in CAD at Canadian rates.
              Every input here is filtered to US fulfilment centres and USD lines. Before that
              filter the removal cost read $1.22 instead of $2.09.
            </p>
          </CardContent>
        </Card>
      </section>

      <p className="text-xs text-muted-foreground">
        Report identifiers are Amazon&apos;s own — search any of them in{" "}
        <a
          href="https://developer-docs.amazon.com/sp-api/docs/report-type-values"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline"
        >
          the SP-API report type list <ExternalLink className="h-3 w-3" />
        </a>
        .
      </p>
    </div>
  );
}
