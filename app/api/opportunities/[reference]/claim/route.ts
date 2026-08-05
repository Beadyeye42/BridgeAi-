import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSupplierApi } from "@/lib/auth/api";

export const runtime = "nodejs";

const referenceSchema = z.string().trim().min(3).max(64).regex(/^[A-Z0-9-]+$/, "Invalid quote reference");

const failures: Array<[string, number, string]> = [
  ["ACTIVE_SUBSCRIPTION_REQUIRED", 402, "An active £5 monthly membership is required to quote"],
  ["OPPORTUNITY_FULL", 409, "All supplier places for this opportunity have been taken"],
  ["OPPORTUNITY_CLOSED", 410, "The response window for this opportunity has closed"],
  ["CATEGORY_NOT_MATCHED", 403, "Add this product category to your company profile before quoting"],
  ["ACCREDITATION_REQUIRED", 403, "An approved, in-date accreditation document is required before quoting"],
  ["COVERAGE_NOT_MATCHED", 403, "This delivery area is outside your saved coverage"],
  ["CLAIM_NOT_AUTHORISED", 403, "This supplier account is not allowed to claim the opportunity"],
  ["OPPORTUNITY_NOT_FOUND", 404, "Opportunity not found"],
];

export async function POST(_request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const auth = await requireSupplierApi();
  if ("error" in auth) return auth.error;

  const parsed = referenceSchema.safeParse((await params).reference);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid quote reference" }, { status: 400 });

  try {
    const rows = await prisma.$transaction((tx) => tx.$queryRaw<Array<{ assignmentId: string }>>`
      SELECT bridge_private.claim_supplier_opportunity(${parsed.data}, ${auth.companyId}) AS "assignmentId"
    `);
    const assignmentId = rows[0]?.assignmentId;
    if (!assignmentId) throw new Error("CLAIM_RESULT_MISSING");
    return NextResponse.json({ ok: true, assignmentId }, { status: 201 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    const failure = failures.find(([code]) => detail.includes(code));
    if (failure) return NextResponse.json({ error: failure[2] }, { status: failure[1] });
    console.error("Opportunity claim failed", { reference: parsed.data, error: detail });
    return NextResponse.json({ error: "The opportunity could not be claimed. Please try again." }, { status: 500 });
  }
}
