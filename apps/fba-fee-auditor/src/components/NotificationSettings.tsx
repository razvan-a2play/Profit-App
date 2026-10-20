"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@platform/ui";
import { Bell, Loader2, Send, Trash2, Plus, Zap, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  METRIC_LABEL,
  METRIC_UNIT,
  AMAZON_PRESETS,
  type NotificationRule,
  type Metric,
} from "@/lib/notificationRules";
import type { CheckResult } from "@/lib/notificationCheck";

export function NotificationSettings() {
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<Metric>("stranded_units");
  const [threshold, setThreshold] = useState("1");
  const [email, setEmail] = useState("");
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState<CheckResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications/rules");
      const body = await res.json();
      if (body.error) toast.error(body.error);
      setRules(body.rules ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!email.trim()) return toast.error("Enter an email address.");
    const t = Number(threshold);
    if (!Number.isFinite(t) || t < 0) return toast.error("Threshold must be a positive number.");
    setSaving(true);
    try {
      const res = await fetch("/api/notifications/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metric, threshold_pct: t, email: email.trim() }),
      });
      const body = await res.json();
      if (body.error) throw new Error(body.error);
      toast.success("Rule created.");
      setEmail("");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const loadAmazonPresets = async () => {
    if (!email.trim()) return toast.error("Enter a recipient email above first — presets will use it.");
    setLoadingPresets(true);
    try {
      let created = 0;
      for (const p of AMAZON_PRESETS) {
        const res = await fetch("/api/notifications/rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metric: p.metric,
            threshold_pct: p.threshold_pct,
            email: email.trim(),
          }),
        });
        if (res.ok) created++;
      }
      toast.success(`Loaded ${created} Amazon-recommended rule${created === 1 ? "" : "s"}.`);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingPresets(false);
    }
  };

  const toggle = async (rule: NotificationRule) => {
    await fetch("/api/notifications/rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rule.id, enabled: !rule.enabled }),
    });
    await load();
  };

  const remove = async (rule: NotificationRule) => {
    if (!confirm(`Delete rule for ${rule.email}?`)) return;
    await fetch(`/api/notifications/rules?id=${rule.id}`, { method: "DELETE" });
    toast.success("Rule deleted.");
    await load();
  };

  const runCheckNow = async () => {
    setChecking(true);
    setLastCheck(null);
    try {
      const res = await fetch("/api/notifications/check", { method: "POST" });
      const body = (await res.json()) as CheckResult;
      setLastCheck(body);
      if (!body.ran) {
        toast.message(`Check didn't run: ${body.reason ?? "unknown"}`);
      } else {
        const sent = body.evaluations.filter((e) => e.emailed).length;
        const breached = body.evaluations.filter((e) => e.breachedSkus.length > 0).length;
        if (sent > 0) toast.success(`Sent ${sent} email${sent === 1 ? "" : "s"}.`);
        else if (breached > 0) toast.message("Threshold breached but already emailed today.");
        else toast.success("All rules are under threshold.");
      }
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4" /> Create a rule
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Fires once per UTC day per rule when any SKU crosses the threshold. Load the Amazon-recommended set to
            cover stranded, damage, LTSF risk, LTSF active, and excess inventory in one click.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="metric">Metric</Label>
              <select
                id="metric"
                value={metric}
                onChange={(e) => setMetric(e.target.value as Metric)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                {(Object.keys(METRIC_LABEL) as Metric[])
                  .filter((m) => m !== "stranded_pct_per_sku")
                  .map((m) => (
                    <option key={m} value={m}>
                      {METRIC_LABEL[m]}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <Label htmlFor="threshold">Threshold ({METRIC_UNIT[metric]})</Label>
              <Input
                id="threshold"
                type="number"
                min={0}
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <Label htmlFor="email">Recipient email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={create} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bell className="mr-2 h-4 w-4" />}
                Add rule
              </Button>
              <Button variant="outline" onClick={loadAmazonPresets} disabled={loadingPresets}>
                {loadingPresets ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                Load Amazon presets
              </Button>
            </div>
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">What the presets create</summary>
            <ul className="mt-2 space-y-1 pl-4 list-disc">
              {AMAZON_PRESETS.map((p) => (
                <li key={p.metric}>
                  <strong>{p.label}</strong> — threshold {p.threshold_pct} {METRIC_UNIT[p.metric]}
                </li>
              ))}
            </ul>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Active rules</CardTitle>
          <Button variant="outline" size="sm" onClick={runCheckNow} disabled={checking}>
            {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
            Run check now
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : rules.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No rules yet. Add one above to get email alerts for stranded inventory.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Last fired</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">
                      {METRIC_LABEL[r.metric] ?? r.metric}
                      <div className="text-xs text-muted-foreground">Threshold: {r.threshold_pct}%</div>
                    </TableCell>
                    <TableCell className="text-sm">{r.email}</TableCell>
                    <TableCell>
                      <button onClick={() => toggle(r)}>
                        <Badge
                          className={cn(
                            r.enabled
                              ? "bg-success text-success-foreground"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {r.enabled ? "on" : "off"}
                        </Badge>
                      </button>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.last_fired_at ? new Date(r.last_fired_at).toLocaleString() : "never"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => remove(r)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {lastCheck && <CheckResultCard result={lastCheck} />}
    </div>
  );
}

function CheckResultCard({ result }: { result: CheckResult }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Send className="h-4 w-4" /> Last check result
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!result.ran ? (
          <p className="text-muted-foreground">Not run: {result.reason}</p>
        ) : (
          <>
            <p className="text-muted-foreground">
              Evaluated {result.rulesEvaluated} rule{result.rulesEvaluated === 1 ? "" : "s"}.
            </p>
            {result.evaluations.map((e) => (
              <div key={e.ruleId} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <strong>{e.threshold}%</strong> → <span className="text-muted-foreground">{e.email}</span>
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      e.emailed && "border-success/40 text-success",
                      !e.emailed && e.emailStatus === "already-fired-today" && "border-info/50 text-info",
                      !e.emailed && e.emailStatus === "under-threshold" && "border-border text-muted-foreground",
                    )}
                  >
                    {e.emailStatus}
                  </Badge>
                </div>
                {e.breachedSkus.length > 0 && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Top breaches:{" "}
                    {e.breachedSkus
                      .slice(0, 5)
                      .map((b) => `${b.sku} (${b.value.toFixed(0)})`)
                      .join(", ")}
                    {e.breachedSkus.length > 5 && `, +${e.breachedSkus.length - 5} more`}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
