import Link from "next/link";
import { getBuyerOrders, getBuyerProfile, getBuyerRequests, getBuyerRewards } from "@/lib/buyer/data";

export default async function BuyerOverviewPage() {
  // Keep worker-scoped RLS transactions sequential. This avoids exhausting a
  // small production connection pool when a buyer opens the dashboard.
  const profile = await getBuyerProfile();
  const requests = await getBuyerRequests();
  const orders = await getBuyerOrders();
  const rewards = await getBuyerRewards();
  const active = requests.filter((request) => ["OPEN", "MATCHING", "QUOTED"].includes(request.status));
  return <>
    <header className="buyer-page-head"><p className="eyebrow">Buyer Hub</p><h1>Good to see you, {profile.firstName}.</h1><p>WhatsApp stays the quickest way to Bridge a request. This hub gives you control over the details.</p></header>
    <section className="buyer-stats"><article><span>Active requests</span><b>{active.length}</b><Link href="/buyer/requests">View requests</Link></article><article><span>Orders</span><b>{orders.length}</b><Link href="/buyer/orders">Track orders</Link></article><article><span>Reward balance</span><b>{rewards.account.balance}</b><Link href="/buyer/rewards">View rewards</Link></article></section>
    <section className="buyer-panel"><div className="buyer-section-head"><div><p className="eyebrow">Latest activity</p><h2>Your recent requests</h2></div><Link href="/buyer/requests">View all</Link></div>
      {requests.slice(0, 4).map((request) => <Link className="buyer-list-row" href={`/buyer/requests/${request.reference}`} key={request.reference}><span><b>{request.title}</b><small>{request.reference} · {request.category.name}</small></span><strong>{request.status.replaceAll("_", " ")}</strong></Link>)}
      {!requests.length ? <div className="buyer-empty"><h3>No requests yet</h3><p>Message Bridge-iT on WhatsApp with what you need, where and when.</p><Link href="/buyer/reorder">Bridge a request</Link></div> : null}
    </section>
  </>;
}
