-- Bridge AI security-foundation replacement.
-- The bridge_ai schema was verified empty before this migration; legacy public data is retained and quarantined.
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;
DROP SCHEMA IF EXISTS bridge_ai CASCADE;
DROP SCHEMA IF EXISTS bridge_private CASCADE;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "bridge_ai";

-- CreateEnum
CREATE TYPE "bridge_ai"."AccountStatus" AS ENUM ('ACTIVE', 'INVITED', 'LOCKED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "bridge_ai"."SupplierStatus" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "bridge_ai"."SupplierTeamRole" AS ENUM ('OWNER', 'MANAGER', 'MEMBER');

-- CreateEnum
CREATE TYPE "bridge_ai"."MembershipStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "bridge_ai"."ConversationChannel" AS ENUM ('WHATSAPP');

-- CreateEnum
CREATE TYPE "bridge_ai"."MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "bridge_ai"."MessageType" AS ENUM ('TEXT', 'IMAGE', 'DOCUMENT', 'AUDIO', 'LOCATION', 'INTERACTIVE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "bridge_ai"."MessageStatus" AS ENUM ('RECEIVED', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "bridge_ai"."AttachmentKind" AS ENUM ('CUSTOMER_FILE', 'DRAWING', 'PHOTO', 'SUPPLIER_LOGO', 'QUOTATION_PDF', 'OTHER');

-- CreateEnum
CREATE TYPE "bridge_ai"."ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "bridge_ai"."QuoteRequestStatus" AS ENUM ('DRAFT', 'OPEN', 'MATCHING', 'QUOTED', 'WON', 'LOST', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "bridge_ai"."AssignmentStatus" AS ENUM ('PENDING', 'VIEWED', 'ACCEPTED', 'DECLINED', 'QUOTED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "bridge_ai"."QuotationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "bridge_ai"."CoverageType" AS ENUM ('POSTCODE', 'DISTANCE');

-- CreateEnum
CREATE TYPE "bridge_ai"."SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "bridge_ai"."NotificationType" AS ENUM ('NEW_QUOTE_REQUEST', 'REQUEST_EXPIRING', 'QUOTATION_ACCEPTED', 'QUOTATION_REJECTED', 'TEAM_INVITATION', 'ACCOUNT_UPDATE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "bridge_ai"."NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "bridge_ai"."SystemEventSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "bridge_ai"."SystemEventStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateTable
CREATE TABLE "bridge_ai"."portal_profiles" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "status" "bridge_ai"."AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "lastLoginAt" TIMESTAMPTZ(3),
    "termsAcceptedAt" TIMESTAMPTZ(3),
    "termsVersion" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "portal_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."platform_administrators" (
    "userId" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_administrators_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "bridge_ai"."permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."administrator_permissions" (
    "userId" UUID NOT NULL,
    "permissionId" TEXT NOT NULL,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "administrator_permissions_pkey" PRIMARY KEY ("userId","permissionId")
);

