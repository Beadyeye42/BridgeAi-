import { z } from "zod";

const email = z.string().trim().email("Enter a valid business email").max(254).transform((value) => value.toLowerCase());
const password = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(128, "Password is too long")
  .regex(/[a-z]/, "Add a lowercase letter")
  .regex(/[A-Z]/, "Add an uppercase letter")
  .regex(/[0-9]/, "Add a number");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password").max(128),
});

export const registerSchema = z.object({
  firstName: z.string().trim().min(2).max(60),
  lastName: z.string().trim().min(2).max(60),
  companyName: z.string().trim().min(2).max(160).optional(),
  email,
  phone: z.string().trim().min(7).max(32).optional(),
  password,
  invitationToken: z.string().min(32).max(256).optional(),
  referralCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,24}$/, "Enter a valid referral code").optional(),
  termsAccepted: z.literal(true, { error: "Accept the terms to continue" }),
}).superRefine((value, context) => {
  if (!value.invitationToken && !value.companyName) context.addIssue({ code: "custom", path: ["companyName"], message: "Enter your company name" });
  if (!value.invitationToken && !value.phone) context.addIssue({ code: "custom", path: ["phone"], message: "Enter a contact phone number" });
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  password,
});

export const affiliateCreateSchema = z.object({
  firstName: z.string().trim().min(2).max(60),
  lastName: z.string().trim().min(2).max(60),
  displayName: z.string().trim().min(2).max(120),
  email,
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,24}$/, "Use 4–24 letters or numbers"),
  activate: z.boolean().default(false),
});

export const affiliateStatusSchema = z.object({
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"]),
  reason: z.string().trim().max(500).optional(),
}).superRefine((value, context) => {
  if (value.status === "SUSPENDED" && !value.reason) context.addIssue({ code: "custom", path: ["reason"], message: "Enter a suspension reason" });
});

export const assignmentDecisionSchema = z.object({
  decision: z.enum(["accept", "decline"]),
  reason: z.string().trim().max(500).optional(),
});

const quotationValidUntil = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid quotation date"),
  z.date(),
]).optional().transform((value) => {
  if (!value) return undefined;
  return value instanceof Date ? value : new Date(`${value}T23:59:59.999Z`);
});

// Record identifiers are opaque application values. Opportunity claims use a
// `claim_...` identifier while records created directly by Prisma use CUIDs.
// Keep the boundary bounded and character-safe without coupling API validation
// to one particular ID generator.
export const recordIdSchema = z
  .string()
  .trim()
  .min(1, "Invalid record identifier")
  .max(64, "Invalid record identifier")
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid record identifier");

export const quotationSchema = z.object({
  assignmentId: recordIdSchema,
  price: z.coerce.number().positive().max(10_000_000),
  leadTimeDays: z.coerce.number().int().min(1).max(730),
  validUntil: quotationValidUntil,
  notes: z.string().trim().max(5000).optional(),
});

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((value) => value || null);

export const companyProfileSchema = z.object({
  legalName: z.string().trim().min(2).max(160),
  companyNumber: z.string().trim().min(2, "Enter the Companies House number").max(32).transform((value) => value.toUpperCase()),
  directorName: z.string().trim().min(2, "Enter a director's name").max(160),
  contactEmail: email,
  contactPhone: z.string().trim().min(7).max(32),
  addressLine1: z.string().trim().min(2, "Enter the company address").max(160),
  addressLine2: optionalText(160),
  city: z.string().trim().min(2, "Enter the town or city").max(100),
  county: optionalText(100),
  postcode: z.string().trim().min(3, "Enter the company postcode").max(16).transform((value) => value.toUpperCase()),
  categoryIds: z.array(z.string().cuid().or(z.string().max(64))).max(100).refine((ids) => new Set(ids).size === ids.length, "Select each category only once"),
});

const capabilityNameList = z.array(z.string().trim().min(1).max(100)).max(50)
  .transform((values) => [...new Set(values.map((value) => value.replace(/\s+/g, " ")))]);

