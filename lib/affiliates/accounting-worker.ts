import "server-only";

import { Prisma } from "@prisma/client";
import { runAsDatabaseWorker } from "@/lib/db";

export type AffiliateValidationResult = {
  affiliateId: string;
  validatedCount: number;
  availableAmountPence: bigint;
};

export async function validateMatureAffiliateCommissions() {
  return runAsDatabaseWorker("affiliate_accounting", (tx) =>
    tx.$queryRaw<AffiliateValidationResult[]>(Prisma.sql`
      SELECT * FROM bridge_private.validate_affiliate_commissions()
    `),
  );
}
