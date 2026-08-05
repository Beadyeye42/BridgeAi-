import { AlertTriangle, BellOff, MessageSquareWarning, Webhook } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/auth/guards";
import { AdminHeading } from "@/components/admin/admin-shell";
import { ResolveEventButton, RetryWhatsAppJobButton } from "@/components/admin/admin-actions";

export const dynamic = "force-dynamic";

export default async function SystemPage() {
  await requireAdminPage();
  const failedJobs = await prisma.whatsAppJob.findMany({
    where: { status: "FAILED" },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, type: true, attempts: true, errorCode: true, failedAt: true, createdAt: true },
  });
  const failedWebhooks = await prisma.webhookEvent.findMany({
    where: { failedAt: { not: null }, processedAt: null },
    orderBy: { failedAt: "desc" },
    take: 50,
    select: { id: true, provider: true, eventType: true, failureReason: true, retryCount: true, failedAt: true },
  });
  const failedNotifications = await prisma.notification.findMany({
    where: { failedAt: { not: null }, sentAt: null },
    orderBy: { failedAt: "desc" },
    take: 50,
    select: { id: true, title: true, channel: true, failureReason: true, failedAt: true },
  });
  const events = await prisma.systemEvent.findMany({
    orderBy: [{ status: "asc" }, { occurredAt: "desc" }],
    take: 100,
  });
  const openCritical = events.filter((event) => event.status !== "RESOLVED" && ["ERROR", "CRITICAL"].includes(event.severity)).length;

  return <>
    <AdminHeading
      eyebrow="Operational diagnostics"
      title="Operations centre"
      description="Inspect failures, retry only idempotent WhatsApp work, and record when incidents are resolved."
    />
    <section className="operations-stats" aria-label="Open operational failures">
      <OperationStat icon={<MessageSquareWarning size={20} />} label="Failed WhatsApp jobs" value={failedJobs.length} tone="error" />
      <OperationStat icon={<Webhook size={20} />} label="Failed webhooks" value={failedWebhooks.length} tone="warning" />
      <OperationStat icon={<BellOff size={20} />} label="Failed notifications" value={failedNotifications.length} tone="warning" />
      <OperationStat icon={<AlertTriangle size={20} />} label="Open serious events" value={openCritical} tone="error" />
    </section>

    <div className="management-grid operations-grid">
      <section className="panel form-section">
        <div className="section-heading"><div><p className="eyebrow">Recovery queue</p><h2>Failed WhatsApp actions</h2></div><MessageSquareWarning size={20} /></div>
        <div className="entity-list">
          {failedJobs.length ? failedJobs.map((job) => {
            const retrySafe = job.errorCode !== "OUTBOUND_DELIVERY_UNCERTAIN";
            return <article className="entity-row system-event" key={job.id}>
              <span className="severity error">FAILED</span>
              <div><b>{job.type.replaceAll("_", " ")}</b><small>{job.errorCode ?? "Unknown error"} · {job.attempts} attempt{job.attempts === 1 ? "" : "s"}</small><time>{(job.failedAt ?? job.createdAt).toLocaleString("en-GB")}</time>{!retrySafe && <small className="error-text">Manual review required: delivery may already have occurred.</small>}</div>
              <RetryWhatsAppJobButton id={job.id} retrySafe={retrySafe} />
            </article>;
          }) : <div className="empty-state">No failed WhatsApp actions.</div>}
        </div>
      </section>

      <section className="panel form-section">
        <div className="section-heading"><div><p className="eyebrow">Provider redelivery</p><h2>Failed webhooks</h2></div><Webhook size={20} /></div>
        <div className="entity-list">
          {failedWebhooks.length ? failedWebhooks.map((event) => <article className="entity-row" key={event.id}>
            <span className="severity warning">{event.provider}</span>
            <div><b>{event.eventType}</b><small>{event.failureReason ?? "Processing failed"} · {event.retryCount} retries</small><time>{event.failedAt?.toLocaleString("en-GB")}</time><small>Redeliver this verified event from the {event.provider === "STRIPE" ? "Stripe" : "Meta"} dashboard. Bridge AI deliberately does not retain the original signed payload.</small></div>
          </article>) : <div className="empty-state">No failed webhooks awaiting provider redelivery.</div>}
        </div>
      </section>
    </div>

    {failedNotifications.length > 0 && <section className="panel form-section spaced-section">
      <div className="section-heading"><div><p className="eyebrow">Delivery review</p><h2>Failed notifications</h2></div><BellOff size={20} /></div>
      <div className="entity-list">{failedNotifications.map((notification) => <article className="entity-row" key={notification.id}><span className="status-pill failed">{notification.channel}</span><div><b>{notification.title}</b><small>{notification.failureReason ?? "Delivery failed"}</small><time>{notification.failedAt?.toLocaleString("en-GB")}</time></div></article>)}</div>
    </section>}

    <section className="panel form-section spaced-section">
      <div className="section-heading"><div><p className="eyebrow">Incident log</p><h2>System events</h2></div><AlertTriangle size={20} /></div>
      <div className="entity-list">
        {events.length ? events.map((event) => <article className="entity-row system-event" key={event.id}>
          <span className={`severity ${event.severity.toLowerCase()}`}>{event.severity}</span>
          <div><b>{event.message}</b><small>{event.source} · {event.code}</small><time>{event.occurredAt.toLocaleString("en-GB")}</time></div>
          <span className={`status-pill ${event.status.toLowerCase()}`}>{event.status}</span>
          {event.status !== "RESOLVED" && <ResolveEventButton id={event.id} />}
        </article>) : <div className="empty-state">No system events recorded.</div>}
      </div>
    </section>
  </>;
}

function OperationStat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return <article className={`operation-stat ${tone}`}><span>{icon}</span><div><b>{value}</b><small>{label}</small></div></article>;
}
