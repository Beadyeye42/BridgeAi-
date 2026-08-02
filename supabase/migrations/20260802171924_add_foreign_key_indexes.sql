CREATE INDEX "SupplierCompany_approvedById_idx" ON "bridge_ai"."SupplierCompany"("approvedById");
CREATE INDEX "SupplierInvite_invitedById_idx" ON "bridge_ai"."SupplierInvite"("invitedById");
CREATE INDEX "Attachment_uploadedById_idx" ON "bridge_ai"."Attachment"("uploadedById");
CREATE INDEX "Attachment_whatsappMessageId_idx" ON "bridge_ai"."Attachment"("whatsappMessageId");
CREATE INDEX "QuoteRequest_conversationId_idx" ON "bridge_ai"."QuoteRequest"("conversationId");
CREATE INDEX "NotificationPreference_supplierCompanyId_idx" ON "bridge_ai"."NotificationPreference"("supplierCompanyId");