-- CreateTable
CREATE TABLE "bridge_ai"."supplier_companies" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradingName" TEXT,
    "companyNumber" TEXT,
    "vatNumber" TEXT,
    "websiteUrl" TEXT,
    "logoUrl" TEXT,
    "summary" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "county" TEXT,
    "postcode" TEXT,
    "businessHours" JSONB,
    "status" "bridge_ai"."SupplierStatus" NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMPTZ(3),
    "approvedById" UUID,
    "suspendedAt" TIMESTAMPTZ(3),
    "suspensionNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."company_memberships" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "supplierCompanyId" TEXT NOT NULL,
    "role" "bridge_ai"."SupplierTeamRole" NOT NULL DEFAULT 'MEMBER',
    "status" "bridge_ai"."MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."SupplierInvite" (
    "id" TEXT NOT NULL,
    "supplierCompanyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "bridge_ai"."SupplierTeamRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "invitedById" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."CustomerContact" (
    "id" TEXT NOT NULL,
    "displayName" TEXT,
    "phoneEncrypted" BYTEA NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "emailEncrypted" BYTEA,
    "emailHash" TEXT,
    "consentRecordedAt" TIMESTAMPTZ(3),
    "marketingConsentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CustomerContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."Conversation" (
    "id" TEXT NOT NULL,
    "customerContactId" TEXT NOT NULL,
    "channel" "bridge_ai"."ConversationChannel" NOT NULL DEFAULT 'WHATSAPP',
    "externalConversationId" TEXT,
    "lastMessageAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "direction" "bridge_ai"."MessageDirection" NOT NULL,
    "messageType" "bridge_ai"."MessageType" NOT NULL,
    "bodyEncrypted" BYTEA,
    "status" "bridge_ai"."MessageStatus" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "deliveredAt" TIMESTAMPTZ(3),
    "readAt" TIMESTAMPTZ(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."Attachment" (
    "id" TEXT NOT NULL,
    "kind" "bridge_ai"."AttachmentKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "scanStatus" "bridge_ai"."ScanStatus" NOT NULL DEFAULT 'PENDING',
    "whatsappMessageId" TEXT,
    "quoteRequestId" TEXT,
    "quotationId" TEXT,
    "supplierCompanyId" TEXT,
    "uploadedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."ProductCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "parentId" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."SupplierProductCategory" (
    "supplierCompanyId" TEXT NOT NULL,
    "productCategoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierProductCategory_pkey" PRIMARY KEY ("supplierCompanyId","productCategoryId")
);

-- CreateTable
CREATE TABLE "bridge_ai"."QuoteRequest" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "conversationId" TEXT,
    "customerContactId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "deliveryPostcode" TEXT NOT NULL,
    "deliveryLatitude" DECIMAL(9,6),
    "deliveryLongitude" DECIMAL(9,6),
    "customerBudget" DECIMAL(12,2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'GBP',
    "status" "bridge_ai"."QuoteRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "distributionLimit" INTEGER NOT NULL DEFAULT 3,
    "responseDueAt" TIMESTAMPTZ(3) NOT NULL,
    "publishedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "QuoteRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."QuoteRequestItem" (
    "id" TEXT NOT NULL,
    "quoteRequestId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "specification" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."SupplierAssignment" (
    "id" TEXT NOT NULL,
    "quoteRequestId" TEXT NOT NULL,
    "supplierCompanyId" TEXT NOT NULL,
    "status" "bridge_ai"."AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewedAt" TIMESTAMPTZ(3),
    "respondedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "declinedReason" TEXT,
    "assignedById" UUID,

    CONSTRAINT "SupplierAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."SupplierQuotation" (
    "id" TEXT NOT NULL,
    "quoteRequestId" TEXT NOT NULL,
    "supplierCompanyId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "status" "bridge_ai"."QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "price" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'GBP',
    "leadTimeDays" INTEGER NOT NULL,
    "validUntil" TIMESTAMPTZ(3),
    "notes" TEXT,
    "submittedAt" TIMESTAMPTZ(3),
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SupplierQuotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."CoverageArea" (
    "id" TEXT NOT NULL,
    "supplierCompanyId" TEXT NOT NULL,
    "type" "bridge_ai"."CoverageType" NOT NULL,
    "label" TEXT NOT NULL,
    "postcodePrefix" TEXT,
    "centrePostcode" TEXT,
    "radiusMiles" INTEGER,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CoverageArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."Subscription" (
    "id" TEXT NOT NULL,
    "supplierCompanyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "providerCustomerId" TEXT,
    "providerSubscriptionId" TEXT,
    "planCode" TEXT NOT NULL,
    "status" "bridge_ai"."SubscriptionStatus" NOT NULL,
    "currentPeriodStart" TIMESTAMPTZ(3),
    "currentPeriodEnd" TIMESTAMPTZ(3),
    "trialEndsAt" TIMESTAMPTZ(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "supplierCompanyId" TEXT NOT NULL,
    "emailNewRequests" BOOLEAN NOT NULL DEFAULT true,
    "emailRequestReminders" BOOLEAN NOT NULL DEFAULT true,
    "emailQuotationUpdates" BOOLEAN NOT NULL DEFAULT true,
    "smsUrgentRequests" BOOLEAN NOT NULL DEFAULT false,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "quietHoursStart" TEXT,
    "quietHoursEnd" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."Notification" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "supplierCompanyId" TEXT,
    "type" "bridge_ai"."NotificationType" NOT NULL,
    "channel" "bridge_ai"."NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actionUrl" TEXT,
    "readAt" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" UUID,
    "supplierCompanyId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "failureReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."SystemEvent" (
    "id" TEXT NOT NULL,
    "severity" "bridge_ai"."SystemEventSeverity" NOT NULL,
    "status" "bridge_ai"."SystemEventStatus" NOT NULL DEFAULT 'OPEN',
    "source" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedById" UUID,

    CONSTRAINT "SystemEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portal_profiles_email_key" ON "bridge_ai"."portal_profiles"("email");

-- CreateIndex
CREATE INDEX "portal_profiles_status_idx" ON "bridge_ai"."portal_profiles"("status");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "bridge_ai"."permissions"("code");

-- CreateIndex
CREATE INDEX "supplier_companies_status_idx" ON "bridge_ai"."supplier_companies"("status");

-- CreateIndex
CREATE INDEX "supplier_companies_postcode_idx" ON "bridge_ai"."supplier_companies"("postcode");

-- CreateIndex
CREATE INDEX "supplier_companies_approvedById_idx" ON "bridge_ai"."supplier_companies"("approvedById");

-- CreateIndex
CREATE INDEX "company_memberships_supplierCompanyId_role_idx" ON "bridge_ai"."company_memberships"("supplierCompanyId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "company_memberships_userId_supplierCompanyId_key" ON "bridge_ai"."company_memberships"("userId", "supplierCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvite_tokenHash_key" ON "bridge_ai"."SupplierInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "SupplierInvite_email_expiresAt_idx" ON "bridge_ai"."SupplierInvite"("email", "expiresAt");

-- CreateIndex
CREATE INDEX "SupplierInvite_invitedById_idx" ON "bridge_ai"."SupplierInvite"("invitedById");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvite_supplierCompanyId_email_key" ON "bridge_ai"."SupplierInvite"("supplierCompanyId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerContact_phoneHash_key" ON "bridge_ai"."CustomerContact"("phoneHash");

-- CreateIndex
CREATE INDEX "CustomerContact_emailHash_idx" ON "bridge_ai"."CustomerContact"("emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_externalConversationId_key" ON "bridge_ai"."Conversation"("externalConversationId");

-- CreateIndex
CREATE INDEX "Conversation_customerContactId_lastMessageAt_idx" ON "bridge_ai"."Conversation"("customerContactId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_externalMessageId_key" ON "bridge_ai"."WhatsAppMessage"("externalMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_conversationId_occurredAt_idx" ON "bridge_ai"."WhatsAppMessage"("conversationId", "occurredAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_status_idx" ON "bridge_ai"."WhatsAppMessage"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "bridge_ai"."Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_quoteRequestId_idx" ON "bridge_ai"."Attachment"("quoteRequestId");

-- CreateIndex
CREATE INDEX "Attachment_quotationId_idx" ON "bridge_ai"."Attachment"("quotationId");

-- CreateIndex
CREATE INDEX "Attachment_scanStatus_idx" ON "bridge_ai"."Attachment"("scanStatus");

-- CreateIndex
CREATE INDEX "Attachment_uploadedById_idx" ON "bridge_ai"."Attachment"("uploadedById");

-- CreateIndex
CREATE INDEX "Attachment_supplierCompanyId_idx" ON "bridge_ai"."Attachment"("supplierCompanyId");

-- CreateIndex
CREATE INDEX "Attachment_whatsappMessageId_idx" ON "bridge_ai"."Attachment"("whatsappMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_slug_key" ON "bridge_ai"."ProductCategory"("slug");

-- CreateIndex
CREATE INDEX "ProductCategory_active_displayOrder_idx" ON "bridge_ai"."ProductCategory"("active", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_parentId_name_key" ON "bridge_ai"."ProductCategory"("parentId", "name");

-- CreateIndex
CREATE INDEX "SupplierProductCategory_productCategoryId_idx" ON "bridge_ai"."SupplierProductCategory"("productCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRequest_reference_key" ON "bridge_ai"."QuoteRequest"("reference");

-- CreateIndex
CREATE INDEX "QuoteRequest_status_responseDueAt_idx" ON "bridge_ai"."QuoteRequest"("status", "responseDueAt");

-- CreateIndex
CREATE INDEX "QuoteRequest_categoryId_deliveryPostcode_idx" ON "bridge_ai"."QuoteRequest"("categoryId", "deliveryPostcode");

-- CreateIndex
CREATE INDEX "QuoteRequest_customerContactId_idx" ON "bridge_ai"."QuoteRequest"("customerContactId");

-- CreateIndex
CREATE INDEX "QuoteRequest_conversationId_idx" ON "bridge_ai"."QuoteRequest"("conversationId");

-- CreateIndex
CREATE INDEX "QuoteRequestItem_quoteRequestId_displayOrder_idx" ON "bridge_ai"."QuoteRequestItem"("quoteRequestId", "displayOrder");

-- CreateIndex
CREATE INDEX "SupplierAssignment_supplierCompanyId_status_assignedAt_idx" ON "bridge_ai"."SupplierAssignment"("supplierCompanyId", "status", "assignedAt");

-- CreateIndex
CREATE INDEX "SupplierAssignment_quoteRequestId_status_idx" ON "bridge_ai"."SupplierAssignment"("quoteRequestId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierAssignment_quoteRequestId_supplierCompanyId_key" ON "bridge_ai"."SupplierAssignment"("quoteRequestId", "supplierCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierQuotation_assignmentId_key" ON "bridge_ai"."SupplierQuotation"("assignmentId");

-- CreateIndex
CREATE INDEX "SupplierQuotation_supplierCompanyId_status_submittedAt_idx" ON "bridge_ai"."SupplierQuotation"("supplierCompanyId", "status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierQuotation_quoteRequestId_supplierCompanyId_key" ON "bridge_ai"."SupplierQuotation"("quoteRequestId", "supplierCompanyId");

-- CreateIndex
CREATE INDEX "CoverageArea_supplierCompanyId_active_idx" ON "bridge_ai"."CoverageArea"("supplierCompanyId", "active");

-- CreateIndex
CREATE INDEX "CoverageArea_postcodePrefix_idx" ON "bridge_ai"."CoverageArea"("postcodePrefix");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_supplierCompanyId_key" ON "bridge_ai"."Subscription"("supplierCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_providerCustomerId_key" ON "bridge_ai"."Subscription"("providerCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_providerSubscriptionId_key" ON "bridge_ai"."Subscription"("providerSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_status_currentPeriodEnd_idx" ON "bridge_ai"."Subscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "NotificationPreference_supplierCompanyId_idx" ON "bridge_ai"."NotificationPreference"("supplierCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_supplierCompanyId_key" ON "bridge_ai"."NotificationPreference"("userId", "supplierCompanyId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "bridge_ai"."Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_supplierCompanyId_type_idx" ON "bridge_ai"."Notification"("supplierCompanyId", "type");

-- CreateIndex
CREATE INDEX "AuditLog_supplierCompanyId_createdAt_idx" ON "bridge_ai"."AuditLog"("supplierCompanyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "bridge_ai"."AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "bridge_ai"."AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "bridge_ai"."AuditLog"("action");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_processedAt_failedAt_idx" ON "bridge_ai"."WebhookEvent"("provider", "processedAt", "failedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_externalEventId_key" ON "bridge_ai"."WebhookEvent"("provider", "externalEventId");

-- CreateIndex
CREATE INDEX "SystemEvent_status_severity_occurredAt_idx" ON "bridge_ai"."SystemEvent"("status", "severity", "occurredAt");

-- CreateIndex
CREATE INDEX "SystemEvent_source_code_idx" ON "bridge_ai"."SystemEvent"("source", "code");

-- AddForeignKey
ALTER TABLE "bridge_ai"."platform_administrators" ADD CONSTRAINT "platform_administrators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "bridge_ai"."portal_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."administrator_permissions" ADD CONSTRAINT "administrator_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "bridge_ai"."portal_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."administrator_permissions" ADD CONSTRAINT "administrator_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "bridge_ai"."permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."supplier_companies" ADD CONSTRAINT "supplier_companies_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "bridge_ai"."portal_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."company_memberships" ADD CONSTRAINT "company_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "bridge_ai"."portal_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."company_memberships" ADD CONSTRAINT "company_memberships_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."supplier_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."SupplierInvite" ADD CONSTRAINT "SupplierInvite_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."supplier_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."SupplierInvite" ADD CONSTRAINT "SupplierInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "bridge_ai"."portal_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."Conversation" ADD CONSTRAINT "Conversation_customerContactId_fkey" FOREIGN KEY ("customerContactId") REFERENCES "bridge_ai"."CustomerContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "bridge_ai"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."Attachment" ADD CONSTRAINT "Attachment_whatsappMessageId_fkey" FOREIGN KEY ("whatsappMessageId") REFERENCES "bridge_ai"."WhatsAppMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."Attachment" ADD CONSTRAINT "Attachment_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "bridge_ai"."QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."Attachment" ADD CONSTRAINT "Attachment_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "bridge_ai"."SupplierQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."Attachment" ADD CONSTRAINT "Attachment_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."supplier_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "bridge_ai"."portal_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."ProductCategory" ADD CONSTRAINT "ProductCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "bridge_ai"."ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."SupplierProductCategory" ADD CONSTRAINT "SupplierProductCategory_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."supplier_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."SupplierProductCategory" ADD CONSTRAINT "SupplierProductCategory_productCategoryId_fkey" FOREIGN KEY ("productCategoryId") REFERENCES "bridge_ai"."ProductCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."QuoteRequest" ADD CONSTRAINT "QuoteRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "bridge_ai"."Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."QuoteRequest" ADD CONSTRAINT "QuoteRequest_customerContactId_fkey" FOREIGN KEY ("customerContactId") REFERENCES "bridge_ai"."CustomerContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."QuoteRequest" ADD CONSTRAINT "QuoteRequest_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "bridge_ai"."ProductCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."QuoteRequestItem" ADD CONSTRAINT "QuoteRequestItem_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "bridge_ai"."QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."SupplierAssignment" ADD CONSTRAINT "SupplierAssignment_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "bridge_ai"."QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."SupplierAssignment" ADD CONSTRAINT "SupplierAssignment_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."supplier_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."SupplierAssignment" ADD CONSTRAINT "SupplierAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "bridge_ai"."portal_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."SupplierQuotation" ADD CONSTRAINT "SupplierQuotation_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "bridge_ai"."QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."SupplierQuotation" ADD CONSTRAINT "SupplierQuotation_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."supplier_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."SupplierQuotation" ADD CONSTRAINT "SupplierQuotation_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "bridge_ai"."SupplierAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."CoverageArea" ADD CONSTRAINT "CoverageArea_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."supplier_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."Subscription" ADD CONSTRAINT "Subscription_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."supplier_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "bridge_ai"."portal_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."NotificationPreference" ADD CONSTRAINT "NotificationPreference_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."supplier_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "bridge_ai"."portal_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."Notification" ADD CONSTRAINT "Notification_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."supplier_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "bridge_ai"."portal_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."AuditLog" ADD CONSTRAINT "AuditLog_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."supplier_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."SystemEvent" ADD CONSTRAINT "SystemEvent_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "bridge_ai"."portal_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;




-- Security foundation: helper functions live outside exposed API schemas.
CREATE SCHEMA IF NOT EXISTS bridge_private;
REVOKE ALL ON SCHEMA bridge_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA bridge_ai TO authenticated, service_role;
REVOKE ALL ON SCHEMA bridge_ai FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA bridge_ai TO authenticated, service_role;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA bridge_ai FROM authenticated;

CREATE OR REPLACE FUNCTION bridge_private.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT auth.uid() $$;

CREATE OR REPLACE FUNCTION bridge_private.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM bridge_ai.platform_administrators pa
       JOIN bridge_ai.portal_profiles pp ON pp.id = pa."userId"
       WHERE pa."userId" = (SELECT auth.uid())
         AND pa.active
         AND pp.status = 'ACTIVE'
     )
$$;

CREATE OR REPLACE FUNCTION bridge_private.has_company_membership(
  target_company_id text,
  permitted_roles bridge_ai."SupplierTeamRole"[] DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM bridge_ai.company_memberships cm
       JOIN bridge_ai.portal_profiles pp ON pp.id = cm."userId"
       JOIN bridge_ai.supplier_companies sc ON sc.id = cm."supplierCompanyId"
       WHERE cm."userId" = (SELECT auth.uid())
         AND cm."supplierCompanyId" = target_company_id
         AND cm.status = 'ACTIVE'
         AND pp.status = 'ACTIVE'
         AND sc.status NOT IN ('SUSPENDED', 'REJECTED')
         AND (permitted_roles IS NULL OR cm.role = ANY(permitted_roles))
     )
$$;

CREATE OR REPLACE FUNCTION bridge_private.can_access_request(target_request_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT bridge_private.is_platform_admin()
      OR EXISTS (
        SELECT 1
        FROM bridge_ai."SupplierAssignment" sa
        WHERE sa."quoteRequestId" = target_request_id
          AND bridge_private.has_company_membership(sa."supplierCompanyId")
      )
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA bridge_private FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION bridge_private.current_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION bridge_private.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION bridge_private.has_company_membership(text, bridge_ai."SupplierTeamRole"[]) TO authenticated;
GRANT EXECUTE ON FUNCTION bridge_private.can_access_request(text) TO authenticated;

-- RLS is mandatory on every Bridge AI table. Administrators use a protected record, not JWT metadata.
DO $$
DECLARE table_name text;
BEGIN
  FOR table_name IN SELECT tablename FROM pg_tables WHERE schemaname = 'bridge_ai'
  LOOP
    EXECUTE format('ALTER TABLE bridge_ai.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE bridge_ai.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON bridge_ai.%I FOR ALL TO authenticated USING ((SELECT bridge_private.is_platform_admin())) WITH CHECK ((SELECT bridge_private.is_platform_admin()))',
      'platform_administrator_all', table_name
    );
  END LOOP;
END $$;

CREATE POLICY profile_select_self ON bridge_ai.portal_profiles FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = id);
CREATE POLICY profile_update_self ON bridge_ai.portal_profiles FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

CREATE POLICY company_select_member ON bridge_ai.supplier_companies FOR SELECT TO authenticated
  USING ((SELECT bridge_private.has_company_membership(id)));
CREATE POLICY company_update_manager ON bridge_ai.supplier_companies FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.has_company_membership(id, ARRAY['OWNER','MANAGER']::bridge_ai."SupplierTeamRole"[])))
  WITH CHECK ((SELECT bridge_private.has_company_membership(id, ARRAY['OWNER','MANAGER']::bridge_ai."SupplierTeamRole"[])));

CREATE POLICY membership_select_company ON bridge_ai.company_memberships FOR SELECT TO authenticated
  USING ((SELECT bridge_private.has_company_membership("supplierCompanyId")));
CREATE POLICY membership_insert_owner ON bridge_ai.company_memberships FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.has_company_membership("supplierCompanyId", ARRAY['OWNER']::bridge_ai."SupplierTeamRole"[])));
CREATE POLICY membership_update_owner ON bridge_ai.company_memberships FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.has_company_membership("supplierCompanyId", ARRAY['OWNER']::bridge_ai."SupplierTeamRole"[])))
  WITH CHECK ((SELECT bridge_private.has_company_membership("supplierCompanyId", ARRAY['OWNER']::bridge_ai."SupplierTeamRole"[])));
CREATE POLICY membership_delete_owner ON bridge_ai.company_memberships FOR DELETE TO authenticated
  USING ((SELECT bridge_private.has_company_membership("supplierCompanyId", ARRAY['OWNER']::bridge_ai."SupplierTeamRole"[])));

CREATE POLICY invite_company_access ON bridge_ai."SupplierInvite" FOR ALL TO authenticated
  USING ((SELECT bridge_private.has_company_membership("supplierCompanyId", ARRAY['OWNER','MANAGER']::bridge_ai."SupplierTeamRole"[])))
  WITH CHECK ((SELECT bridge_private.has_company_membership("supplierCompanyId", ARRAY['OWNER','MANAGER']::bridge_ai."SupplierTeamRole"[])));

CREATE POLICY category_read ON bridge_ai."ProductCategory" FOR SELECT TO authenticated USING (active);
CREATE POLICY supplier_category_read ON bridge_ai."SupplierProductCategory" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.has_company_membership("supplierCompanyId")));
CREATE POLICY supplier_category_manage ON bridge_ai."SupplierProductCategory" FOR ALL TO authenticated
  USING ((SELECT bridge_private.has_company_membership("supplierCompanyId", ARRAY['OWNER','MANAGER']::bridge_ai."SupplierTeamRole"[])))
  WITH CHECK ((SELECT bridge_private.has_company_membership("supplierCompanyId", ARRAY['OWNER','MANAGER']::bridge_ai."SupplierTeamRole"[])));

CREATE POLICY request_assigned_read ON bridge_ai."QuoteRequest" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.can_access_request(id)));
CREATE POLICY request_item_assigned_read ON bridge_ai."QuoteRequestItem" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.can_access_request("quoteRequestId")));

CREATE POLICY assignment_company_read ON bridge_ai."SupplierAssignment" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.has_company_membership("supplierCompanyId")));
CREATE POLICY assignment_company_update ON bridge_ai."SupplierAssignment" FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.has_company_membership("supplierCompanyId", ARRAY['OWNER','MANAGER','MEMBER']::bridge_ai."SupplierTeamRole"[])))
  WITH CHECK ((SELECT bridge_private.has_company_membership("supplierCompanyId", ARRAY['OWNER','MANAGER','MEMBER']::bridge_ai."SupplierTeamRole"[])));

CREATE POLICY quotation_company_read ON bridge_ai."SupplierQuotation" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.has_company_membership("supplierCompanyId")));
CREATE POLICY quotation_company_insert ON bridge_ai."SupplierQuotation" FOR INSERT TO authenticated
  WITH CHECK ((SELECT bridge_private.has_company_membership("supplierCompanyId")));
CREATE POLICY quotation_company_update ON bridge_ai."SupplierQuotation" FOR UPDATE TO authenticated
  USING ((SELECT bridge_private.has_company_membership("supplierCompanyId")))
  WITH CHECK ((SELECT bridge_private.has_company_membership("supplierCompanyId")));

CREATE POLICY coverage_company_read ON bridge_ai."CoverageArea" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.has_company_membership("supplierCompanyId")));
CREATE POLICY coverage_company_manage ON bridge_ai."CoverageArea" FOR ALL TO authenticated
  USING ((SELECT bridge_private.has_company_membership("supplierCompanyId", ARRAY['OWNER','MANAGER']::bridge_ai."SupplierTeamRole"[])))
  WITH CHECK ((SELECT bridge_private.has_company_membership("supplierCompanyId", ARRAY['OWNER','MANAGER']::bridge_ai."SupplierTeamRole"[])));

CREATE POLICY subscription_company_read ON bridge_ai."Subscription" FOR SELECT TO authenticated
  USING ((SELECT bridge_private.has_company_membership("supplierCompanyId")));

CREATE POLICY notification_preference_own ON bridge_ai."NotificationPreference" FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = "userId" AND (SELECT bridge_private.has_company_membership("supplierCompanyId")))
  WITH CHECK ((SELECT auth.uid()) = "userId" AND (SELECT bridge_private.has_company_membership("supplierCompanyId")));
CREATE POLICY notification_own_read ON bridge_ai."Notification" FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = "userId" AND ("supplierCompanyId" IS NULL OR (SELECT bridge_private.has_company_membership("supplierCompanyId"))));
CREATE POLICY notification_own_update ON bridge_ai."Notification" FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = "userId" AND ("supplierCompanyId" IS NULL OR (SELECT bridge_private.has_company_membership("supplierCompanyId"))))
  WITH CHECK ((SELECT auth.uid()) = "userId" AND ("supplierCompanyId" IS NULL OR (SELECT bridge_private.has_company_membership("supplierCompanyId"))));

