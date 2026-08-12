import { BRAND_NAME, LEGAL_OWNER_NAME } from "@/lib/brand";

export const LEGAL_EFFECTIVE_DATE = "10 August 2026";

export const BRIDGE_AI_COMPANY = {
  name: LEGAL_OWNER_NAME,
  companyNumber: "16757150",
  registeredOffice: "60 Suffolk Road, Cheltenham, England, GL50 2AQ",
  jurisdiction: "England and Wales",
  contactEmail: "ironbridgegroup@outlook.com",
  serviceName: BRAND_NAME,
} as const;
