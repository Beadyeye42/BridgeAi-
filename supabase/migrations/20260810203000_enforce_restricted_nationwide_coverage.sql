-- A Nationwide plan may be deliberately restricted by an administrator to a
-- smaller service or delivery radius. Treat that restriction as authoritative
-- when coverage is saved, not only when an opportunity is assigned.

CREATE OR REPLACE FUNCTION bridge_private.enforce_coverage_membership_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  limits record;
  configured_override integer;
  permitted integer;
  origin_lat numeric;
  origin_lng numeric;
  centre_distance numeric;
BEGIN
  IF NOT NEW.active THEN RETURN NEW; END IF;

  SELECT * INTO limits
  FROM bridge_private.coverage_configuration_limits(NEW."supplierCompanyId");
  IF limits.tier IS NULL THEN
    RAISE EXCEPTION 'onboarding coverage configuration is unavailable' USING ERRCODE = '23514';
  END IF;
  IF NEW.type = 'POSTCODE' THEN
    RAISE EXCEPTION 'postcode-area rules are not valid for geographic memberships; choose a radius from the company base' USING ERRCODE = '23514';
  END IF;

  SELECT CASE WHEN NEW.purpose = 'SERVICE'
    THEN company."maximumServiceRadiusOverride"
    ELSE company."maximumDeliveryRadiusOverride"
  END
  INTO configured_override
  FROM bridge_ai.supplier_companies company
  WHERE company.id = NEW."supplierCompanyId";

  permitted := CASE
    WHEN limits.maximum_radius IS NULL THEN configured_override
    WHEN configured_override IS NULL THEN limits.maximum_radius
    ELSE least(configured_override, limits.maximum_radius)
  END;

  IF NEW.type = 'NATIONWIDE' AND (NOT limits.nationwide OR permitted IS NOT NULL) THEN
    RAISE EXCEPTION 'this membership does not permit unrestricted nationwide coverage for this purpose' USING ERRCODE = '23514';
  END IF;

  IF NEW.type = 'DISTANCE' AND permitted IS NOT NULL
    AND NEW."radiusMiles" > permitted THEN
    RAISE EXCEPTION 'coverage radius exceeds the active membership or onboarding limit' USING ERRCODE = '23514';
  END IF;

  IF NEW.type = 'DISTANCE' AND permitted IS NOT NULL THEN
    SELECT company."geographicOriginLatitude", company."geographicOriginLongitude"
      INTO origin_lat, origin_lng
    FROM bridge_ai.supplier_companies company
    WHERE company.id = NEW."supplierCompanyId";

    IF origin_lat IS NULL OR origin_lng IS NULL OR NEW.latitude IS NULL OR NEW.longitude IS NULL THEN
      RAISE EXCEPTION 'company geographic origin and coverage centre must be resolved before coverage is created' USING ERRCODE = '23514';
    END IF;

    centre_distance := bridge_private.distance_miles(
      origin_lat, origin_lng, NEW.latitude, NEW.longitude
    );
    IF centre_distance + NEW."radiusMiles" > permitted + 0.01 THEN
      RAISE EXCEPTION 'coverage boundary exceeds the membership or onboarding radius from the company base' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bridge_private.enforce_coverage_membership_limit()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bridge_private.enforce_coverage_membership_limit() TO bridge_ai_app;