CREATE POLICY attachment_company_read ON bridge_ai."Attachment" FOR SELECT TO authenticated
  USING (
    ("supplierCompanyId" IS NOT NULL AND (SELECT bridge_private.has_company_membership("supplierCompanyId")))
    OR ("quotationId" IS NOT NULL AND EXISTS (
      SELECT 1 FROM bridge_ai."SupplierQuotation" q
      WHERE q.id = "quotationId" AND (SELECT bridge_private.has_company_membership(q."supplierCompanyId"))
    ))
    OR ("quoteRequestId" IS NOT NULL AND (SELECT bridge_private.can_access_request("quoteRequestId")))
  );
CREATE POLICY attachment_company_insert ON bridge_ai."Attachment" FOR INSERT TO authenticated
  WITH CHECK (
    "uploadedById" = (SELECT auth.uid()) AND (
      ("supplierCompanyId" IS NOT NULL AND (SELECT bridge_private.has_company_membership("supplierCompanyId")))
      OR ("quotationId" IS NOT NULL AND EXISTS (
        SELECT 1 FROM bridge_ai."SupplierQuotation" q
        WHERE q.id = "quotationId" AND (SELECT bridge_private.has_company_membership(q."supplierCompanyId"))
      ))
    )
  );

CREATE POLICY audit_company_read ON bridge_ai."AuditLog" FOR SELECT TO authenticated
  USING ("supplierCompanyId" IS NOT NULL AND (SELECT bridge_private.has_company_membership("supplierCompanyId")));
