// Notification evaluation loop. Pulls live inventory reports, evaluates every
// enabled rule against Amazon's policy-aligned metrics, and emails on breach
// (deduped once per UTC day per rule).

import {
  fetchStranded,
  fetchUnfulfillable,
  fetchInventoryTotals,
  fetchAged,
  fetchPlanning,
  type StrandedRow,
  type UnfulfillableRow,
  type AgedRow,
  type PlanningRow,
} from "./amazonInventory";
import {
  listRules,
  markFired,
  METRIC_UNIT,
  type NotificationRule,
  type Metric,
} from "./notificationRules";
import { sendMail } from "./mailer";

export interface BreachedSku {
  sku: string;
  value: number;
  detail: string;
}

export interface RuleEvaluation {
  ruleId: string;
  metric: Metric;
  threshold: number;
  email: string;
  breachedSkus: BreachedSku[];
  emailed: boolean;
  emailStatus: string;
}

export interface CheckResult {
  ran: boolean;
  reason?: string;
  rulesEvaluated: number;
  evaluations: RuleEvaluation[];
}

function sameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** Which live reports each metric needs — lets us skip fetches nobody wants. */
function neededFetchers(metrics: Set<Metric>) {
  return {
    stranded: metrics.has("stranded_units") || metrics.has("stranded_pct_per_sku"),
    unfulfillable: metrics.has("reimbursable_damage"),
    inventoryTotals: metrics.has("stranded_pct_per_sku"),
    aged: metrics.has("ltsf_risk_units") || metrics.has("ltsf_active_units"),
    planning: metrics.has("excess_days_of_supply"),
  };
}

function evaluateStrandedUnits(rule: NotificationRule, stranded: StrandedRow[]): BreachedSku[] {
  return stranded
    .filter((s) => (s.quantity ?? 0) >= rule.threshold_pct)
    .map((s) => ({
      sku: s.sku,
      value: s.quantity ?? 0,
      detail: `${s.quantity} stranded — ${s.reason ?? "unknown reason"}`,
    }))
    .sort((a, b) => b.value - a.value);
}

function evaluateReimbursableDamage(
  rule: NotificationRule,
  unfulfillable: UnfulfillableRow[],
): BreachedSku[] {
  return unfulfillable
    .map((u) => {
      const reimbursable = u.warehouseDamaged + u.carrierDamaged + u.distributorDamaged;
      return { row: u, reimbursable };
    })
    .filter((x) => x.reimbursable >= rule.threshold_pct)
    .map((x) => ({
      sku: x.row.sku,
      value: x.reimbursable,
      detail: `warehouse ${x.row.warehouseDamaged} · carrier ${x.row.carrierDamaged} · distributor ${x.row.distributorDamaged}`,
    }))
    .sort((a, b) => b.value - a.value);
}

function evaluateLtsfRisk(rule: NotificationRule, aged: AgedRow[]): BreachedSku[] {
  return aged
    .filter((a) => a.age91_180 >= rule.threshold_pct)
    .map((a) => ({
      sku: a.sku,
      value: a.age91_180,
      detail: `${a.age91_180} units aged 91–180 days (LTSF starts at 181)`,
    }))
    .sort((a, b) => b.value - a.value);
}

function evaluateLtsfActive(rule: NotificationRule, aged: AgedRow[]): BreachedSku[] {
  return aged
    .filter((a) => a.ltsfActiveUnits >= rule.threshold_pct)
    .map((a) => ({
      sku: a.sku,
      value: a.ltsfActiveUnits,
      detail: `${a.age181_270}+${a.age271_330}+${a.age331_365}+${a.age365Plus} in 181-270/271-330/331-365/365+ buckets`,
    }))
    .sort((a, b) => b.value - a.value);
}

function evaluateExcessDaysOfSupply(rule: NotificationRule, planning: PlanningRow[]): BreachedSku[] {
  return planning
    .filter((p) => (p.daysOfSupply ?? 0) > rule.threshold_pct)
    .map((p) => ({
      sku: p.sku,
      value: p.daysOfSupply ?? 0,
      detail: `${(p.daysOfSupply ?? 0).toFixed(0)} days of supply · ${p.excessUnits} excess units`,
    }))
    .sort((a, b) => b.value - a.value);
}

function evaluateStrandedPctLegacy(
  rule: NotificationRule,
  stranded: StrandedRow[],
  totals: Record<string, number>,
): BreachedSku[] {
  const out: BreachedSku[] = [];
  for (const s of stranded) {
    const strandedQty = s.quantity ?? 0;
    if (strandedQty <= 0) continue;
    const totalQty = totals[s.sku.trim().toLowerCase()] ?? strandedQty;
    const pct = totalQty > 0 ? (strandedQty / totalQty) * 100 : 0;
    if (pct >= rule.threshold_pct) {
      out.push({
        sku: s.sku,
        value: pct,
        detail: `${strandedQty}/${totalQty} units stranded (${pct.toFixed(0)}%)`,
      });
    }
  }
  return out.sort((a, b) => b.value - a.value);
}

