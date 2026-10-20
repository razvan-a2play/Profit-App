"use client";

import { useState } from "react";
import { cn } from "@platform/ui";
import { PackageSearch, Boxes, Bell, RotateCcw, DollarSign, Receipt, Hourglass, BookOpen, Warehouse, Network } from "lucide-react";
import Link from "next/link";
import { AuditDashboard } from "@/components/AuditDashboard";
import { InventoryIssuesDashboard } from "@/components/InventoryIssuesDashboard";
import { ReturnsDecisionDashboard } from "@/components/ReturnsDecisionDashboard";
import { WasteReportDashboard } from "@/components/WasteReportDashboard";
import { SourcingCostPanel } from "@/components/SourcingCostPanel";
import { AgedInventoryDashboard } from "@/components/AgedInventoryDashboard";
import { GuideDashboard } from "@/components/GuideDashboard";
import { StorageCostsDashboard } from "@/components/StorageCostsDashboard";
import { SupplyChainDashboard } from "@/components/SupplyChainDashboard";

type View = "waste" | "audit" | "inventory" | "aged" | "returns" | "storage" | "supply" | "sourcing" | "guide";

export default function Page() {
  const [view, setView] = useState<View>("waste");

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-6 pt-6">
        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
          {(
            [
              { key: "waste", label: "Waste Report", icon: DollarSign },
              { key: "audit", label: "Fee Audit", icon: PackageSearch },
              { key: "inventory", label: "Inventory Issues", icon: Boxes },
              { key: "aged", label: "Aged Inventory", icon: Hourglass },
              { key: "returns", label: "Returns Strategy", icon: RotateCcw },
              { key: "storage", label: "Storage Costs", icon: Warehouse },
              { key: "supply", label: "Supply Chain", icon: Network },
              { key: "sourcing", label: "Sourcing Cost", icon: Receipt },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                view === t.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
          {/* Kept as one group so the pair wraps together rather than
              stranding Notifications on a second row. */}
          <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setView("guide")}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
              view === "guide"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            <BookOpen className="h-4 w-4" />
            How to use
          </button>
          <Link
            href="/settings/notifications"
            className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
          >
            <Bell className="h-4 w-4" />
            Notifications
          </Link>
          </div>
        </div>
      </div>
      {view === "waste" && (
        <div className="mx-auto max-w-6xl px-6 py-10">
          <header className="mb-8">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <DollarSign className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Waste Report</h1>
                <p className="text-sm text-muted-foreground">
                  Every $-related waste category consolidated into one ranked action list — fee overcharges,
                  reimbursable damage, stranded, LTSF, excess, and returnless overspend. Attack from the top.
                </p>
              </div>
            </div>
          </header>
          <WasteReportDashboard />
        </div>
      )}
      {view === "audit" && <AuditDashboard />}
      {view === "inventory" && (
        <div className="mx-auto max-w-6xl px-6 py-10">
          <header className="mb-8">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Boxes className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Inventory Issues</h1>
                <p className="text-sm text-muted-foreground">
                  Stranded SKUs (no active listing) and unfulfillable units (damaged, defective, expired) — pulled
                  live from Amazon.
                </p>
              </div>
            </div>
          </header>
          <InventoryIssuesDashboard />
        </div>
      )}
      {view === "guide" && (
        <div className="mx-auto max-w-6xl px-6 py-10">
          <header className="mb-8">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <BookOpen className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">How to use</h1>
                <p className="text-sm text-muted-foreground">
                  Which numbers refresh themselves, which wait for an upload, and which are frozen
                  snapshots &mdash; plus what is loaded right now.
                </p>
              </div>
            </div>
          </header>
          <GuideDashboard />
        </div>
      )}
      {view === "aged" && (
        <div className="mx-auto max-w-6xl px-6 py-10">
          <header className="mb-8">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Hourglass className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Aged Inventory</h1>
                <p className="text-sm text-muted-foreground">
                  Amazon&apos;s aged-inventory surcharge starts at 181 days and climbs to{" "}
                  <code className="rounded bg-muted px-1">$6.90</code> per cubic foot per month past
                  a year — cents per unit on small items. What matters is rarely this month&apos;s
                  bill; it is what the 91&ndash;180 bucket turns into if nothing sells before it
                  ages over.
                </p>
              </div>
            </div>
          </header>
          <AgedInventoryDashboard />
        </div>
      )}
      {view === "returns" && (
        <div className="mx-auto max-w-6xl px-6 py-10">
          <header className="mb-8">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <RotateCcw className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Returns Strategy</h1>
                <p className="text-sm text-muted-foreground">
                  Every fee is identical whether the customer ships the item back or keeps it — the only difference
                  is whether you get the unit back. So the decision is{" "}
                  <code className="rounded bg-muted px-1">sellable% × landed COGS</code> minus any new
                  returns-processing fee. Add COGS below to get a per-SKU verdict.
                </p>
              </div>
            </div>
          </header>
          <ReturnsDecisionDashboard />
        </div>
      )}
      {view === "storage" && (
        <div className="mx-auto max-w-6xl px-6 py-10">
          <header className="mb-8">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Warehouse className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Storage Costs</h1>
                <p className="text-sm text-muted-foreground">
                  What it costs to hold and move stock, as opposed to the per-unit fee for shipping it: FBA and
                  AWD storage, AWD receiving and transportation, inbound placement and removals — each as Amazon
                  billed it, next to the storage utilisation ratio and sell-through that drive them.
                </p>
              </div>
            </div>
          </header>
          <StorageCostsDashboard />
        </div>
      )}
      {view === "supply" && (
        <div className="mx-auto max-w-6xl px-6 py-10">
          <header className="mb-8">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Network className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Supply Chain</h1>
                <p className="text-sm text-muted-foreground">
                  What each product costs to hold and move, against how fast it actually sells. Storage
                  bills are only meaningful next to the turnover paying for them — this puts them side by
                  side and says which products are running out, sitting too long, or costing more to keep
                  than they earn.
                </p>
              </div>
            </div>
          </header>
          <SupplyChainDashboard />
        </div>
      )}
      {view === "sourcing" && (
        <div className="mx-auto max-w-6xl px-6 py-10">
          <header className="mb-8">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Receipt className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Sourcing Cost</h1>
                <p className="text-sm text-muted-foreground">
                  What Amazon pays when it loses or damages a unit before a customer orders it. It
                  reimburses at its own <em>approved sourcing cost</em>, so anywhere that sits below
                  what the PNL app says the unit costs to make, we are short on every claim.
                </p>
              </div>
            </div>
          </header>
          <SourcingCostPanel />
        </div>
      )}
    </main>
  );
}