CREATE POLICY audit_actor_insert ON bridge_ai."AuditLog" FOR INSERT TO authenticated
  WITH CHECK (
    "actorUserId" = (SELECT auth.uid())
    AND (
      ("supplierCompanyId" IS NOT NULL AND (SELECT bridge_private.has_company_membership("supplierCompanyId")))
      OR (SELECT bridge_private.is_platform_admin())
    )
  );

-- Integrity constraints.
ALTER TABLE bridge_ai."Attachment"
  ADD CONSTRAINT attachment_byte_size_valid CHECK ("byteSize" >= 0 AND "byteSize" <= 10485760),
  ADD CONSTRAINT attachment_exactly_one_parent CHECK (
    num_nonnulls("whatsappMessageId", "quoteRequestId", "quotationId", "supplierCompanyId") = 1
  );
ALTER TABLE bridge_ai."QuoteRequest"
  ADD CONSTRAINT quote_distribution_limit_valid CHECK ("distributionLimit" >= 1),
  ADD CONSTRAINT quote_budget_nonnegative CHECK ("customerBudget" IS NULL OR "customerBudget" >= 0),
  ADD CONSTRAINT quote_deadline_sequence CHECK ("responseDueAt" >= "createdAt" AND ("closedAt" IS NULL OR "closedAt" >= "createdAt"));
