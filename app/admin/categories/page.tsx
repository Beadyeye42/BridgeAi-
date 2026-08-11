import Link from "next/link";
import { ArrowRight, Layers3 } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/auth/guards";
import { AdminHeading } from "@/components/admin/admin-shell";
import { CategoryStatusButton, IndustryAudienceControl, IndustryCreateForm } from "@/components/admin/admin-actions";
import { industryExperience, industryLaunchBlocker } from "@/lib/categories/industry-registry";

export default async function CategoriesPage() {
  await requireAdminPage();
  const industries = await prisma.productCategory.findMany({
    where: { parentId: null, adminVisible: true },
    include: {
      children: {
        select: {
          id: true,
          active: true,
          _count: { select: { suppliers: true, quoteRequests: true } },
        },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      },
    },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });

  return <>
    <AdminHeading
      eyebrow={`${industries.length} industries`}
      title="Industries"
      description="Launch or pause a whole industry here. Products and industry-specific settings stay inside their own workspace."
    />
    <section className="industry-admin-grid" aria-label="Industry launch controls">
      {industries.map((industry) => {
        const enabledProducts = industry.children.filter((product) => product.active).length;
        const supplierSelections = industry.children.reduce((total, product) => total + product._count.suppliers, 0);
        const requests = industry.children.reduce((total, product) => total + product._count.quoteRequests, 0);
        const experience = industryExperience(industry.slug);
        const launchBlocker = industry.active ? undefined : industryLaunchBlocker(industry.slug, enabledProducts) ?? undefined;
        return <article className={`panel industry-admin-card${industry.active ? " is-live" : ""}`} key={industry.id}>
          <div className="industry-card-top">
            <span className="large-icon"><Layers3 size={20}/></span>
            <span className={`status-pill ${industry.active ? "approved" : "suspended"}`}>{industry.active ? "LIVE" : "OFFLINE"}</span>
          </div>
          <div className="industry-card-copy">
            <p className="eyebrow">Industry</p>
            <h2>{industry.name}</h2>
            <p>{industry.description || "No public description added yet."}</p>
          </div>
          <dl className="industry-card-stats">
            <div><dt>Products ready</dt><dd>{enabledProducts} of {industry.children.length}</dd></div>
            <div><dt>Supplier selections</dt><dd>{supplierSelections}</dd></div>
            <div><dt>Requests</dt><dd>{requests}</dd></div>
          </dl>
          <div className={`industry-readiness ${experience.launchReady ? "is-ready" : ""}`}>
            <b>{experience.launchReady ? "Specialist experience ready" : "Specialist experience required"}</b>
            <small>{experience.supplierExperience}</small>
            <small>{experience.whatsappExperience}</small>
          </div>
          <IndustryAudienceControl id={industry.id} servesConsumer={industry.servesConsumer} servesTrade={industry.servesTrade} servesBusiness={industry.servesBusiness}/>
          <div className="industry-card-actions">
            <CategoryStatusButton id={industry.id} active={industry.active} isGroup lockedReason={launchBlocker}/>
            <Link className="button button-outline" href={`/admin/categories/${industry.id}`}>Manage industry <ArrowRight size={14}/></Link>
          </div>
        </article>;
      })}
    </section>
    <IndustryCreateForm />
  </>;
}
