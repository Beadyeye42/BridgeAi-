import { after, NextResponse } from "next/server";
import { z } from "zod";
import { BUYER_LOGIN_NEUTRAL_MESSAGE, requestBuyerLogin } from "@/lib/buyer/auth";

const bodySchema = z.object({
  phone: z.string().trim().min(7).max(40),
  next: z.string().trim().max(512).optional(),
});

export async function POST(request: Request) {
  const neutral = NextResponse.json({ message: BUYER_LOGIN_NEUTRAL_MESSAGE }, {
    status: 202,
    headers: { "cache-control": "private, no-store" },
  });
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 2_048) return neutral;
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return neutral;
    const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
    const input = {
      phone: parsed.data.phone,
      requestedPath: parsed.data.next,
      requestUrl: request.url,
      requestIp: forwarded,
      userAgent: request.headers.get("user-agent"),
    };
    // Return the same response immediately for known and unknown numbers.
    // This closes the timing side channel while delivery continues after the
    // response in the Vercel/Next.js request lifecycle.
    after(async () => {
      await requestBuyerLogin(input).catch(() => undefined);
    });
  } catch {
    // Deliberately return the same response for unknown numbers, malformed
    // inputs and provider failures. Operational detail is recorded server-side.
  }
  return neutral;
}
