-- Prisma uses INSERT ... RETURNING when a WhatsApp customer selects a quote.
-- FORCE RLS therefore requires the trusted WhatsApp worker to satisfy both the
-- INSERT policy and the SELECT policy for the newly-created order rows.
-- The worker remains server-only and is established through the transaction-
-- local, signed worker context in bridge_private.is_trusted_worker().

DROP POLICY IF EXISTS buyer_order_owner_read ON bridge_ai."BuyerOrder";
CREATE POLICY buyer_order_owner_read ON bridge_ai."BuyerOrder"
  FOR SELECT TO authenticated
  USING (
    (SELECT bridge_private.is_current_buyer("customerContactId"))
    OR (SELECT bridge_private.is_platform_admin())
    OR (SELECT bridge_private.is_trusted_worker('buyer_auth'))
    OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
  );

DROP POLICY IF EXISTS buyer_order_event_owner_read ON bridge_ai."BuyerOrderEvent";
CREATE POLICY buyer_order_event_owner_read ON bridge_ai."BuyerOrderEvent"
  FOR SELECT TO authenticated
  USING (
    (SELECT bridge_private.is_platform_admin())
    OR (SELECT bridge_private.is_trusted_worker('buyer_auth'))
    OR (SELECT bridge_private.is_trusted_worker('whatsapp_ai'))
    OR EXISTS (
      SELECT 1
      FROM bridge_ai."BuyerOrder" orders
      WHERE orders.id = "buyerOrderId"
        AND (SELECT bridge_private.is_current_buyer(orders."customerContactId"))
    )
  );

COMMENT ON POLICY buyer_order_owner_read ON bridge_ai."BuyerOrder" IS
  'Buyer-owned/admin reads plus server-only buyer_auth and whatsapp_ai INSERT RETURNING support.';
COMMENT ON POLICY buyer_order_event_owner_read ON bridge_ai."BuyerOrderEvent" IS
  'Buyer-owned/admin reads plus server-only buyer_auth and whatsapp_ai nested INSERT RETURNING support.';
