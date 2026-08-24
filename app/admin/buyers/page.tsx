import { AdminHeading } from "@/components/admin/admin-shell";
import { BuyerStatusControl } from "@/components/admin/buyer-status-control";
import { requireAdminPage } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { decryptPrivateValue } from "@/lib/security/encryption";

function safeDecrypt(value: Uint8Array | null, fallback: string) {
  if (!value) return fallback;
  try { return decryptPrivateValue(value); } catch { return fallback; }
}

export default async function AdminBuyersPage() {
  await requireAdminPage();
  const buyers = await prisma.customerContact.findMany({
      where: { buyerAuthUserId: { not: null } },
      select: {
        id: true,
        preferredFirstNameEncrypted: true,
        companyNameEncrypted: true,
        buyerAuthUserId: true,
        buyerPortalStatus: true,
        buyerLastLoginAt: true,
        createdAt: true,
        _count: { select: { quoteRequests: true, buyerOrders: true, buyerLoginChallenges: true } },
        buyerRewardAccount: { select: { balance: true, lifetimeEarned: true, tier: true } },
      },
      orderBy: [{ buyerLastLoginAt: "desc" }, { createdAt: "desc" }],
    });
  // This server-rendered operational metric deliberately uses the request time.
  // eslint-disable-next-line react-hooks/purity
  const eventCounts = await prisma.buyerSecurityEvent.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
  const activeOrders = await prisma.buyerOrder.count({ where: { status: { in: ["PENDING_CONFIRMATION", "CONFIRMED", "DISPATCHED"] } } });
  const completedOrders = await prisma.buyerOrder.count({ where: { status: "COMPLETED" } });
  const suspended = buyers.filter((buyer) => buyer.buyerPortalStatus === "SUSPENDED").length;

  return <>
    <AdminHeading eyebrow="Buyer security and support" title="Buyers" description="Monitor passwordless Buyer Hub access, request and order activity, reward balances and security status. Customer contact details remain encrypted and are not exposed here unnecessarily." />
    <div className="stats-grid">
      <article className="stat-card"><span>Buyer Hub accounts</span><strong>{buyers.length}</strong><small>Linked to existing WhatsApp identities</small></article>
      <article className="stat-card"><span>Active orders</span><strong>{activeOrders}</strong><small>Selected through dispatch</small></article>
      <article className="stat-card"><span>Completed orders</span><strong>{completedOrders}</strong><small>Eligible for reward credits</small></article>
      <article className="stat-card"><span>Security events</span><strong>{eventCounts}</strong><small>Last 24 hours · {suspended} suspended</small></article>
    </div>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">Least-privilege support view</p><h2>Buyer Hub accounts</h2></div><span>{buyers.length} linked</span></div>
      <div className="table-wrap"><table className="admin-table"><thead><tr><th>Buyer</th><th>Last sign-in</th><th>Requests</th><th>Orders</th><th>Rewards</th><th>Login links</th><th>Access</th></tr></thead><tbody>
        {buyers.map((buyer) => <tr key={buyer.id}><td><b>{safeDecrypt(buyer.preferredFirstNameEncrypted, "Buyer")}</b><small>{safeDecrypt(buyer.companyNameEncrypted, "Personal buyer")} · {buyer.id.slice(-8)}</small></td><td>{buyer.buyerLastLoginAt ? buyer.buyerLastLoginAt.toLocaleString("en-GB") : "Never"}</td><td>{buyer._count.quoteRequests}</td><td>{buyer._count.buyerOrders}</td><td><b>{buyer.buyerRewardAccount?.balance ?? 0} points</b><small>{buyer.buyerRewardAccount?.tier ?? "BRONZE"} · {buyer.buyerRewardAccount?.lifetimeEarned ?? 0} lifetime</small></td><td>{buyer._count.buyerLoginChallenges}</td><td><BuyerStatusControl id={buyer.id} status={buyer.buyerPortalStatus} /></td></tr>)}
        {!buyers.length ? <tr><td colSpan={7}>No buyers have activated Buyer Hub yet.</td></tr> : null}
      </tbody></table></div>
    </section>
  </>;
}
