"use client";

// Which Amazon fee schedule the calculator prices with. "Auto" follows the
// calendar (2027 rates from Jan 15, 2027, once entered); picking a year lets
// you price for next year's rates ahead of the switch. Per-browser setting:
// it changes what you see, never what's saved on a product.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  FEE_SCHEDULES,
  resolveFeeSchedule,
  scheduleInEffect,
  type FeeScheduleChoice,
  type ResolvedFeeSchedule,
} from "@platform/calc";

const STORAGE_KEY = "pnl.feeSchedule";

interface FeeScheduleContextValue extends ResolvedFeeSchedule {
  setChoice: (choice: FeeScheduleChoice) => void;
}

const FeeScheduleContext = createContext<FeeScheduleContextValue | null>(null);

function isChoice(v: unknown): v is FeeScheduleChoice {
  return v === "auto" || FEE_SCHEDULES.some((s) => s.id === v);
}

export function FeeScheduleProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoiceState] = useState<FeeScheduleChoice>("auto");

  // Read after mount so server and client render the same first frame.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isChoice(stored)) setChoiceState(stored);
    } catch {
      /* storage blocked: stay on auto */
    }
  }, []);

  const value = useMemo<FeeScheduleContextValue>(() => {
    const setChoice = (next: FeeScheduleChoice) => {
      setChoiceState(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
    };
    return { ...resolveFeeSchedule(choice), setChoice };
  }, [choice]);

  return <FeeScheduleContext.Provider value={value}>{children}</FeeScheduleContext.Provider>;
}

export function useFeeSchedule(): FeeScheduleContextValue {
  const ctx = useContext(FeeScheduleContext);
  // Outside the provider (tests, stray mounts): today's schedule, read-only.
  return ctx ?? { ...resolveFeeSchedule("auto"), setChoice: () => {} };
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Compact "Amazon fees: …" picker for page headers. */
export function FeeScheduleSelect() {
  const { choice, schedule, fellBackFrom, setChoice } = useFeeSchedule();
  const today = scheduleInEffect();

  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor="fee-schedule" className="text-muted-foreground whitespace-nowrap">
        Amazon fees
      </label>
      <select
        id="fee-schedule"
        value={choice}
        onChange={(e) => setChoice(e.target.value as FeeScheduleChoice)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="auto">Auto ({today.label}, in effect today)</option>
        {FEE_SCHEDULES.map((s) => (
          <option key={s.id} value={s.id} disabled={s.status === "pending"}>
            {s.label} (from {fmtDate(s.effectiveFrom)})
            {s.status === "pending" ? " — not entered yet" : s.peakEstimate ? " — peak estimated" : ""}
          </option>
        ))}
      </select>
      {fellBackFrom && (
        <span className="text-xs text-amber-700 whitespace-nowrap">
          {fellBackFrom.label} not entered yet, showing {schedule.label}
        </span>
      )}
      {schedule.peakEstimate && (
        <span className="text-xs text-amber-700 cursor-help" title={schedule.peakEstimate}>
          Holiday peak fees estimated
        </span>
      )}
    </div>
  );
}
