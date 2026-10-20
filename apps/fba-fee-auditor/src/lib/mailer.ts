// Gmail SMTP transport for notification emails. Uses an App Password
// (Google → Security → App passwords). Falls back to a no-op that logs to the
// server console so the check pipeline never crashes when SMTP isn't configured.

import nodemailer from "nodemailer";

interface MailerConfig {
  user: string;
  pass: string;
  from: string;
}

function config(): MailerConfig | null {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return { user, pass, from: process.env.GMAIL_FROM || user };
}

export interface SendResult {
  sent: boolean;
  reason?: string;
  messageId?: string;
}

export async function sendMail(to: string, subject: string, html: string): Promise<SendResult> {
  const cfg = config();
  if (!cfg) {
    console.warn("[mailer] GMAIL_USER / GMAIL_APP_PASSWORD not set — email not sent.");
    return { sent: false, reason: "smtp-not-configured" };
  }

  const transport = nodemailer.createTransport({
    service: "gmail",
    auth: { user: cfg.user, pass: cfg.pass },
  });

  const info = await transport.sendMail({
    from: cfg.from,
    to,
    subject,
    html,
  });

  return { sent: true, messageId: info.messageId };
}