ALTER TABLE bridge_ai."QuoteRequestItem"
  ADD CONSTRAINT quote_item_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT quote_item_order_nonnegative CHECK ("displayOrder" >= 0);
ALTER TABLE bridge_ai."SupplierQuotation"
  ADD CONSTRAINT quotation_price_nonnegative CHECK (price >= 0),
  ADD CONSTRAINT quotation_lead_time_positive CHECK ("leadTimeDays" > 0),
  ADD CONSTRAINT quotation_date_sequence CHECK (
    ("submittedAt" IS NULL OR "submittedAt" >= "createdAt")
    AND ("decidedAt" IS NULL OR ("submittedAt" IS NOT NULL AND "decidedAt" >= "submittedAt"))
    AND ("validUntil" IS NULL OR "submittedAt" IS NULL OR "validUntil" >= "submittedAt")
  ),
  ADD CONSTRAINT quotation_status_timestamps CHECK (
    (status = 'DRAFT' AND "submittedAt" IS NULL AND "decidedAt" IS NULL)
    OR (status IN ('SUBMITTED','WITHDRAWN','EXPIRED') AND "submittedAt" IS NOT NULL)
    OR (status IN ('ACCEPTED','REJECTED') AND "submittedAt" IS NOT NULL AND "decidedAt" IS NOT NULL)
  );
