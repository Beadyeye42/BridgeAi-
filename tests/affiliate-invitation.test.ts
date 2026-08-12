import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildAffiliateInvitationEmail } from "@/lib/notifications/affiliate-invitation-email";
import { affiliateInvitationCallbackUrl, affiliateInvitationIdempotencyKey } from "@/lib/affiliates/invitations";

describe("affiliate invitation delivery", () => {
  it("renders a branded private invitation without leaking unescaped content", () => {
    const email = buildAffiliateInvitationEmail({
      firstName: '<Brian & "team">',
      invitationUrl: "https://bridge-ai.example/auth/callback?token_hash=secret&type=invite",
    });
    expect(email.subject).toBe("Your private Bridge-iT affiliate invitation");
    expect(email.html).toContain("&lt;Brian &amp; &quot;team&quot;&gt;");
    expect(email.text).toContain("choose a password");
    expect(email.html).toContain("Ironbridge Group Ltd");
  });

  it("builds a server-verifiable setup link and a non-secret provider key", () => {
    const url = new URL(affiliateInvitationCallbackUrl("https://bridge-ai.example", "hashed-secret-token", "invite"));
    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("token_hash")).toBe("hashed-secret-token");
    expect(url.searchParams.get("type")).toBe("invite");
    expect(url.searchParams.get("next")).toBe("/reset-password");
    const key = affiliateInvitationIdempotencyKey("user-id", "hashed-secret-token");
    expect(key).toMatch(/^bridge-ai-affiliate-invite-user-id-[a-f0-9]{20}$/);
    expect(key).not.toContain("hashed-secret-token");
  });

  it("keeps invitation recovery controls visible on narrow administrator screens", () => {
    const styles = readFileSync("app/globals.css", "utf8");
    expect(styles).toContain(".heading-actions { width: 100%; display: flex;");
    expect(styles).not.toContain(".heading-actions { display: none; }");
  });

  it("never strands an active affiliate on the supplier restriction page", () => {
    const restrictedPage = readFileSync("app/account-restricted/page.tsx", "utf8");
    expect(restrictedPage).toContain('session?.user.role === "AFFILIATE"');
    expect(restrictedPage).toContain('redirect("/affiliate")');
  });
});
