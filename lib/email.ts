export async function sendTeamInvitationEmail(email: string, invitationUrl: string) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    if (process.env.NODE_ENV === "development") console.info(`[Bridge AI] Team invitation for ${email}: ${invitationUrl}`);
    return { delivered: false as const, reason: "provider_not_configured" as const };
  }
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [email], subject: "Join your supplier team on Bridge AI", text: `You have been invited to a Bridge AI supplier workspace. Accept the invitation: ${invitationUrl}\n\nThis link expires in seven days.` }) });
  if (!response.ok) throw new Error(`Team invitation email failed with status ${response.status}`);
  return { delivered: true as const };
}
