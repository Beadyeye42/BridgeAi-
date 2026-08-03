import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/auth/guards";
import { AdminHeading } from "@/components/admin/admin-shell";
import { ResolveEventButton } from "@/components/admin/admin-actions";
export default async function SystemPage() {
  await requireAdminPage();
  const events = await prisma.systemEvent.findMany({
    orderBy: { occurredAt: "desc" },
    take: 100,
  });
  const webhooks = await prisma.webhookEvent.count({
    where: { failedAt: { not: null }, processedAt: null },
  });
  const failedNotifications = await prisma.notification.count({
    where: { failedAt: { not: null } },
  });
  return (
    <>
      <AdminHeading
        eyebrow="Operational diagnostics"
        title="System events"
        description={`${webhooks} failed webhook(s) and ${failedNotifications} failed notification(s) currently recorded.`}
      />
      <section className="panel form-section">
        <div className="entity-list">
          {events.length ? (
            events.map((e) => (
              <article className="entity-row system-event" key={e.id}>
                <span className={`severity ${e.severity.toLowerCase()}`}>
                  {e.severity}
                </span>
                <div>
                  <b>{e.message}</b>
                  <small>
                    {e.source} · {e.code}
                  </small>
                  <time>{e.occurredAt.toLocaleString("en-GB")}</time>
                </div>
                <span className={`status-pill ${e.status.toLowerCase()}`}>
                  {e.status}
                </span>
                {e.status !== "RESOLVED" && <ResolveEventButton id={e.id} />}
              </article>
            ))
          ) : (
            <div className="empty-state">No system events recorded.</div>
          )}
        </div>
      </section>
    </>
  );
}