export const supplierCapabilitySchema = z.object({
  productCategoryId: z.string().min(1).max(64),
  manufacturerNames: capabilityNameList,
  systemNames: capabilityNameList,
  colourNames: capabilityNameList,
  finishNames: capabilityNameList,
  minimumOrderValue: z.number().nonnegative().max(10_000_000).nullable(),
  minimumOrderQuantity: z.number().int().min(1).max(1_000_000).nullable(),
  standardLeadTimeDays: z.number().int().min(1).max(730),
  urgentLeadTimeDays: z.number().int().min(1).max(730).nullable(),
  currentLeadTimeDays: z.number().int().min(1).max(730).nullable(),
  supportsSupplyOnly: z.boolean(),
  supportsDelivery: z.boolean(),
  supportsInstallation: z.boolean(),
  supportsService: z.boolean(),
  servesConsumer: z.boolean(),
  servesTrade: z.boolean(),
  servesBusiness: z.boolean(),
  collectionAvailable: z.boolean(),
  deliveryDays: z.array(z.number().int().min(1).max(7)).max(7).transform((days) => [...new Set(days)].sort()),
  capacityStatus: z.enum(["AVAILABLE", "LIMITED", "URGENT_ONLY", "FULL", "PAUSED", "HOLIDAY", "NOT_ACCEPTING"]),
  restrictedProducts: capabilityNameList,
  deliveryDelayDays: z.number().int().min(0).max(365).nullable(),
  shortageNote: z.string().trim().max(500).nullable(),
  shortageUntil: z.string().datetime().nullable(),
  active: z.boolean(),
}).superRefine((value, context) => {
  if (!value.servesConsumer && !value.servesTrade && !value.servesBusiness) {
    context.addIssue({ code: "custom", path: ["servesConsumer"], message: "Choose at least one buyer type" });
  }
  if (value.urgentLeadTimeDays !== null && value.urgentLeadTimeDays > value.standardLeadTimeDays) {
    context.addIssue({ code: "custom", path: ["urgentLeadTimeDays"], message: "Urgent lead time must not exceed the standard lead time" });
  }
  if (value.shortageNote && !value.shortageUntil) {
    context.addIssue({ code: "custom", path: ["shortageUntil"], message: "Add an end date for the temporary shortage" });
  }
});

export const supplierCapabilitiesSchema = z.object({
  capabilities: z.array(supplierCapabilitySchema).max(100).refine(
    (items) => new Set(items.map((item) => item.productCategoryId)).size === items.length,
    "Save only one capability record for each product category",
  ),
});

export const supplierCapabilityActivationSchema = z.object({
  productCategoryId: z.string().min(1).max(64),
});

const optionalCoverageLabel = z.string().trim().min(2).max(100).optional();
const coveragePurpose = z.enum(["SERVICE", "DELIVERY"]).default("DELIVERY");
export const coverageAreaSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("POSTCODE"), purpose: coveragePurpose, label: optionalCoverageLabel, postcodePrefix: z.string().trim().min(1).max(8).regex(/^[A-Za-z][A-Za-z0-9 ]{0,7}$/, "Enter a UK postcode or postcode area, such as GL52 6TD, B or CV").transform((v) => v.toUpperCase()) }),
  z.object({ type: z.literal("DISTANCE"), purpose: coveragePurpose, label: optionalCoverageLabel, centrePostcode: z.string().trim().min(3).max(16).transform((v) => v.toUpperCase()), radiusMiles: z.coerce.number().int().min(1).max(500) }),
  z.object({ type: z.literal("NATIONWIDE"), purpose: coveragePurpose, label: optionalCoverageLabel }),
]);

export const collectionLocationSchema = z.object({
  label: z.string().trim().min(2).max(100),
  postcode: z.string().trim().min(3).max(16).transform((value) => value.toUpperCase()),
  collectionDays: z.array(z.number().int().min(1).max(7)).max(7).transform((days) => [...new Set(days)].sort()),
  noticeRequired: z.boolean(),
  noticeHours: z.coerce.number().int().min(1).max(720).nullable(),
}).superRefine((value, context) => {
  if (value.noticeRequired && value.noticeHours === null) context.addIssue({ code: "custom", path: ["noticeHours"], message: "Enter the collection notice required" });
  if (!value.noticeRequired && value.noticeHours !== null) context.addIssue({ code: "custom", path: ["noticeHours"], message: "Turn on notice required before setting hours" });
});

export const membershipCheckoutSchema = z.object({ membershipPlanId: z.string().min(1).max(64) });

export const membershipPlanAdminSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).nullable(),
  monthlyPricePence: z.coerce.number().int().min(100).max(1_000_000),
  maximumRadiusMiles: z.coerce.number().int().min(1).max(500).nullable(),
  nationwideAllowed: z.boolean(),
  maximumActiveOpportunities: z.coerce.number().int().min(1).max(100),
  taxEnabled: z.boolean(),
  active: z.boolean(),
});

export const matchingConfigurationAdminSchema = z.object({
  maximumSuppliersPerRequest: z.coerce.number().int().min(1).max(3),
  capacityStaleDays: z.coerce.number().int().min(1).max(90),
  leadTimeStaleDays: z.coerce.number().int().min(1).max(90),
  responseDeadlineHours: z.coerce.number().int().min(1).max(168),
  automaticNextSupplierInvitation: z.boolean(),
  serviceMatchingEnabled: z.boolean(),
  deliveryMatchingEnabled: z.boolean(),
  matchingWeights: z.object({
    capability: z.coerce.number().min(0).max(100),
    leadTime: z.coerce.number().min(0).max(100),
    capacity: z.coerce.number().min(0).max(100),
    coverage: z.coerce.number().min(0).max(100),
    locality: z.coerce.number().min(0).max(100),
    response: z.coerce.number().min(0).max(100),
    completion: z.coerce.number().min(0).max(100),
    reliability: z.coerce.number().min(0).max(100),
  }).refine((weights) => Object.values(weights).some((weight) => weight > 0), "At least one matching weight must be greater than zero"),
});

