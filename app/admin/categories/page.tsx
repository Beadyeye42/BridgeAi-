import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/auth/guards";
import { AdminHeading } from "@/components/admin/admin-shell";
import { CategoryCreateForm, CategoryStatusButton } from "@/components/admin/admin-actions";

export default async function CategoriesPage() {
  await requireAdminPage();
  const categories = await prisma.productCategory.findMany({
    include: {
      parent: { select: { name: true, active: true } },
      _count: { select: { suppliers: true, quoteRequests: true } },
    },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
  const parents = categories
    .filter((category) => category.parentId === null)
    .map(({ id, name }) => ({ id, name }));

  return <>
    <AdminHeading
      eyebrow="Matching taxonomy"
      title="Product categories"
      description="Prepare future catalogues privately, then launch each group when its supplier network and controls are ready."
    />
    <div className="management-grid">
      <section className="panel form-section">
        <div className="section-heading"><div><p className="eyebrow">{categories.length} categories</p><h2>Catalogue launch control</h2></div></div>
        <div className="honesty-note">Launching a top-level group makes its enabled products available in supplier profiles and WhatsApp intake. Taking it offline stops new intake without deleting supplier choices or existing requests.</div>
        <div className="entity-list">{categories.map((category) => {
          const isGroup = category.parentId === null;
          const publicNow = category.active && (isGroup || category.parent?.active === true);
          const status = isGroup
            ? category.active ? "PUBLIC" : "NOT LAUNCHED"
            : !category.active ? "DISABLED" : publicNow ? "PUBLIC" : "READY — GROUP OFF";
          const lockedReason = category.slug === "fire-doors" && !category.active
            ? "Certification and product-data controls must be implemented before fire-door intake can be enabled."
            : undefined;
          return <article className="entity-row" key={category.id}>
            <div>
              <b>{category.parent ? `${category.parent.name} · ` : "Product group · "}{category.name}</b>
              <small>{category.description || "No description"} · {category._count.suppliers} suppliers · {category._count.quoteRequests} requests</small>
            </div>
            <span className={`status-pill ${publicNow ? "approved" : category.active ? "pending" : "suspended"}`}>{status}</span>
            <CategoryStatusButton id={category.id} active={category.active} isGroup={isGroup} lockedReason={lockedReason}/>
          </article>;
        })}</div>
      </section>
      <CategoryCreateForm parents={parents}/>
    </div>
  </>;
}
