// Shared response contract between the /api/audit route and the dashboard.
import type { AuditResult } from "@platform/calc";

export interface ConfigStatus {
  sellerCentral: boolean;
  productLibrary: boolean;
}

export interface HistoryInfo {
  available: boolean;
  recorded: number;
  changedSkus: string[];
  baseline: boolean;
}

export type AuditResponse =
  | {
      state: "result";
      source: "demo" | "live";
      result: AuditResult;
      skippedSkus: string[];
      /** Base URL of the supply-chain-app for deep links (null if not configured). */
      libraryAppUrl: string | null;
      /** sku (lowercased) → product id, for deep-linking to a product's specs. */
      libraryIndex: Record<string, string>;
      /**
       * SKUs Amazon bills us for that the Product Library doesn't carry as
       * live products, so they were left out of this audit — either absent
       * from the Library entirely (bundles, variation parents, listings never
       * added) or archived there on purpose.
       */
      excludedSkus: { sku: string; reason: "absent" | "archived" }[];
      /**
       * Amazon's SIPP Product Portfolio report, if uploaded. `opportunity90d` is
       * Amazon's own estimate of fee savings forgone on eligible, unenrolled
       * SKUs among those audited.
       */
      sippReport?: { importedAt: string; fileName: string; opportunity90d: number } | null;
      /** Measurement-history persistence result (live only). */
      history?: HistoryInfo;
      /** Whether these fee rows came from Amazon now, or from the last good cache. */
      feeReport?: { cached: boolean; fetchedAt?: string; note?: string };
      /** The published rate card this run audited against, if one is stored. */
      rateCard?: { source: string; savedAt: string; rows: number; sippRows?: number } | null;
    }
  | { state: "pending"; reportId: string; status?: string }
  | { state: "error"; message: string };

export interface AuditRequestBody {
  mode: "demo" | "live";
  /** For live mode: an in-flight reportId to poll instead of creating a new one. */
  reportId?: string;
  /** Force a brand-new report instead of reusing the latest finished one. */
  forceRefresh?: boolean;
}
