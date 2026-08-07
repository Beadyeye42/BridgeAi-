import Link from "next/link";
import { ArrowLeft, Package2 } from "lucide-react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/auth/guards";
import { AdminHeading } from "@/components/admin/admin-shell";
import { CategoryStatusButton, ProductCreateForm } from "@/components/admin/admin-actions";
import { industryExperience, industryLaunchBlocker } from "@/lib/categories/industry-registry";

export default async function IndustryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const industry = await prisma.productCategory.findFirst({
    where: { id, parentId: null, adminVisible: true },
    include: {
      children: {
        include: { _count: { select: { suppliers: true, quoteRequests: true } } },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      },
    },
  });
  if (!industry) notFound();
  const experience = industryExperience(industry.slug);
  const activeProductCount = industry.children.filter((product) => product.active).length;
  const launchBlocker = industry.active ? undefined : industryLaunchBlocker(industry.slug, activeProductCount) ?? undefined;

  return <>
    <AdminHeading
      eyebrow={industry.active ? "Live industry" : "Industry offline"}
      title={industry.name}
      description="Manage only the products and matching catalogue for this industry. Other industries remain separate."
      actions={<Link className="button button-outline" href="/admin/categories"><ArrowLeft size={14}/>All industries</Link>}
    />
    <div className="management-grid">
      <section className="panel form-section">
        <div className="section-heading">
          <div><p className="eyebrow">{industry.children.length} products</p><h2>Products in this industry</h2></div>
          <span className={`status-pill ${industry.active ? "approved" : "suspended"}`}>{industry.active ? "INDUSTRY LIVE" : "INDUSTRY OFFLINE"}</span>
        </div>
        <div className="honesty-note">Turning the industry off stops all new WhatsApp intake and supplier matching for these products. Existing requests and supplier choices are retained safely.</div>
        <div className="entity-list spaced-section">
          {industry.children.length ? industry.children.map((product) => {
            const publicNow = industry.active && product.active;
            const lockedReason = product.slug === "fire-doors" && !product.active
              ? "Certification and product-data controls must be implemented before fire-door intake can be enabled."
              : undefined;
            return <article className="entity-row" key={product.id}>
              <span className="entity-icon"><Package2 size={18}/></span>
              <div>
                <b>{product.name}</b>
                <small>{product.description || "No description"}</small>
                <small>{product._count.suppliers} supplier selections · {product._count.quoteRequests} requests</small>
              </div>
              <span className={`status-pill ${publicNow ? "approved" : product.active ? "pending" : "suspended"}`}>{publicNow ? "LIVE" : product.active ? "READY" : "OFF"}</span>
              <CategoryStatusButton id={product.id} active={product.active} isGroup={false} lockedReason={lockedReason}/>
            </article>;
          }) : <div className="empty-state">No products have been added to this industry yet.</div>}
        </div>
      </section>
      <aside className="form-stack">
        <section className="panel form-section">
          <div className="section-heading"><div><p className="eyebrow">Industry availability</p><h2>Launch control</h2></div></div>
          <p className="body-copy">One switch controls whether this entire industry is available to suppliers and WhatsApp customers.</p>
          <div className={`industry-readiness ${experience.launchReady ? "is-ready" : ""}`}>
            <b>{experience.launchReady ? "Specialist experience ready" : "Specialist experience required"}</b>
            <small>{experience.supplierExperience}</small>
            <small>{experience.whatsappExperience}</small>
          </div>
          <CategoryStatusButton id={industry.id} active={industry.active} isGroup lockedReason={launchBlocker}/>
        </section>
        <ProductCreateForm parentId={industry.id} industryName={industry.name}/>
      </aside>
    </div>
  </>;
}