ALTER TABLE bridge_ai."CoverageArea"
  ADD CONSTRAINT coverage_radius_nonnegative CHECK ("radiusMiles" IS NULL OR "radiusMiles" >= 0),
  ADD CONSTRAINT coverage_shape_valid CHECK (
    (type = 'POSTCODE' AND "postcodePrefix" IS NOT NULL AND "centrePostcode" IS NULL AND "radiusMiles" IS NULL)
    OR (type = 'DISTANCE' AND "postcodePrefix" IS NULL AND "centrePostcode" IS NOT NULL AND "radiusMiles" IS NOT NULL)
  );
ALTER TABLE bridge_ai."Subscription"
  ADD CONSTRAINT subscription_period_sequence CHECK (
    "currentPeriodStart" IS NULL OR "currentPeriodEnd" IS NULL OR "currentPeriodStart" <= "currentPeriodEnd"
  ),
  ADD CONSTRAINT subscription_trial_sequence CHECK (
    "trialEndsAt" IS NULL OR "currentPeriodStart" IS NULL OR "trialEndsAt" >= "currentPeriodStart"
  );
ALTER TABLE bridge_ai."WebhookEvent"
  ADD CONSTRAINT webhook_retry_nonnegative CHECK ("retryCount" >= 0);
CREATE UNIQUE INDEX company_memberships_one_primary_per_user
  ON bridge_ai.company_memberships ("userId") WHERE "isPrimary" AND status = 'ACTIVE';

