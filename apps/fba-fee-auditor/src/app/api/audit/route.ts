import { NextResponse } from "next/server";
import { auditCatalog } from "@platform/calc";
import { getSellerCentralConfig, getProductLibraryConfig } from "@/lib/env";
import {
  fetchRealMeasurements,
  fetchProductIndex,
  fetchHazmatFlags,
  fetchActiveSkus,
} from "@/lib/productLibrary";
import { recordSnapshots } from "@/lib/measurementHistory";
import { requestFeesReport, getReportStatus, fetchFeesRows, findLatestDoneReportId } from "@/lib/amazonReport";
import { SAMPLE_AMAZON_ROWS, SAMPLE_REAL_MEASUREMENTS } from "@/lib/sampleData";
import { rateCardOverride } from "@/lib/rateCard";
import { getSippCertified } from "@/lib/sippCertification";
import { getSippPortfolio, isCertified, sippOpportunityNote } from "@/lib/sippPortfolio";
import {
  getCachedFeeReport,
  storeFeeReport,
  describeCacheAge,
} from "@/lib/feeReportCache";
import type { AmazonMeasuredRow } from "@platform/calc";
import type { AuditResponse, AuditRequestBody, ConfigStatus } from "@/lib/auditTypes";

export const dynamic = "force-dynamic";

/** Report which connections are configured, so the UI can guide setup. */
export async function GET() {
  const status: ConfigStatus = {
    sellerCentral: getSellerCentralConfig() !== null,
    productLibrary: getProductLibraryConfig() !== null,
  };
  return NextResponse.json(status);
}


/**
 * Audit a set of Amazon fee rows and build the response. Shared by the live
 * path and the cached-fallback path so a rate-limited run produces exactly the
 * same analysis, differing only in the `feeReport` provenance it reports.
 */
