import "server-only";
import type { Prisma } from "@prisma/client";

type AssignmentNotificationInput = {
  supplierCompanyIds: string[];
  reference: string;
  title: string;
  responseDueAt: Date;
};

export async function queueSupplierAssignmentNotifications(
  tx: Prisma.TransactionClient,
  input: AssignmentNotificationInput,
) {
  const supplierCompanyIds = [...new Set(input.supplierCompanyIds)];
  if (!supplierCompanyIds.length) return { inApp: 0, email: 0 };

  const members = await tx.supplierTeamMembership.findMany({
    where: { supplierCompanyId: { in: supplierCompanyIds }, status: "ACTIVE" },
    select: { userId: true, supplierCompanyId: true },
  });
  if (!members.length) return { inApp: 0, email: 0 };

  const preferences = await tx.notificationPreference.findMany({
    where: {
      supplierCompanyId: { in: supplierCompanyIds },
      userId: { in: [...new Set(members.map((member) => member.userId))] },
    },
    select: {
      userId: true,
      supplierCompanyId: true,
      inAppEnabled: true,
      emailNewRequests: true,
    },
  });
  const preferenceByMembership = new Map(
    preferences.map((preference) => [`${preference.userId}:${preference.supplierCompanyId}`, preference]),
  );
  const actionUrl = `/dashboard/requests/${input.reference}`;
  const deadline = input.responseDueAt.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const title = `New matched request ${input.reference}`;
  const body = `${input.title} matches your confirmed products, capacity and geographic eligibility. Review it and respond by ${deadline}.`;
  const inAppRecipients = members.filter((member) => {
    const preference = preferenceByMembership.get(`${member.userId}:${member.supplierCompanyId}`);
    return preference?.inAppEnabled !== false;
  });
  const emailRecipients = members.filter((member) => {
    const preference = preferenceByMembership.get(`${member.userId}:${member.supplierCompanyId}`);
    return preference?.emailNewRequests !== false;
  });

  const inApp = inAppRecipients.length
    ? await tx.notification.createMany({
        data: inAppRecipients.map((member) => ({
          userId: member.userId,
          supplierCompanyId: member.supplierCompanyId,
          type: "NEW_QUOTE_REQUEST" as const,
          channel: "IN_APP" as const,
          title,
          body,
          actionUrl,
        })),
        skipDuplicates: true,
      })
    : { count: 0 };
  const email = emailRecipients.length
    ? await tx.notification.createMany({
        data: emailRecipients.map((member) => ({
          userId: member.userId,
          supplierCompanyId: member.supplierCompanyId,
          type: "NEW_QUOTE_REQUEST" as const,
          channel: "EMAIL" as const,
          title,
          body,
          actionUrl,
        })),
        skipDuplicates: true,
      })
    : { count: 0 };

  return { inApp: inApp.count, email: email.count };
}
