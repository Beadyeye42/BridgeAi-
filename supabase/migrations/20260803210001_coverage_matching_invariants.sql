ALTER TABLE bridge_ai."CoverageArea"
  DROP CONSTRAINT IF EXISTS coverage_radius_nonnegative,
  DROP CONSTRAINT IF EXISTS coverage_shape_valid;

ALTER TABLE bridge_ai."CoverageArea"
  ADD CONSTRAINT coverage_radius_valid CHECK (
    "radiusMiles" IS NULL OR "radiusMiles" BETWEEN 1 AND 500
  ),
  ADD CONSTRAINT coverage_coordinate_bounds CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (
      latitude IS NOT NULL AND longitude IS NOT NULL
      AND latitude BETWEEN -90 AND 90
      AND longitude BETWEEN -180 AND 180
    )
  ),
  ADD CONSTRAINT coverage_shape_valid CHECK (
    (
      type = 'POSTCODE'
      AND "postcodePrefix" IS NOT NULL
      AND "centrePostcode" IS NULL
      AND "radiusMiles" IS NULL
      AND latitude IS NULL
      AND longitude IS NULL
    )
    OR (
      type = 'DISTANCE'
      AND "postcodePrefix" IS NULL
      AND "centrePostcode" IS NOT NULL
      AND "radiusMiles" IS NOT NULL
      AND latitude IS NOT NULL
      AND longitude IS NOT NULL
    )
    OR (
      type = 'NATIONWIDE'
      AND "postcodePrefix" IS NULL
      AND "centrePostcode" IS NULL
      AND "radiusMiles" IS NULL
      AND latitude IS NULL
      AND longitude IS NULL
    )
  );

CREATE UNIQUE INDEX coverage_one_active_nationwide_per_company
  ON bridge_ai."CoverageArea" ("supplierCompanyId")
  WHERE type = 'NATIONWIDE' AND active;