async function respondWithRows(
  rows: AmazonMeasuredRow[],
  reportId: string,
  cached?: { cached: true; fetchedAt: string; note: string },
) {
  const [library, libraryIndex, hazmat, activeSkus] = await Promise.all([
    fetchRealMeasurements(),
    fetchProductIndex(),
    fetchHazmatFlags(),
    fetchActiveSkus(),
  ]);

  // Apply the Library's Dangerous Goods classification to each measurement,
  // and the SIPP certification you've marked. Certification is always a stated
  // yes/no: an unticked SKU is "not certified", which is what lets the audit
  // both apply a bulky packaging fee and spot a listing Amazon already treats
  // as SIPP but that hasn't been ticked.
  const sippCertified = getSippCertified();
  for (const m of library.measurements) {
    const key = m.sku.trim().toLowerCase();
    m.hazmat = hazmat.flags[key] ?? false;
    m.sippCertified = sippCertified.has(key);
  }

  // Scope the audit to the Product Library. Amazon's fee report carries every
  // FBA listing we have ever had — bundles, retired SKUs, variation parents —
  // and those aren't products we manage here, so auditing them only adds rows
  // nobody can act on. The Library's product list (not its packaging specs) is
  // the gate: a product with no unit spec yet still belongs, and shows up as
  // "needs measurement".
  // Archived products are excluded: the Library keeps them for history and its
  // Products page hides them behind "Show archived", so auditing them would
  // report on SKUs that have been deliberately retired.
  const inLibrary = (sku: string) => activeSkus.has(sku.trim().toLowerCase());
  const scopedRows = rows.filter((r) => inLibrary(r.sku));
  const excludedSkus = rows
    .filter((r) => !inLibrary(r.sku))
    .map((r) => ({
      sku: r.sku,
      reason: (libraryIndex[r.sku.trim().toLowerCase()] ? "archived" : "absent") as
        | "absent"
        | "archived",
    }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
  const scopedMeasurements = library.measurements.filter((m) => inLibrary(m.sku));

  // Audit against the published rate card when one has been entered. Without
  // it we fall back to the built-in table, which drifts every time Amazon
  // revises rates — and drift reads as an overcharge that isn't real.
  const card = rateCardOverride();

  // Only hunt for hazmat mis-charges when the Library tracks hazmat AND we're
  // comparing against a published card that actually carries hazmat rows.
  // Against a stale built-in table this check produced false positives: a
  // routine rate rise made the regular fee collide with the old hazmat rate.
  const canDetectHazmat = hazmat.available && (card?.hazmat.length ?? 0) > 0;

  const result = auditCatalog(scopedRows, scopedMeasurements, {
    detectHazmatMischarge: canDetectHazmat,
    ...(card
      ? {
          feeTable: {
            regular: card.regular,
            hazmat: card.hazmat,
            sipp: card.sipp,
            nonSippPackaging: card.nonSippPackaging,
          },
        }
      : {}),
    ...(card?.fuelSurchargeRate != null ? { fuelSurchargeRate: card.fuelSurchargeRate } : {}),
  });

  // Amazon's SIPP report, when uploaded: say where it certifies a SKU, and where
  // it says a SKU could be enrolled but isn't - money Amazon itself estimates is
  // being left behind. Done here, not in the calc engine, because the report is
  // about the listing, and applies even to SKUs that couldn't be fee-audited.
  const portfolio = getSippPortfolio();
  let sippOpportunity90d = 0;
  if (portfolio) {
    for (const f of result.findings) {
      const s = portfolio.bySku[f.sku.trim().toLowerCase()];
      if (!s) continue;
      if (isCertified(s)) {
        f.notes.push(
          `SIPP report: certified (${s.certificationStatus}${s.certificationDate ? `, since ${s.certificationDate}` : ""}).`,
        );
      }
      const note = sippOpportunityNote(s);
      if (note) {
        f.notes.push(note);
        sippOpportunity90d += s.savings90d ?? 0;
      }
    }
  }

  // Append Amazon-measurement snapshots (change log) for this run. Skip it on
  // cached rows: they'd re-record measurements already logged, and show up as
  // spurious "changes" against the previous run.
  const history = cached ? null : await recordSnapshots(result.findings, reportId);

  return NextResponse.json(
    {
      state: "result",
      source: "live",
      result,
      skippedSkus: library.skippedSkus.filter(inLibrary),
      rateCard: card
        ? {
            source: card.source,
            savedAt: card.savedAt,
            rows: card.regular.length + card.hazmat.length,
            sippRows: card.sipp.length,
          }
        : null,
      feeReport: cached
        ? { cached: true, fetchedAt: cached.fetchedAt, note: cached.note }
        : { cached: false },
      libraryAppUrl: getProductLibraryConfig()?.appUrl ?? null,
      libraryIndex,
      excludedSkus,
      sippReport: portfolio
        ? {
            importedAt: portfolio.importedAt,
            fileName: portfolio.fileName,
            opportunity90d: Math.round(sippOpportunity90d * 100) / 100,
          }
        : null,
      ...(history ? { history } : {}),
    } satisfies AuditResponse,
  );
}

export async function POST(req: Request) {
  let body: AuditRequestBody;
  try {
    body = (await req.json()) as AuditRequestBody;
  } catch {
    body = { mode: "demo" };
  }

  // --- Demo: no external dependencies --------------------------------------
  if (body.mode === "demo") {
    const result = auditCatalog(SAMPLE_AMAZON_ROWS, SAMPLE_REAL_MEASUREMENTS);
    const res: AuditResponse = {
      state: "result",
      source: "demo",
      result,
      skippedSkus: [],
      // Demo SKUs aren't in the real Library, so there are no product ids — but
      // exposing the app URL lets the deep links render (they land on the
      // products list, where you'd find or create the SKU).
      libraryAppUrl: getProductLibraryConfig()?.appUrl ?? null,
      libraryIndex: {},
      excludedSkus: [],
      history: { available: false, recorded: 0, changedSkus: [], baseline: false },
    };
    return NextResponse.json(res);
  }

  // --- Live: drive the SP-API report lifecycle, then compare ---------------
  try {
    if (!getSellerCentralConfig()) {
      return NextResponse.json(
        { state: "error", message: "Seller-Central API connection is not configured." } satisfies AuditResponse,
      );
    }
    if (!getProductLibraryConfig()) {
      return NextResponse.json(
        { state: "error", message: "Product Library connection is not configured." } satisfies AuditResponse,
      );
    }

    // No reportId yet. Amazon rate-limits this report to ~1 generation per
    // several hours, so reuse the latest finished report when one exists;
    // otherwise (unless the user forced a refresh) request a fresh one and poll.
    let reportId = body.reportId;
    if (!reportId) {
      const existing = body.forceRefresh ? null : await findLatestDoneReportId();
      if (existing) {
        reportId = existing;
        // fall through to the DONE path below
      } else {
        try {
          const fresh = await requestFeesReport();
          return NextResponse.json({ state: "pending", reportId: fresh } satisfies AuditResponse);
        } catch (e) {
          // Requesting a report is itself rate-limited. Serve the cache rather
          // than making the tool unusable while Amazon's window is closed.
          const cached = getCachedFeeReport();
          if (!cached) throw e;
          return await respondWithRows(cached.rows, cached.reportId, {
            cached: true,
            fetchedAt: cached.fetchedAt,
            note:
              `Amazon wouldn't accept a new fee report request right now (it allows about one every ` +
              `few hours), so this ran against the last good report, ${describeCacheAge(cached)}.`,
          });
        }
      }
    }

    // Poll: is the report finished?
    const status = await getReportStatus(reportId);
    const TERMINAL_FAILURES = ["FATAL", "CANCELLED"];
    if (status.processingStatus && TERMINAL_FAILURES.includes(status.processingStatus)) {
      // Rate-limited or rejected. Fee rows move far more slowly than Amazon's
      // ~few-hour generation limit, so the last good report is still worth
      // auditing against — failing outright would leave the tool unusable for
      // hours over numbers that haven't changed.
      const cached = getCachedFeeReport();
      if (cached) {
        return await respondWithRows(cached.rows, cached.reportId, {
          cached: true,
          fetchedAt: cached.fetchedAt,
          note:
            `Amazon returned ${status.processingStatus} (the fee report is rate-limited to about one ` +
            `generation every few hours), so this ran against the last good report, ` +
            `${describeCacheAge(cached)}. Try again later for fresh numbers.`,
        });
      }
      return NextResponse.json(
        {
          state: "error",
          message:
            `Amazon returned ${status.processingStatus} for this report, and there is no cached ` +
            `report to fall back on yet. The FBA fee report is rate-limited to about one generation ` +
            `every few hours — try again later.`,
        } satisfies AuditResponse,
      );
    }
    if (status.processingStatus && status.processingStatus !== "DONE") {
      return NextResponse.json(
        { state: "pending", reportId, status: status.processingStatus } satisfies AuditResponse,
      );
    }

    // Finished → fetch the rows, cache them, then audit.
    const amazon = await fetchFeesRows(reportId);
    if (!amazon.ready) {
      return NextResponse.json(
        { state: "pending", reportId, status: amazon.status } satisfies AuditResponse,
      );
    }
    // Keep the last good report so a later rate-limited run still has numbers.
    storeFeeReport(reportId, amazon.rows);
    return await respondWithRows(amazon.rows, reportId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error running the audit.";
    // Last resort: if anything above failed but we hold a good report, audit
    // against that rather than returning nothing at all.
    const cached = getCachedFeeReport();
    if (cached) {
      try {
        return await respondWithRows(cached.rows, cached.reportId, {
          cached: true,
          fetchedAt: cached.fetchedAt,
          note: `Couldn't reach Amazon for a fresh fee report (${message}). Ran against the last good report, ${describeCacheAge(cached)}.`,
        });
      } catch {
        /* fall through to the plain error below */
      }
    }
    return NextResponse.json({ state: "error", message } satisfies AuditResponse);
  }
}
