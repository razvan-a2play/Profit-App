// CRUD for notification rules — writes via service_role (server-only).
import { createClient } from "@supabase/supabase-js";
import { getProductLibraryConfig } from "./env";

const TABLE = "notification_rules";

export type Metric =
  | "stranded_units"
  | "reimbursable_damage"
  | "ltsf_risk_units"
  | "ltsf_active_units"
  | "excess_days_of_supply"
  | "stranded_pct_per_sku";

export const METRIC_LABEL: Record<Metric, string> = {
  stranded_units: "Stranded units per SKU",
  reimbursable_damage: "Reimbursable damaged units per SKU (warehouse + carrier + distributor)",
  ltsf_risk_units: "Units aged 91–180 days per SKU (LTSF risk)",
  ltsf_active_units: "Units aged 181+ days per SKU (LTSF active)",
  excess_days_of_supply: "Days of supply > threshold (Amazon's excess-inventory rule: 90)",
  stranded_pct_per_sku: "% of a SKU's inventory stranded (legacy)",
};

export const METRIC_UNIT: Record<Metric, string> = {
  stranded_units: "units",
  reimbursable_damage: "units",
  ltsf_risk_units: "units",
  ltsf_active_units: "units",
  excess_days_of_supply: "days",
  stranded_pct_per_sku: "%",
};

export interface AmazonPresetRule {
  metric: Metric;
  threshold_pct: number;
  label: string;
}

/** Amazon-recommended defaults, tied to their own policy thresholds. */
export const AMAZON_PRESETS: AmazonPresetRule[] = [
  { metric: "stranded_units", threshold_pct: 1, label: "Any stranded (Amazon rule: fix immediately)" },
  { metric: "reimbursable_damage", threshold_pct: 1, label: "Any reimbursable damage (18-mo claim window)" },
  { metric: "ltsf_risk_units", threshold_pct: 1, label: "Units aged 91–180 days (LTSF risk)" },
  { metric: "ltsf_active_units", threshold_pct: 1, label: "Units aged 181+ days (LTSF active — $0.50+/unit/mo)" },
  { metric: "excess_days_of_supply", threshold_pct: 90, label: "Days of supply > 90 (Amazon's excess rule)" },
];

export interface NotificationRule {
  id: string;
  metric: Metric;
  threshold_pct: number;
  email: string;
  enabled: boolean;
  last_fired_at: string | null;
  last_fired_summary: unknown | null;
  created_at: string;
  updated_at: string;
}

export interface RuleInput {
  metric: Metric;
  threshold_pct: number;
  email: string;
  enabled?: boolean;
}

function client() {
  const cfg = getProductLibraryConfig();
  if (!cfg) throw new Error("Product Library not configured.");
  return createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function listRules(): Promise<NotificationRule[]> {
  const { data, error } = await client().from(TABLE).select("*").order("created_at", { ascending: false });
  if (error) {
    // Table probably not migrated yet — return [] so the UI shows an empty state.
    return [];
  }
  return (data ?? []) as NotificationRule[];
}

export async function createRule(input: RuleInput): Promise<NotificationRule> {
  const { data, error } = await client().from(TABLE).insert(input).select().single();
  if (error) throw new Error(error.message);
  return data as NotificationRule;
}

export async function updateRule(id: string, patch: Partial<RuleInput>): Promise<NotificationRule> {
  const { data, error } = await client()
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as NotificationRule;
}

export async function deleteRule(id: string): Promise<void> {
  const { error } = await client().from(TABLE).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function markFired(id: string, summary: unknown): Promise<void> {
  await client()
    .from(TABLE)
    .update({ last_fired_at: new Date().toISOString(), last_fired_summary: summary, updated_at: new Date().toISOString() })
    .eq("id", id);
}
