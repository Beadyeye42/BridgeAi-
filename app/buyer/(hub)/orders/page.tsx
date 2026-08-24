import Link from "next/link";
import { getBuyerOrders } from "@/lib/buyer/data";

const money = (value: { toString(): string }, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(value));

export default async function BuyerOrdersPage() {
  const orders = await getBuyerOrders();
  return <><header className="buyer-page-head"><p className="eyebrow">After selection</p><h1>Orders</h1><p>Track the supplier you selected from confirmation through completion.</p></header><section className="buyer-panel">
    {orders.map((order) => <Link className="buyer-list-row" href={`/buyer/orders/${order.reference}`} key={order.reference}><span><b>{order.quoteRequest.title}</b><small>{order.reference} · {order.supplierCompany.tradingName ?? order.supplierCompany.legalName} · {money(order.quotation.price, order.quotation.currency)}</small></span><strong>{order.status.replaceAll("_", " ")}</strong></Link>)}
    {!orders.length ? <div className="buyer-empty"><h3>No orders yet</h3><p>An order begins only when you select a supplier quote to move forward.</p></div> : null}
  </section></>;
}