export async function runNotificationCheck(): Promise<CheckResult> {
  const rules = (await listRules()).filter((r) => r.enabled);
  if (rules.length === 0) {
    return { ran: false, reason: "no-enabled-rules", rulesEvaluated: 0, evaluations: [] };
  }

  const needs = neededFetchers(new Set(rules.map((r) => r.metric)));

  const [stranded, unfulfillable, totals, aged, planning] = await Promise.all([
    needs.stranded ? fetchStranded() : Promise.resolve(null),
    needs.unfulfillable ? fetchUnfulfillable() : Promise.resolve(null),
    needs.inventoryTotals ? fetchInventoryTotals() : Promise.resolve({}),
    needs.aged ? fetchAged() : Promise.resolve(null),
    needs.planning ? fetchPlanning() : Promise.resolve(null),
  ]);

  // If any needed report isn't ready yet, we still evaluate the rules whose
  // reports ARE ready — no reason to block LTSF alerts on a still-generating
  // stranded report. Rules whose data isn't ready end up with `emailStatus:
  // "data-not-ready"` and are skipped.
  const now = new Date();
  const evaluations: RuleEvaluation[] = [];

  for (const rule of rules) {
    let breachedSkus: BreachedSku[] = [];
    let dataReady = true;

    switch (rule.metric) {
      case "stranded_units":
        if (!stranded?.ready) dataReady = false;
        else breachedSkus = evaluateStrandedUnits(rule, stranded.rows);
        break;
      case "reimbursable_damage":
        if (!unfulfillable?.ready) dataReady = false;
        else breachedSkus = evaluateReimbursableDamage(rule, unfulfillable.rows);
        break;
      case "ltsf_risk_units":
        if (!aged?.ready) dataReady = false;
        else breachedSkus = evaluateLtsfRisk(rule, aged.rows);
        break;
      case "ltsf_active_units":
        if (!aged?.ready) dataReady = false;
        else breachedSkus = evaluateLtsfActive(rule, aged.rows);
        break;
      case "excess_days_of_supply":
        if (!planning?.ready) dataReady = false;
        else breachedSkus = evaluateExcessDaysOfSupply(rule, planning.rows);
        break;
      case "stranded_pct_per_sku":
        if (!stranded?.ready) dataReady = false;
        else breachedSkus = evaluateStrandedPctLegacy(rule, stranded.rows, totals);
        break;
    }

    const alreadyFiredToday =
      rule.last_fired_at && sameUtcDay(new Date(rule.last_fired_at), now);

    let emailed = false;
    let emailStatus = "not-triggered";

    if (!dataReady) {
      emailStatus = "data-not-ready";
    } else if (breachedSkus.length === 0) {
      emailStatus = "under-threshold";
    } else if (alreadyFiredToday) {
      emailStatus = "already-fired-today";
    } else {
      const subject = `[FBA Auditor] ${breachedSkus.length} SKU(s) breach ${labelForMetric(rule.metric)}`;
      const html = renderAlertHtml(rule, breachedSkus);
      const result = await sendMail(rule.email, subject, html);
      emailed = result.sent;
      emailStatus = result.sent ? `sent (${result.messageId ?? "ok"})` : result.reason ?? "send-failed";
      if (emailed) {
        await markFired(rule.id, {
          breachedCount: breachedSkus.length,
          topSkus: breachedSkus.slice(0, 10).map((b) => ({ sku: b.sku, value: b.value })),
        });
      }
    }

    evaluations.push({
      ruleId: rule.id,
      metric: rule.metric,
      threshold: rule.threshold_pct,
      email: rule.email,
      breachedSkus,
      emailed,
      emailStatus,
    });
  }

  return { ran: true, rulesEvaluated: rules.length, evaluations };
}

function labelForMetric(m: Metric): string {
  switch (m) {
    case "stranded_units":
      return "stranded threshold";
    case "reimbursable_damage":
      return "reimbursable damage";
    case "ltsf_risk_units":
      return "LTSF-risk (91–180 days)";
    case "ltsf_active_units":
      return "LTSF-active (181+ days)";
    case "excess_days_of_supply":
      return "excess days of supply";
    case "stranded_pct_per_sku":
      return "% stranded";
  }
}

function renderAlertHtml(rule: NotificationRule, breachedSkus: BreachedSku[]): string {
  const unit = METRIC_UNIT[rule.metric];
  const rows = breachedSkus
    .map(
      (b) => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-family:ui-monospace,monospace"><strong>${escape(b.sku)}</strong></td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;color:#dc2626"><strong>${formatValue(b.value)} ${unit}</strong></td>
      <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:12px">${escape(b.detail)}</td>
    </tr>`,
    )
    .join("");
  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:0 auto;padding:24px">
    <h2 style="margin:0 0 8px">FBA Inventory Alert</h2>
    <p style="color:#374151;margin:0 0 16px">
      ${breachedSkus.length} SKU${breachedSkus.length === 1 ? "" : "s"} above threshold
      <strong>${formatValue(rule.threshold_pct)} ${unit}</strong> for <em>${escape(labelForMetric(rule.metric))}</em>.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead>
        <tr style="background:#f9fafb;text-align:left">
          <th style="padding:8px 10px;border-bottom:1px solid #e5e7eb">SKU</th>
          <th style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right">Value</th>
          <th style="padding:8px 10px;border-bottom:1px solid #e5e7eb">Detail</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#6b7280;font-size:12px;margin-top:20px">
      Sent automatically by the FBA Fee Auditor. Manage rules at
      <a href="http://localhost:3002/settings/notifications">/settings/notifications</a>.
    </p>
  </div>`;
}

function formatValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
