import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getBuyerSession } from "@/lib/buyer/session";
import { runAsDatabaseWorker } from "@/lib/db";
import { processSupplierEmailsSafely } from "@/lib/notifications/email-worker";
import { selectQuotationForCustomer } from "@/lib/quotes/selection";
import { processWhatsAppJobs } from "@/lib/whatsapp/processor";

const schema = z.object({ reference: z.string().trim().regex(/^BA-[A-Z0-9-]{6,32}$/), label: z.string().trim().toUpperCase().regex(/^[A-E]$/) });

export async function POST(request: Request) {
  const session = await getBuyerSession();
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid quote." }, { status: 400 });
  const quotation = await runAsDatabaseWorker("buyer_auth", (tx) => tx.supplierQuotation.findFirst({
    where: { status: "SUBMITTED", conversation: { anonymousLabel: parsed.data.label }, quoteRequest: { reference: parsed.data.reference, customerContactId: session.buyer.id, status: { in: ["OPEN", "MATCHING", "QUOTED"] } } },
    select: { id: true },
  }));
  if (!quotation) return NextResponse.json({ error: "That quote is no longer available. Refresh and try again." }, { status: 409 });
  try {
    await selectQuotationForCustomer({ quotationId: quotation.id, buyerAuthUserId: session.user.id, buyerCustomerContactId: session.buyer.id, source: "BUYER_PORTAL", evidence: `Buyer Hub selected Quote ${parsed.data.label}` });
    const order = await runAsDatabaseWorker("buyer_auth", (tx) => tx.buyerOrder.findUnique({ where: { quotationId: quotation.id }, select: { reference: true } }));
    after(async () => { await Promise.allSettled([processSupplierEmailsSafely({ limit: 10 }), processWhatsAppJobs({ limit: 5 })]); });
    return NextResponse.json({ ok: true, orderReference: order?.reference ?? null });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (["QUOTATION_NOT_SELECTABLE", "QUOTATION_EXPIRED", "REQUEST_NOT_SELECTABLE", "BUYER_SELECTION_SCOPE_MISMATCH"].includes(code)) return NextResponse.json({ error: "That quote is no longer available. Refresh and try again." }, { status: 409 });
    console.error("Buyer Hub quote selection failed", { reference: parsed.data.reference, error });
    return NextResponse.json({ error: "The quote could not be selected securely. Please try again." }, { status: 500 });
  }
}
