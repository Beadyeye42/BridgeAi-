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
  termsAccepted: z.literal(true, { error: "Accept the terms to continue" }),
}).superRefine((value, context) => {
  if (!value.invitationToken && !value.companyName) context.addIssue({ code: "custom", path: ["companyName"], message: "Enter your company name" });
  if (!value.invitationToken && !value.phone) context.addIssue({ code: "custom", path: ["phone"], message: "Enter a contact phone number" });
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  password,
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

export const quotationSchema = z.object({
  assignmentId: z.string().cuid(),
  price: z.coerce.number().positive().max(10_000_000),
  leadTimeDays: z.coerce.number().int().min(1).max(730),
  validUntil: quotationValidUntil,
  notes: z.string().trim().max(5000).optional(),
});

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((value) => value || null);

export const companyProfileSchema = z.object({
  legalName: z.string().trim().min(2).max(160),
  tradingName: optionalText(160),
  companyNumber: optionalText(32),
  vatNumber: optionalText(32),
  websiteUrl: z.union([z.literal(""), z.string().trim().url().max(300)]).transform((value) => value || null),
  summary: optionalText(1500),
  contactEmail: email,
  contactPhone: z.string().trim().min(7).max(32),
  addressLine1: optionalText(160),
  addressLine2: optionalText(160),
  city: optionalText(100),
  county: optionalText(100),
  postcode: optionalText(16),
  categoryIds: z.array(z.string().cuid().or(z.string().max(64))).max(100).refine((ids) => new Set(ids).size === ids.length, "Select each category only once"),
  businessHours: z.record(z.string(), z.tuple([z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/), z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)]).nullable()),
});

const optionalCoverageLabel = z.string().trim().min(2).max(100).optional();
export const coverageAreaSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("POSTCODE"), label: optionalCoverageLabel, postcodePrefix: z.string().trim().min(1).max(8).regex(/^[A-Za-z][A-Za-z0-9 ]{0,7}$/, "Enter a UK postcode or postcode area, such as GL52 6TD, B or CV").transform((v) => v.toUpperCase()) }),
  z.object({ type: z.literal("DISTANCE"), label: optionalCoverageLabel, centrePostcode: z.string().trim().min(3).max(16).transform((v) => v.toUpperCase()), radiusMiles: z.coerce.number().int().min(1).max(500) }),
  z.object({ type: z.literal("NATIONWIDE"), label: optionalCoverageLabel }),
]);

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
export const adminSupplierEditSchema = z.object({
  legalName: z.string().trim().min(2).max(160), tradingName: optionalText(160), contactEmail: email,
  contactPhone: z.string().trim().min(7).max(32), companyNumber: optionalText(32), vatNumber: optionalText(32),
  postcode: optionalText(16), summary: optionalText(1500),
});
export const adminAssignmentSchema = z.object({
  quoteRequestId: z.string().min(1).max(64),
  supplierCompanyIds: z.array(z.string().min(1).max(64)).min(1).max(5),
});
export const productCategorySchema = z.object({ name: z.string().trim().min(2).max(100), slug: z.string().trim().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), description: optionalText(500), active: z.boolean().default(true), parentId: z.string().nullable().optional() });

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
