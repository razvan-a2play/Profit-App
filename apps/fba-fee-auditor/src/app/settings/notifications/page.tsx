import { Bell } from "lucide-react";
import { NotificationSettings } from "@/components/NotificationSettings";

export default function NotificationSettingsPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Bell className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
            <p className="text-sm text-muted-foreground">
              Get emailed when a SKU crosses a threshold. Fires once per day per rule.
            </p>
          </div>
        </div>
      </header>
      <NotificationSettings />
    </main>
  );
}
