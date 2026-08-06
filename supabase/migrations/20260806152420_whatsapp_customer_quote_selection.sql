-- Customer quote selection runs through the trusted WhatsApp AI worker.
-- These policies grant only the three writes required by that atomic flow;
-- ordinary authenticated portal users cannot activate the worker context.
CREATE POLICY whatsapp_ai_quotation_selection_update
  ON bridge_ai."SupplierQuotation" FOR UPDATE TO authenticated
  USING (
    (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
    AND status = 'SUBMITTED'
  )
  WITH CHECK (
    (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
    AND status IN ('ACCEPTED', 'REJECTED')
  );

CREATE POLICY whatsapp_ai_contact_grant_selection_insert
  ON bridge_ai."ContactAccessGrant" FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
    AND reason = 'CUSTOMER_SELECTED'
    AND "successFeeId" IS NULL
    AND "revokedAt" IS NULL
  );

CREATE POLICY whatsapp_ai_selection_notification_insert
  ON bridge_ai."Notification" FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
    AND type = 'CONTACT_DETAILS_UNLOCKED'
    AND channel = 'IN_APP'
    AND "supplierCompanyId" IS NOT NULL
  );

COMMENT ON POLICY whatsapp_ai_quotation_selection_update ON bridge_ai."SupplierQuotation" IS
  'Allows only the trusted WhatsApp AI worker to accept one submitted quote and reject the remaining submitted quotes.';
COMMENT ON POLICY whatsapp_ai_contact_grant_selection_insert ON bridge_ai."ContactAccessGrant" IS
  'Allows the trusted WhatsApp AI worker to unlock the selected supplier without a winning fee.';
COMMENT ON POLICY whatsapp_ai_selection_notification_insert ON bridge_ai."Notification" IS
  'Allows the trusted WhatsApp AI worker to notify the selected supplier after customer acceptance.';
