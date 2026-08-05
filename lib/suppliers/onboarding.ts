export type SupplierOnboardingInput = {
  legalName: string;
  companyNumber: string | null;
  directorName: string | null;
  contactEmail: string;
  contactPhone: string;
  addressLine1: string | null;
  city: string | null;
  postcode: string | null;
  categories: Array<unknown>;
  coverageAreas: Array<{ active: boolean }>;
  memberships: Array<{ role: string; status: string }>;
};

export type SupplierOnboardingItem = {
  key: "COMPANY" | "ADDRESS" | "CONTACT" | "PRODUCTS" | "COVERAGE" | "OWNER";
  label: string;
  description: string;
  href: string;
  complete: boolean;
};

export type SupplierOnboardingReadiness = {
  ready: boolean;
  completed: number;
  total: number;
  percentage: number;
  items: SupplierOnboardingItem[];
  blockers: string[];
};

function hasText(value: string | null, minimum = 1) {
  return Boolean(value && value.trim().length >= minimum);
}

function readiness(items: SupplierOnboardingItem[]): SupplierOnboardingReadiness {
  const completed = items.filter((item) => item.complete).length;
  return {
    ready: completed === items.length,
    completed,
    total: items.length,
    percentage: Math.round((completed / items.length) * 100),
    items,
    blockers: items.filter((item) => !item.complete).map((item) => item.label),
  };
}

export function supplierApprovalReadiness(company: SupplierOnboardingInput): SupplierOnboardingReadiness {
  const items: SupplierOnboardingItem[] = [
    {
      key: "COMPANY",
      label: "Company identity",
      description: "Add the legal company name, Companies House number and director's name.",
      href: "/dashboard/company#company-details",
      complete: hasText(company.legalName, 2)
        && hasText(company.companyNumber, 2)
        && hasText(company.directorName, 2),
    },
    {
      key: "ADDRESS",
      label: "Company address",
      description: "Add the registered or principal company address and postcode.",
      href: "/dashboard/company#company-address",
      complete: hasText(company.addressLine1)
        && hasText(company.city)
        && hasText(company.postcode, 3),
    },
    {
      key: "CONTACT",
      label: "Company contact details",
      description: "Add the company phone number and business email address.",
      href: "/dashboard/company#company-details",
      complete: hasText(company.contactEmail, 3) && hasText(company.contactPhone, 7),
    },
  ];
  return readiness(items);
}

export function supplierOnboardingReadiness(company: SupplierOnboardingInput): SupplierOnboardingReadiness {
  const items: SupplierOnboardingItem[] = [
    ...supplierApprovalReadiness(company).items,
    {
      key: "PRODUCTS",
      label: "Product categories",
      description: "Choose at least one category that your company can quote for.",
      href: "/dashboard/company#product-categories",
      complete: company.categories.length > 0,
    },
    {
      key: "COVERAGE",
      label: "Coverage area",
      description: "Add at least one active postcode, distance or nationwide coverage area.",
      href: "/dashboard/coverage",
      complete: company.coverageAreas.some((area) => area.active),
    },
    {
      key: "OWNER",
      label: "Active account owner",
      description: "Every supplier workspace must retain an active owner.",
      href: "/dashboard/team",
      complete: company.memberships.some((membership) => membership.role === "OWNER" && membership.status === "ACTIVE"),
    },
  ];
  return readiness(items);
}
