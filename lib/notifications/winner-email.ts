export type SupplierWinnerEmailInput = {
  recipientFirstName: string;
  title: string;
  body: string;
  portalUrl: string;
};

export type SupplierNotificationEmailInput = SupplierWinnerEmailInput & {
  kind: "NEW_QUOTE_REQUEST" | "QUOTATION_ACCEPTED";
};

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

export function buildSupplierNotificationEmail(input: SupplierNotificationEmailInput) {
  const firstName = input.recipientFirstName.trim() || "there";
  const subject = input.title.trim();
  const isOpportunity = input.kind === "NEW_QUOTE_REQUEST";
  const label = isOpportunity ? "New matched opportunity" : "Quotation selected";
  const button = isOpportunity ? "Review opportunity" : "Open secure request";
  const preheader = isOpportunity
    ? "A new Bridge-iT opportunity matches your confirmed products, capacity and coverage."
    : "A customer selected your Bridge-iT quotation.";
  const privacyText = isOpportunity
    ? "Customer contact details are not included in email. Sign in to your approved supplier workspace to review the secure quote pack."
    : "Customer contact details are available only after you sign in to your approved supplier workspace.";
  const text = [
    `Hi ${firstName},`,
    "",
    input.title,
    input.body,
    "",
    `${button}: ${input.portalUrl}`,
    "",
    privacyText,
    "",
    "Bridge-iT",
    "Owned by Ironbridge Group Ltd",
  ].join("\n");
  const html = `<!doctype html>
<html lang="en"><body style="margin:0;background:#f4f6f2;font-family:Arial,sans-serif;color:#17382f">
  <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f2;padding:32px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #dfe6dc;border-radius:16px;overflow:hidden">
      <tr><td style="padding:26px 32px;background:#153a30;color:#ffffff;font-size:22px;font-weight:700">Bridge-<span style="color:#c8ed79">iT</span></td></tr>
      <tr><td style="padding:34px 32px">
        <p style="margin:0 0 18px;font-size:16px">Hi ${escapeHtml(firstName)},</p>
        <p style="margin:0 0 10px;color:#41715f;font-size:13px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase">${escapeHtml(label)}</p>
        <h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:30px;line-height:1.2;color:#17382f">${escapeHtml(input.title)}</h1>
        <p style="margin:0 0 26px;font-size:16px;line-height:1.6;color:#51645d">${escapeHtml(input.body)}</p>
        <a href="${escapeHtml(input.portalUrl)}" style="display:inline-block;padding:14px 20px;border-radius:8px;background:#153a30;color:#ffffff;text-decoration:none;font-weight:700">${escapeHtml(button)}</a>
        <p style="margin:28px 0 0;padding-top:22px;border-top:1px solid #e5ebe3;font-size:13px;line-height:1.5;color:#718078">${escapeHtml(privacyText)}</p>
      </td></tr>
      <tr><td style="padding:20px 32px;background:#eef4e9;color:#617268;font-size:12px">Bridge-iT · Owned by Ironbridge Group Ltd</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return { subject, text, html };
}

export function buildSupplierWinnerEmail(input: SupplierWinnerEmailInput) {
  return buildSupplierNotificationEmail({ ...input, kind: "QUOTATION_ACCEPTED" });
}
