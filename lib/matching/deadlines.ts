import "server-only";
import type { Prisma } from "@prisma/client";

type DeadlineClient = Pick<Prisma.TransactionClient, "productCategory">;

export async function resolveIndustryResponseDeadlines(
  db: DeadlineClient,
  categoryId: string,
  defaults: { acknowledgementHours: number; quotationHours: number },
) {
  const category = await db.productCategory.findUnique({
    where: { id: categoryId },
    select: {
      acknowledgementDeadlineHours: true,
      quotationDeadlineHours: true,
      parent: { select: { acknowledgementDeadlineHours: true, quotationDeadlineHours: true } },
    },
  });
  return {
    acknowledgementHours: category?.parent?.acknowledgementDeadlineHours ?? category?.acknowledgementDeadlineHours ?? defaults.acknowledgementHours,
    quotationHours: category?.parent?.quotationDeadlineHours ?? category?.quotationDeadlineHours ?? defaults.quotationHours,
  };
}
