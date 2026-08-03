import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth/api";
import { selectQuotationForCustomer } from "@/lib/quotes/selection";

const schema = z.object({ evidence: z.string().trim().min(8).max(250) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Record the WhatsApp message ID or selection evidence" }, { status: 400 });
  const { id } = await params;
  try {
    const fee = await selectQuotationForCustomer({ quotationId: id, actorUserId: auth.session.userId, evidence: parsed.data.evidence });
    return NextResponse.json({ ok: true, successFeeId: fee.id, paymentDueAt: fee.paymentDueAt });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "QUOTATION_NOT_FOUND") return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
    if (["QUOTATION_NOT_SELECTABLE", "REQUEST_NOT_SELECTABLE"].includes(code)) return NextResponse.json({ error: "This quotation can no longer be selected" }, { status: 409 });
    console.error("Customer selection recording failed", error);
    return NextResponse.json({ error: "Selection could not be recorded" }, { status: 409 });
  }
}
