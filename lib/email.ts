import {
  buildSupplierNotificationEmail,
  buildSupplierWinnerEmail,
  type SupplierNotificationEmailInput,
  type SupplierWinnerEmailInput,
} from "@/lib/notifications/winner-email";

export async function sendTeamInvitationEmail(email: string, invitationUrl: string) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    if (process.env.NODE_ENV === "development") console.info(`[Bridge AI] Team invitation for ${email}: ${invitationUrl}`);
    return { delivered: false as const, reason: "provider_not_configured" as const };
  }
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [email], subject: "Join your supplier team on Bridge AI", text: `You have been invited to a Bridge AI supplier workspace. Accept the invitation: ${invitationUrl}\n\nThis link expires in seven days.` }), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Team invitation email failed with status ${response.status}`);
  return { delivered: true as const };
}

export type OperationalEmailAlert = {
  severity: "WARNING" | "ERROR" | "CRITICAL";
  title: string;
  body: string;
  actionUrl?: string | null;
};

export function operationalEmailConfiguration() {
  const recipients = (process.env.MONITORING_ALERT_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const validRecipients = recipients.length > 0
    && recipients.length <= 10
    && recipients.every((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return { configured: false as const, recipients: [], reason: "Resend email delivery is not configured" };
  }
  if (!validRecipients) {
    return { configured: false as const, recipients: [], reason: "MONITORING_ALERT_EMAILS is missing or invalid" };
  }
  return { configured: true as const, recipients: [...new Set(recipients)], reason: null };
}

export async function sendOperationalAlertEmail(
  alerts: OperationalEmailAlert[],
  idempotencyKey: string,
) {
  const config = operationalEmailConfiguration();
  if (!config.configured) throw new Error(`MONITORING_EMAIL_NOT_CONFIGURED: ${config.reason}`);
  if (!alerts.length) throw new Error("MONITORING_ALERTS_EMPTY");
  const critical = alerts.some((alert) => alert.severity === "CRITICAL");
  const subject = `${critical ? "[CRITICAL]" : "[Action required]"} Bridge AI production alert${alerts.length === 1 ? "" : "s"} (${alerts.length})`;
  const text = [
    "Bridge AI detected production issues that require administrator attention.",
    "No customer contact details or message contents are included in this email.",
    "",
    ...alerts.flatMap((alert, index) => [
      `${index + 1}. [${alert.severity}] ${alert.title}`,
      alert.body,
      ...(alert.actionUrl ? [`Review: ${alert.actionUrl}`] : []),
      "",
    ]),
  ].join("\n");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: config.recipients, subject, text }),
  });
  if (!response.ok) throw new Error(`Operational alert email failed with status ${response.status}`);
  const payload = await response.json().catch(() => null) as { id?: string } | null;
  return { delivered: true as const, providerEmailId: payload?.id ?? null };
}

export function supplierEmailConfiguration() {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return { configured: false as const, reason: "Resend supplier email delivery is not configured" };
  }
  return { configured: true as const, reason: null };
}

export async function sendSupplierWinnerEmail(
  recipientEmail: string,
  input: SupplierWinnerEmailInput,
  idempotencyKey: string,
) {
  const config = supplierEmailConfiguration();
  if (!config.configured) throw new Error(`SUPPLIER_EMAIL_NOT_CONFIGURED: ${config.reason}`);
  const email = buildSupplierWinnerEmail(input);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [recipientEmail],
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
  });
  if (!response.ok) throw new Error(`Supplier winner email failed with status ${response.status}`);
  const payload = await response.json().catch(() => null) as { id?: string } | null;
  return { delivered: true as const, providerEmailId: payload?.id ?? null };
}

export async function sendSupplierNotificationEmail(
  recipientEmail: string,
  input: SupplierNotificationEmailInput,
  idempotencyKey: string,
) {
  const config = supplierEmailConfiguration();
  if (!config.configured) throw new Error(`SUPPLIER_EMAIL_NOT_CONFIGURED: ${config.reason}`);
  const email = buildSupplierNotificationEmail(input);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [recipientEmail],
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
  });
  if (!response.ok) throw new Error(`Supplier notification email failed with status ${response.status}`);
  const payload = await response.json().catch(() => null) as { id?: string } | null;
  return { delivered: true as const, providerEmailId: payload?.id ?? null };
}

export async function sendAffiliateNotificationEmail(
  recipientEmail: string,
  input: { firstName: string; title: string; body: string; portalUrl: string },
  idempotencyKey: string,
) {
  const config = supplierEmailConfiguration();
  if (!config.configured) throw new Error(`AFFILIATE_EMAIL_NOT_CONFIGURED: ${config.reason}`);
  const text = [`Hello ${input.firstName},`, "", input.body, "", `View your affiliate portal: ${input.portalUrl}`, "", "Bridge AI · Ironbridge Group Ltd"].join("\n");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [recipientEmail], subject: input.title, text }),
  });
  if (!response.ok) throw new Error(`Affiliate notification email failed with status ${response.status}`);
  const payload = await response.json().catch(() => null) as { id?: string } | null;
  return { delivered: true as const, providerEmailId: payload?.id ?? null };
}
