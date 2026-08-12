import { prisma } from "@/lib/db";
import { requireSupplierPage } from "@/lib/auth/guards";
import { PortalPage, identity } from "@/components/dashboard/portal-page";
import { NotificationForm } from "@/components/dashboard/management-forms";

export const dynamic = "force-dynamic";
export default async function NotificationsPage() {
  const { session, companyId } = await requireSupplierPage();
  const company = await prisma.supplierCompany.findUniqueOrThrow({
    where: { id: companyId },
  });
  const preference = await prisma.notificationPreference.findUnique({
    where: {
      userId_supplierCompanyId: {
        userId: session.userId,
        supplierCompanyId: companyId,
      },
    },
  });
  const notifications = await prisma.notification.findMany({
    where: { userId: session.userId, supplierCompanyId: companyId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return (
    <PortalPage
      {...identity(session, company)}
      eyebrow="Personal settings"
      title="Notifications"
      description="Choose how and when Bridge-iT sends opportunity and quotation updates."
    >
      <div className="management-grid">
        <NotificationForm
          preference={
            preference ?? {
              emailNewRequests: true,
              emailRequestReminders: true,
              emailQuotationUpdates: true,
              smsUrgentRequests: false,
              inAppEnabled: true,
              quietHoursStart: null,
              quietHoursEnd: null,
            }
          }
        />
        <section className="panel form-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Latest</p>
              <h2>Notification history</h2>
            </div>
          </div>
          <div className="entity-list">
            {notifications.length ? (
              notifications.map((n) => (
                <article className="entity-row" key={n.id}>
                  <div>
                    <b>{n.title}</b>
                    <small>{n.body}</small>
                    <time>{n.createdAt.toLocaleString("en-GB")}</time>
                  </div>
                  {!n.readAt && <span className="nav-dot" />}
                </article>
              ))
            ) : (
              <div className="empty-state">No notifications yet.</div>
            )}
          </div>
        </section>
      </div>
    </PortalPage>
  );
}
