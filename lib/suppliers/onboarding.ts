export type SupplierOnboardingInput = {
  legalName: string;
  contactEmail: string;
  contactPhone: string;
  addressLine1: string | null;
  city: string | null;
  postcode: string | null;
  summary: string | null;
  businessHours: unknown;
  categories: Array<unknown>;
  coverageAreas: Array<{ active: boolean }>;
  memberships: Array<{ role: string; status: string }>;
  accreditations: Array<{
    status: string;
    expiresAt: Date | null;
    attachment: { scanStatus: string };
  }>;
};

export type SupplierOnboardingItem = {
  key: "PROFILE" | "PRODUCTS" | "COVERAGE" | "HOURS" | "OWNER" | "ACCREDITATION";
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

function hasOpenBusinessDay(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).some((hours) => Array.isArray(hours)
    && hours.length === 2
    && hours.every((part) => typeof part === "string" && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(part)));
}

export function supplierOnboardingReadiness(company: SupplierOnboardingInput, now = new Date()): SupplierOnboardingReadiness {
  const items: SupplierOnboardingItem[] = [
    {
      key: "PROFILE",
      label: "Company and contact details",
      description: "Add your trading address, postcode and a clear company summary.",
      href: "/dashboard/company#company-details",
      complete: hasText(company.legalName, 2)
        && hasText(company.contactEmail, 3)
        && hasText(company.contactPhone, 7)
        && hasText(company.addressLine1)
        && hasText(company.city)
        && hasText(company.postcode, 3)
        && hasText(company.summary, 20),
    },
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
      key: "HOURS",
      label: "Business hours",
      description: "Set at least one working day so request deadlines are clear.",
      href: "/dashboard/company#business-hours",
      complete: hasOpenBusinessDay(company.businessHours),
    },
    {
      key: "OWNER",
      label: "Active account owner",
      description: "Every supplier workspace must retain an active owner.",
      href: "/dashboard/team",
      complete: company.memberships.some((membership) => membership.role === "OWNER" && membership.status === "ACTIVE"),
    },
    {
      key: "ACCREDITATION",
      label: "Approved accreditation or insurance",
      description: "Upload current evidence and wait for Bridge AI approval.",
      href: "/dashboard/company#accreditations",
      complete: company.accreditations.some((item) => item.status === "APPROVED"
        && item.attachment.scanStatus === "CLEAN"
        && (!item.expiresAt || item.expiresAt > now)),
    },
  ];
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
