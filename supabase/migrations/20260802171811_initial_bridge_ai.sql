-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "bridge_ai";

-- CreateEnum
CREATE TYPE "bridge_ai"."UserRole" AS ENUM ('SUPPLIER', 'ADMINISTRATOR');

-- CreateEnum
CREATE TYPE "bridge_ai"."AccountStatus" AS ENUM ('ACTIVE', 'INVITED', 'LOCKED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "bridge_ai"."SupplierStatus" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "bridge_ai"."SupplierTeamRole" AS ENUM ('OWNER', 'MANAGER', 'MEMBER');

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
CREATE TABLE "bridge_ai"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "bridge_ai"."UserRole" NOT NULL DEFAULT 'SUPPLIER',
    "status" "bridge_ai"."AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."AuthSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."PasswordResetToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."SupplierCompany" (
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
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "suspensionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."SupplierTeamMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "supplierCompanyId" TEXT NOT NULL,
    "role" "bridge_ai"."SupplierTeamRole" NOT NULL DEFAULT 'MEMBER',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierTeamMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."SupplierInvite" (
    "id" TEXT NOT NULL,
    "supplierCompanyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "bridge_ai"."SupplierTeamRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "consentRecordedAt" TIMESTAMP(3),
    "marketingConsentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."Conversation" (
    "id" TEXT NOT NULL,
    "customerContactId" TEXT NOT NULL,
    "channel" "bridge_ai"."ConversationChannel" NOT NULL DEFAULT 'WHATSAPP',
    "externalConversationId" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."SupplierProductCategory" (
    "supplierCompanyId" TEXT NOT NULL,
    "productCategoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "responseDueAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."SupplierAssignment" (
    "id" TEXT NOT NULL,
    "quoteRequestId" TEXT NOT NULL,
    "supplierCompanyId" TEXT NOT NULL,
    "status" "bridge_ai"."AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "declinedReason" TEXT,
    "assignedById" TEXT,

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
    "validUntil" TIMESTAMP(3),
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "supplierCompanyId" TEXT NOT NULL,
    "emailNewRequests" BOOLEAN NOT NULL DEFAULT true,
    "emailRequestReminders" BOOLEAN NOT NULL DEFAULT true,
    "emailQuotationUpdates" BOOLEAN NOT NULL DEFAULT true,
    "smsUrgentRequests" BOOLEAN NOT NULL DEFAULT false,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "quietHoursStart" TEXT,
    "quietHoursEnd" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "supplierCompanyId" TEXT,
    "type" "bridge_ai"."NotificationType" NOT NULL,
    "channel" "bridge_ai"."NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actionUrl" TEXT,
    "readAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "supplierCompanyId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_ai"."WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
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
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "SystemEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "bridge_ai"."User"("email");

-- CreateIndex
CREATE INDEX "User_role_status_idx" ON "bridge_ai"."User"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "bridge_ai"."AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "bridge_ai"."AuthSession"("userId");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "bridge_ai"."AuthSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "bridge_ai"."PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "bridge_ai"."PasswordResetToken"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "SupplierCompany_status_idx" ON "bridge_ai"."SupplierCompany"("status");

-- CreateIndex
CREATE INDEX "SupplierCompany_postcode_idx" ON "bridge_ai"."SupplierCompany"("postcode");

-- CreateIndex
CREATE INDEX "SupplierTeamMembership_supplierCompanyId_role_idx" ON "bridge_ai"."SupplierTeamMembership"("supplierCompanyId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierTeamMembership_userId_supplierCompanyId_key" ON "bridge_ai"."SupplierTeamMembership"("userId", "supplierCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvite_tokenHash_key" ON "bridge_ai"."SupplierInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "SupplierInvite_email_expiresAt_idx" ON "bridge_ai"."SupplierInvite"("email", "expiresAt");

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
ALTER TABLE "bridge_ai"."AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "bridge_ai"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "bridge_ai"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."SupplierCompany" ADD CONSTRAINT "SupplierCompany_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "bridge_ai"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."SupplierTeamMembership" ADD CONSTRAINT "SupplierTeamMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "bridge_ai"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."SupplierTeamMembership" ADD CONSTRAINT "SupplierTeamMembership_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."SupplierCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."SupplierInvite" ADD CONSTRAINT "SupplierInvite_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."SupplierCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."SupplierInvite" ADD CONSTRAINT "SupplierInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "bridge_ai"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "bridge_ai"."Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "bridge_ai"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."ProductCategory" ADD CONSTRAINT "ProductCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "bridge_ai"."ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."SupplierProductCategory" ADD CONSTRAINT "SupplierProductCategory_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."SupplierCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "bridge_ai"."SupplierAssignment" ADD CONSTRAINT "SupplierAssignment_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."SupplierCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."SupplierQuotation" ADD CONSTRAINT "SupplierQuotation_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "bridge_ai"."QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."SupplierQuotation" ADD CONSTRAINT "SupplierQuotation_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."SupplierCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."SupplierQuotation" ADD CONSTRAINT "SupplierQuotation_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "bridge_ai"."SupplierAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."CoverageArea" ADD CONSTRAINT "CoverageArea_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."SupplierCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."Subscription" ADD CONSTRAINT "Subscription_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."SupplierCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "bridge_ai"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."NotificationPreference" ADD CONSTRAINT "NotificationPreference_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."SupplierCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "bridge_ai"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."Notification" ADD CONSTRAINT "Notification_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."SupplierCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "bridge_ai"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_ai"."AuditLog" ADD CONSTRAINT "AuditLog_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "bridge_ai"."SupplierCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;



