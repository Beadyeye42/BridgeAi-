import "server-only";

import { applicationOrigin } from "@/lib/config";
import { runAsDatabaseWorker } from "@/lib/db";
import { sendAffiliateNotificationEmail, supplierEmailConfiguration } from "@/lib/email";

export async function processAffiliateEmailsSafely() {
  if (!supplierEmailConfiguration().configured) return;
  try {
    const notifications = await runAsDatabaseWorker("supplier_email", (tx) => tx.affiliateNotification.findMany({
      where: { emailedAt: null },
      include: { affiliate: { include: { user: { select: { email: true, firstName: true, status: true } } } } },
      orderBy: { createdAt: "asc" },
      take: 10,
    }));
    for (const notification of notifications) {
      if (notification.affiliate.user.status !== "ACTIVE") continue;
      try {
        await sendAffiliateNotificationEmail(notification.affiliate.user.email, {
          firstName: notification.affiliate.user.firstName,
          title: notification.title,
          body: notification.body,
          portalUrl: new URL(notification.actionUrl ?? "/affiliate", applicationOrigin(process.env.APP_URL || "http://localhost:3000")).toString(),
        }, `bridge-ai-affiliate-${notification.id}`);
        await runAsDatabaseWorker("supplier_email", (tx) => tx.affiliateNotification.update({ where: { id: notification.id }, data: { emailedAt: new Date() } }));
      } catch (error) {
        console.error("Affiliate notification email failed", error);
      }
    }
  } catch (error) {
    console.error("Affiliate email worker failed", error);
  }
}