CREATE OR REPLACE FUNCTION bridge_private.enforce_assignment_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE allowed_count integer;
        assigned_count integer;
BEGIN
  SELECT "distributionLimit" INTO allowed_count
  FROM bridge_ai."QuoteRequest" WHERE id = NEW."quoteRequestId" FOR UPDATE;
  SELECT count(*) INTO assigned_count
  FROM bridge_ai."SupplierAssignment"
  WHERE "quoteRequestId" = NEW."quoteRequestId" AND status <> 'WITHDRAWN'
    AND id <> NEW.id;
  IF NEW.status <> 'WITHDRAWN' AND assigned_count >= allowed_count THEN
    RAISE EXCEPTION 'supplier distribution limit exceeded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION bridge_private.enforce_assignment_limit() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enforce_assignment_limit
  BEFORE INSERT OR UPDATE ON bridge_ai."SupplierAssignment"
  FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_assignment_limit();

CREATE OR REPLACE FUNCTION bridge_private.enforce_quotation_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE assignment_row bridge_ai."SupplierAssignment"%ROWTYPE;
BEGIN
  SELECT * INTO assignment_row FROM bridge_ai."SupplierAssignment" WHERE id = NEW."assignmentId";
  IF assignment_row.id IS NULL
     OR assignment_row."quoteRequestId" <> NEW."quoteRequestId"
     OR assignment_row."supplierCompanyId" <> NEW."supplierCompanyId" THEN
    RAISE EXCEPTION 'quotation does not match its assignment' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('SUBMITTED','ACCEPTED','REJECTED','WITHDRAWN','EXPIRED')
     AND assignment_row.status NOT IN ('ACCEPTED','QUOTED') THEN
    RAISE EXCEPTION 'quotation status contradicts assignment status' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION bridge_private.enforce_quotation_consistency() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enforce_quotation_consistency
  BEFORE INSERT OR UPDATE ON bridge_ai."SupplierQuotation"
  FOR EACH ROW EXECUTE FUNCTION bridge_private.enforce_quotation_consistency();