export const adminSupplierGeographySchema = z.object({
  membershipTierOverride: z.enum(["LOCAL", "REGIONAL", "NATIONWIDE"]).nullable(),
  maximumActiveOpportunitiesOverride: z.coerce.number().int().min(1).max(100).nullable(),
  maximumServiceRadiusOverride: z.coerce.number().int().min(1).max(500).nullable(),
  maximumDeliveryRadiusOverride: z.coerce.number().int().min(1).max(500).nullable(),
});

export const membershipPromotionAdminSchema = z.object({
  name: z.string().trim().min(2).max(120),
  eligiblePlanCodes: z.array(z.string().trim().min(1).max(100)).min(1).max(3),
  promotionalPricePence: z.coerce.number().int().min(100).max(1_000_000),
  durationMonths: z.coerce.number().int().min(1).max(36),
  subscriberLimit: z.coerce.number().int().min(1).max(100_000).nullable(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullable(),
  existingSubscribersQualify: z.boolean(),
  active: z.boolean(),
}).superRefine((value, context) => {
  if (value.endsAt && value.endsAt <= value.startsAt) context.addIssue({ code: "custom", path: ["endsAt"], message: "Promotion end must be after its start" });
});

export const notificationPreferenceSchema = z.object({
  emailNewRequests: z.boolean(), emailRequestReminders: z.boolean(), emailQuotationUpdates: z.boolean(),
  smsUrgentRequests: z.boolean(), inAppEnabled: z.boolean(),
  quietHoursStart: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/).nullable(),
  quietHoursEnd: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/).nullable(),
}).superRefine((value, context) => {
  if (Boolean(value.quietHoursStart) !== Boolean(value.quietHoursEnd)) {
    context.addIssue({ code: "custom", path: ["quietHoursEnd"], message: "Set both quiet-hour times or leave both empty" });
  }
});

export const teamInviteSchema = z.object({ email, role: z.enum(["MANAGER", "MEMBER"]) });
export const adminSupplierStatusSchema = z.object({ status: z.enum(["APPROVED", "SUSPENDED", "REJECTED"]), note: z.string().trim().max(1000).optional() });
export const adminComplimentaryMembershipSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("GRANT"),
    durationDays: z.coerce.number().int().min(1, "Choose at least one day").max(366, "Complimentary access cannot exceed 366 days"),
    reason: z.string().trim().min(3, "Enter a promotional or testing reason").max(500),
    membershipPlanId: z.string().min(1).max(64),
  }),
  z.object({
    action: z.literal("REVOKE"),
    reason: z.string().trim().min(3, "Enter a revocation reason").max(500),
  }),
]);
export const adminSupplierEditSchema = z.object({
  legalName: z.string().trim().min(2).max(160),
  companyNumber: z.string().trim().min(2).max(32).transform((value) => value.toUpperCase()),
  directorName: z.string().trim().min(2).max(160),
  contactEmail: email,
  contactPhone: z.string().trim().min(7).max(32),
  addressLine1: z.string().trim().min(2).max(160),
  addressLine2: optionalText(160),
  city: z.string().trim().min(2).max(100),
  county: optionalText(100),
  postcode: z.string().trim().min(3).max(16).transform((value) => value.toUpperCase()),
});
export const adminAssignmentSchema = z.object({
  quoteRequestId: z.string().min(1).max(64),
  supplierCompanyIds: z.array(z.string().min(1).max(64)).min(1).max(3),
});
export const productCategorySchema = z.object({ name: z.string().trim().min(2).max(100), slug: z.string().trim().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(), description: optionalText(500), active: z.boolean().default(true), parentId: z.string().nullable().optional() });

const optionalDate = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")]).transform((value) => value || null);

export const accreditationUploadSchema = z.object({
  type: z.enum([
    "PUBLIC_LIABILITY_INSURANCE",
    "EMPLOYERS_LIABILITY_INSURANCE",
    "PROFESSIONAL_INDEMNITY_INSURANCE",
    "TRADE_BODY_MEMBERSHIP",
    "CERTIFICATION",
    "OTHER",
  ]),
  displayName: z.string().trim().min(2).max(160),
  referenceNumber: optionalText(120),
  issuingBody: optionalText(160),
  issuedAt: optionalDate,
  expiresAt: optionalDate,
}).superRefine((value, context) => {
  if (value.issuedAt && value.expiresAt && value.expiresAt < value.issuedAt) {
    context.addIssue({ code: "custom", path: ["expiresAt"], message: "Expiry date must be after the issue date" });
  }
});

export const accreditationReviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(1000).optional(),
}).superRefine((value, context) => {
  if (value.status === "REJECTED" && !value.note) {
    context.addIssue({ code: "custom", path: ["note"], message: "Provide a reason for rejection" });
  }
});

export function validationError(error: z.ZodError) {
  return error.issues[0]?.message ?? "Check the information and try again";
}
