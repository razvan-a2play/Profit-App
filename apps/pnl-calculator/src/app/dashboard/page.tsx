import RequireAuth from "@/components/auth/RequireAuth";
import DashboardTable from "@/components/DashboardTable";
import ErrorBoundary from "@/components/ErrorBoundary";
import { UserMenu } from "@/components/UserMenu";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <ErrorBoundary>
      <RequireAuth>
        <main className="min-h-screen bg-gradient-to-br from-primary-light via-background to-accent-light p-4 md:p-6">
          <div className="max-w-[1600px] mx-auto">
            <div className="flex justify-end mb-2">
              <UserMenu />
            </div>
            <header className="mb-6">
              <h1 className="text-3xl font-bold text-primary">Live SKU Dashboard</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Every SKU with a live snapshot in one view. Edit price or TACOS inline to explore
                what-if — nothing is written back.
              </p>
            </header>
            <DashboardTable />
          </div>
        </main>
      </RequireAuth>
    </ErrorBoundary>
  );
}