CREATE OR REPLACE FUNCTION bridge_private.audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'audit records are append-only' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION bridge_private.audit_append_only() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_append_only
  BEFORE UPDATE OR DELETE ON bridge_ai."AuditLog"
  FOR EACH ROW EXECUTE FUNCTION bridge_private.audit_append_only();

-- Private Storage is provisioned by migration; application requests must never create infrastructure.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'bridge-ai-private',
  'bridge-ai-private',
  false,
  10485760,
  ARRAY['application/pdf','image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS bridge_ai_storage_select ON storage.objects;
DROP POLICY IF EXISTS bridge_ai_storage_insert ON storage.objects;
DROP POLICY IF EXISTS bridge_ai_storage_update ON storage.objects;
DROP POLICY IF EXISTS bridge_ai_storage_delete ON storage.objects;
CREATE POLICY bridge_ai_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'bridge-ai-private'
    AND (
      (storage.foldername(name))[1] = 'companies'
      AND (SELECT bridge_private.has_company_membership((storage.foldername(name))[2]))
      OR (SELECT bridge_private.is_platform_admin())
    )
  );
CREATE POLICY bridge_ai_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'bridge-ai-private'
    AND (storage.foldername(name))[1] = 'companies'
    AND (SELECT bridge_private.has_company_membership((storage.foldername(name))[2]))
  );
CREATE POLICY bridge_ai_storage_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'bridge-ai-private'
    AND (
      ((storage.foldername(name))[1] = 'companies' AND (SELECT bridge_private.has_company_membership((storage.foldername(name))[2])))
      OR (SELECT bridge_private.is_platform_admin())
    )
  )
  WITH CHECK (
    bucket_id = 'bridge-ai-private'
    AND (
      ((storage.foldername(name))[1] = 'companies' AND (SELECT bridge_private.has_company_membership((storage.foldername(name))[2])))
      OR (SELECT bridge_private.is_platform_admin())
    )
  );
CREATE POLICY bridge_ai_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'bridge-ai-private'
    AND (
      ((storage.foldername(name))[1] = 'companies' AND (SELECT bridge_private.has_company_membership((storage.foldername(name))[2])))
      OR (SELECT bridge_private.is_platform_admin())
    )
  );

-- Legacy public application is quarantined: retain its data, remove API privileges and public RPC execution.
DO $$
DECLARE legacy_table text;
BEGIN
  FOREACH legacy_table IN ARRAY ARRAY['profiles','quotes','request_customers','requests','subscriptions','whatsapp_messages']
  LOOP
    IF to_regclass(format('public.%I', legacy_table)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', legacy_table);
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', legacy_table);
    END IF;
  END LOOP;
  IF to_regprocedure('public.handle_new_user()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.sync_request_quote_count()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.sync_request_quote_count() FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
