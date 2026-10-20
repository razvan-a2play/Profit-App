import { NextResponse } from "next/server";
import { runNotificationCheck } from "@/lib/notificationCheck";

export const dynamic = "force-dynamic";

/**
 * POST /api/notifications/check — evaluates every enabled rule and emails on
 * breach. Meant to be hit by the daily Windows Scheduled Task, but also usable
 * as an ad-hoc "test my rule now" button. Also allows GET for scheduler
 * convenience (curl in Task Scheduler is easier without a POST body).
 */
async function handler() {
  try {
    const result = await runNotificationCheck();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ran: false, error: (err as Error).message }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
