import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/api";
import { processSupplierWinnerEmailsSafely } from "@/lib/notifications/email-worker";
import { selectQuotationForCustomer } from "@/lib/quotes/selection";
import { enqueueContactUnlock, processWhatsAppJobs } from "@/lib/whatsapp/processor";

const schema = z.object({ evidence: z.string().trim().min(8).max(250) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Record the WhatsApp message ID or selection evidence" }, { status: 400 });
  const { id } = await params;
  try {
    const grant = await selectQuotationForCustomer({ quotationId: id, actorUserId: auth.session.userId, evidence: parsed.data.evidence });
    after(async () => {
      await Promise.allSettled([
        (async () => {
          const job = await enqueueContactUnlock(grant.id);
          if (job) await processWhatsAppJobs({ limit: 5 });
        })(),
        processSupplierWinnerEmailsSafely({ limit: 10 }),
      ]);
    });
    return NextResponse.json({ ok: true, contactAccessGrantId: grant.id });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "QUOTATION_NOT_FOUND") return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
    if (["QUOTATION_NOT_SELECTABLE", "REQUEST_NOT_SELECTABLE"].includes(code)) return NextResponse.json({ error: "This quotation can no longer be selected" }, { status: 409 });
    console.error("Customer selection recording failed", error);
    return NextResponse.json({ error: "Selection could not be recorded" }, { status: 409 });
  }
}
