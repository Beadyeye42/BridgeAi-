import { NextResponse } from "next/server";
import { z } from "zod";
import { getBuyerSession } from "@/lib/buyer/session";
import { runAsDatabaseWorker } from "@/lib/db";
import { encryptPrivateValue } from "@/lib/security/encryption";
import { formatPostcode, normalizePostcode } from "@/lib/location/postcodes";

const schema = z.object({
  companyName: z.string().trim().max(160),
  postcode: z.string().trim().max(12),
  buyerType: z.enum(["CONSUMER", "TRADE", "BUSINESS"]),
  whatsappUpdates: z.boolean(), emailUpdates: z.boolean(),
});

export async function PUT(request: Request) {
  const session = await getBuyerSession();
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the account details and try again." }, { status: 400 });
  const postcode = parsed.data.postcode ? formatPostcode(normalizePostcode(parsed.data.postcode)) : "";
  if (parsed.data.postcode && !/^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/.test(postcode)) return NextResponse.json({ error: "Enter a valid UK postcode." }, { status: 400 });
  await runAsDatabaseWorker("buyer_auth", async (tx) => {
    await tx.customerContact.update({ where: { id: session.buyer.id }, data: {
      companyNameEncrypted: parsed.data.companyName ? encryptPrivateValue(parsed.data.companyName) : null,
      defaultPostcodeEncrypted: postcode ? encryptPrivateValue(postcode) : null,
      buyerTypePreference: parsed.data.buyerType,
      buyerWhatsAppUpdates: parsed.data.whatsappUpdates,
      buyerEmailUpdates: parsed.data.emailUpdates,
    } });
    await tx.buyerSecurityEvent.create({ data: { customerContactId: session.buyer.id, authUserId: session.user.id, eventType: "BUYER_ACCOUNT_UPDATED", metadata: { buyerType: parsed.data.buyerType, hasCompanyName: Boolean(parsed.data.companyName), hasPostcode: Boolean(postcode), whatsappUpdates: parsed.data.whatsappUpdates, emailUpdates: parsed.data.emailUpdates } } });
  });
  return NextResponse.json({ ok: true });
}
