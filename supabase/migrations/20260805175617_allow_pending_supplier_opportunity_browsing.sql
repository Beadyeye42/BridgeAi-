-- Active supplier accounts may browse the deliberately minimal opportunity
-- projection while their company approval is pending. The claim function still
-- requires an approved company, active subscription, matching category and
-- coverage before any private request data becomes visible.
CREATE OR REPLACE FUNCTION bridge_private.can_browse_supplier_opportunities()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM bridge_ai.company_memberships membership
      JOIN bridge_ai.portal_profiles profile ON profile.id = membership."userId"
      JOIN bridge_ai.supplier_companies company ON company.id = membership."supplierCompanyId"
      WHERE membership."userId" = (SELECT auth.uid())
        AND membership.status = 'ACTIVE'
        AND profile.status = 'ACTIVE'
        AND company.status IN ('PENDING', 'APPROVED')
    )
$$;

REVOKE ALL ON FUNCTION bridge_private.can_browse_supplier_opportunities()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.can_browse_supplier_opportunities()
  TO authenticated;
