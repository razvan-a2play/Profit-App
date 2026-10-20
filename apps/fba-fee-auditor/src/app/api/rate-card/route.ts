import { NextResponse } from "next/server";
import { FBA_FEES, HAZMAT_FBA_FEES } from "@platform/calc";
import {
  parseRateCard,
  diffRateCard,
  diffRows,
  reparseSource,
  getRateCard,
  storeRateCard,
  clearRateCard,
  MAX_RAW_BYTES,
  looksLikeAuthWall,
  resolveSippDiscounts,
  type RateCard,
} from "@/lib/rateCard";

export const dynamic = "force-dynamic";

/** Amazon's help pages are big; cap what we'll ingest. */
const MAX_BYTES = 4_000_000;
const FETCH_TIMEOUT_MS = 20_000;

interface Body {
  /** A published rate-card URL to fetch server-side. */
  url?: string;
  /** Or the table pasted straight from the page. */
  text?: string;
  /** Parse and diff without saving, so the UI can preview first. */
  previewOnly?: boolean;
  /**
   * Re-run against the stored card's own source: re-fetch if it came from a
   * URL, or re-parse the kept paste text. Lets a parser improvement or a rate
   * change be picked up without asking the user to paste again.
   */
  reparse?: boolean;
}

const LOGIN_HINT =
  "Seller Central pages need a login — open the page yourself, copy the fee table, and paste it instead.";
const AUTH_WALL_MSG =
  "That URL returned an Amazon sign-in page, not the fee table. The fetch runs from the server and isn't logged in to your account, so any page behind Seller Central will do this. " +
  "Open the page in your browser, select the fee table, and paste it below instead.";

