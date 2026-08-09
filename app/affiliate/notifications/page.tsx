import { prisma } from "@/lib/db";
import { requireAffiliatePage } from "@/lib/auth/guards";

export default async function AffiliateNotificationsPage() {
  const { affiliate } = await requireAffiliatePage();
  const notices = await prisma.affiliateNotification.findMany({ where: { affiliateId: affiliate.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return <><div className="page-heading"><div><p className="eyebrow">Live updates</p><h1>Notifications</h1><p>Payments, cancellations, recoveries and commission milestones.</p></div></div><section className="panel"><div className="data-list">{notices.map((notice) => <article className="data-row" key={notice.id}><div><b>{notice.title}</b><small>{notice.body}</small></div><time>{notice.createdAt.toLocaleString("en-GB")}</time></article>)}{!notices.length && <div className="empty-state">No affiliate notifications yet.</div>}</div></section></>;
}