async function fetchPage(url: string): Promise<{ raw: string } | { error: string; status: number }> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { error: "That doesn't look like a URL.", status: 400 };
  }
  if (!/^https?:$/.test(parsedUrl.protocol)) {
    return { error: "Only http(s) URLs are supported.", status: 400 };
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(parsedUrl.toString(), {
      signal: ctrl.signal,
      headers: {
        // Amazon help pages serve a stub to unknown agents.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { error: `Fetching that URL returned ${res.status}. ${LOGIN_HINT}`, status: 502 };
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return { error: "That page is too large to parse.", status: 413 };
    }
    const raw = new TextDecoder("utf-8").decode(buf);
    // Amazon serves its sign-in wall with a 200, so this has to be sniffed
    // rather than inferred from the status code.
    if (looksLikeAuthWall(raw, res.url)) {
      return { error: AUTH_WALL_MSG, status: 401 };
    }
    return { raw };
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? "timed out" : "failed";
    return { error: `Fetching that URL ${msg}. ${LOGIN_HINT}`, status: 502 };
  }
}

/** Current stored card plus how it compares to the built-in table. */
export async function GET() {
  const card = getRateCard();
  if (!card) {
    return NextResponse.json({
      stored: null,
      builtInRowCount: FBA_FEES.length + HAZMAT_FBA_FEES.length,
    });
  }
  return NextResponse.json({
    stored: card,
    diff: diffRateCard(card.rows, FBA_FEES, HAZMAT_FBA_FEES),
    builtInRowCount: FBA_FEES.length + HAZMAT_FBA_FEES.length,
    canReparse: reparseSource(card) !== null,
    reparseVia: reparseSource(card),
  });
}

export async function DELETE() {
  clearRateCard();
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const previous = getRateCard();
  let raw = "";
  let source = "";
  // A reparse re-reads the SIPP paste too, when one was kept.
  const reparseSipp = body.reparse === true && Boolean(previous?.sippRaw);

  if (body.reparse) {
    const how = reparseSource(previous);
    if (!previous || !how) {
      return NextResponse.json(
        {
          error: previous
            ? // Cards saved before the paste text was retained can't be re-run.
              "Nothing to reparse — the stored card came from a paste that wasn't kept. Paste the table again and it will be retained for next time."
            : "No rate card stored yet. Fetch a URL or paste the fee table first.",
        },
        { status: 409 },
      );
    }
    if (how === "url") {
      const got = await fetchPage(previous.source);
      if ("error" in got) return NextResponse.json({ error: got.error }, { status: got.status });
      raw = got.raw;
    } else {
      raw = previous.raw as string;
    }
    source = previous.source;
  } else if (body.text && body.text.trim().length > 0) {
    raw = body.text;
    source = "pasted";
  } else if (body.url && body.url.trim().length > 0) {
    const got = await fetchPage(body.url.trim());
    if ("error" in got) return NextResponse.json({ error: got.error }, { status: got.status });
    raw = got.raw;
    source = body.url.trim();
  } else {
    return NextResponse.json({ error: "Give me a url or paste the table text." }, { status: 400 });
  }

  const parsed = parseRateCard(raw);

  // Amazon publishes SIPP rates on their own page, so a paste of just that
  // table is normal: merge it onto the stored card instead of rejecting it for
  // having no fee rows - or, worse, replacing the whole card with nothing.
  const sippOnly =
    parsed.rows.length === 0 && (parsed.sipp.length > 0 || parsed.nonSippPackaging.length > 0);
  if (sippOnly) {
    if (!previous) {
      return NextResponse.json(
        {
          error:
            `Found ${parsed.sipp.length} SIPP row(s), but there's no fee rate card to attach them to yet. ` +
            `Paste the main FBA fulfilment fee table first, then the SIPP table.`,
        },
        { status: 409 },
      );
    }
    const merged: RateCard = {
      ...previous,
      sipp: parsed.sipp,
      nonSippPackaging: parsed.nonSippPackaging,
      sippSavedAt: new Date().toISOString(),
      ...(raw.length <= MAX_RAW_BYTES ? { sippRaw: raw } : {}),
    };
    const resolved = resolveSippDiscounts(merged.sipp ?? [], merged.rows);
    if (!body.previewOnly) storeRateCard(merged);
    return NextResponse.json({
      ok: true,
      saved: !body.previewOnly,
      sippMerged: true,
      card: merged,
      sipp: {
        rows: parsed.sipp.length,
        packagingRows: parsed.nonSippPackaging.length,
        fromLoweredFee: resolved.fromLoweredFee,
        unresolved: resolved.unresolved,
      },
      canReparse: reparseSource(merged) !== null,
    });
  }

  if (parsed.rows.length === 0) {
    // Say which stage actually failed. "Couldn't find any fee rows" on its own
    // gives nothing to act on — and the old unparsed list was empty precisely
    // in the total-miss case, because it only collected lines that already
    // looked like a band.
    const g = parsed.diagnostics;
    let error: string;
    if (g.lines === 0) {
      error = "That was empty — nothing to parse.";
    } else if (g.weightRows === 0 && g.moneyLines === 0) {
      error =
        `Read ${g.lines} line(s) but found no weight bands and no prices. ` +
        `This doesn't look like a fee table — copy the table itself, including its rows.`;
    } else if (g.weightRows === 0) {
      error =
        `Read ${g.lines} line(s) with ${g.moneyLines} price(s) but no weight bands ` +
        `(e.g. "4+ to 8 oz" or "4 oz or less"). Make sure the weight column is included in the copy.`;
    } else if (g.moneyLines === 0) {
      error =
        `Found ${g.weightRows} weight band(s) but no prices. Include the fee columns in the copy.`;
    } else if (g.tiersSeen.length === 0) {
      error =
        `Found ${g.weightRows} band(s) and ${g.moneyLines} price(s), but no size tier ` +
        `(e.g. "Large standard-size"). Include the tier heading above the rows.`;
    } else {
      error =
        `Found ${g.weightRows} band(s), ${g.moneyLines} price(s) and tier(s) ` +
        `${g.tiersSeen.join(", ")}, but couldn't pair them up. The lines below show what was read.`;
    }
    return NextResponse.json(
      { error, unparsedSample: parsed.unparsedSample, diagnostics: g },
      { status: 422 },
    );
  }

  // SIPP rows: from this paste if it carried them, otherwise re-read from the
  // kept SIPP paste on a reparse, otherwise carried over. Re-pasting the main
  // fee table must not silently discard a SIPP card entered separately.
  const sippFromReparse = reparseSipp ? parseRateCard(previous!.sippRaw as string) : null;
  const sippRows =
    parsed.sipp.length > 0 ? parsed.sipp : sippFromReparse?.sipp ?? previous?.sipp;
  const packagingRows =
    parsed.nonSippPackaging.length > 0
      ? parsed.nonSippPackaging
      : sippFromReparse?.nonSippPackaging ?? previous?.nonSippPackaging;

  const card: RateCard = {
    savedAt: new Date().toISOString(),
    source,
    fuelSurchargeRate: parsed.fuelSurchargeRate,
    rows: parsed.rows,
    ...(sippRows?.length ? { sipp: sippRows } : {}),
    ...(packagingRows?.length ? { nonSippPackaging: packagingRows } : {}),
    ...(previous?.sippRaw ? { sippRaw: previous.sippRaw } : {}),
    ...(previous?.sippSavedAt ? { sippSavedAt: previous.sippSavedAt } : {}),
    unparsedSample: parsed.unparsedSample,
    coverage: parsed.diagnostics.coverage,
    // Keep the paste so it can be re-parsed later without asking again. A
    // URL-sourced card re-fetches instead, so there's nothing to keep.
    ...(source === "pasted" && raw.length <= MAX_RAW_BYTES ? { raw } : {}),
  };

  const diff = diffRateCard(card.rows, FBA_FEES, HAZMAT_FBA_FEES);
  if (!body.previewOnly) storeRateCard(card);

  return NextResponse.json({
    ok: true,
    saved: !body.previewOnly,
    reparsed: body.reparse === true,
    card,
    diff,
    // Headline for the UI: how far the built-in table has drifted.
    drift: {
      compared: diff.filter((d) => d.builtIn != null).length,
      differing: diff.filter((d) => d.delta != null && Math.abs(d.delta) > 0.005).length,
      newRows: diff.filter((d) => d.builtIn == null).length,
      maxDelta: diff.reduce((m, d) => Math.max(m, Math.abs(d.delta ?? 0)), 0),
    },
    // What moved versus the card we already had — so a reparse can say whether
    // anything actually changed instead of just reporting success.
    sincePrevious: previous ? diffRows(card.rows, previous.rows) : null,
    canReparse: reparseSource(card) !== null,
  });
}
