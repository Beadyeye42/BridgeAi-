CREATE TYPE bridge_ai."SubscriptionAccessSource" AS ENUM ('STRIPE', 'COMPLIMENTARY');

ALTER TABLE bridge_ai."Subscription"
  ADD COLUMN "accessSource" bridge_ai."SubscriptionAccessSource" NOT NULL DEFAULT 'STRIPE',
  ADD COLUMN "complimentaryReason" varchar(500),
  ADD COLUMN "complimentaryGrantedAt" timestamptz,
  ADD COLUMN "complimentaryGrantedById" uuid,
  ADD COLUMN "complimentaryRevokedAt" timestamptz,
  ADD COLUMN "complimentaryRevokedById" uuid,
  ADD COLUMN "complimentaryRevocationReason" varchar(500);

ALTER TABLE bridge_ai."Subscription"
  ADD CONSTRAINT subscription_complimentary_metadata_valid CHECK (
    (
      "accessSource" = 'STRIPE'
      AND "complimentaryReason" IS NULL
      AND "complimentaryGrantedAt" IS NULL
      AND "complimentaryGrantedById" IS NULL
      AND "complimentaryRevokedAt" IS NULL
      AND "complimentaryRevokedById" IS NULL
      AND "complimentaryRevocationReason" IS NULL
    )
    OR
    (
      "accessSource" = 'COMPLIMENTARY'
      AND length(btrim("complimentaryReason")) BETWEEN 3 AND 500
      AND "complimentaryGrantedAt" IS NOT NULL
      AND "currentPeriodStart" IS NOT NULL
      AND "currentPeriodEnd" IS NOT NULL
      AND "currentPeriodEnd" > "currentPeriodStart"
    )
  ),
  ADD CONSTRAINT subscription_complimentary_revocation_valid CHECK (
    ("complimentaryRevokedAt" IS NULL AND "complimentaryRevokedById" IS NULL AND "complimentaryRevocationReason" IS NULL)
    OR
    (
      "accessSource" = 'COMPLIMENTARY'
      AND "complimentaryRevokedAt" IS NOT NULL
      AND "complimentaryRevocationReason" IS NOT NULL
      AND length(btrim("complimentaryRevocationReason")) BETWEEN 3 AND 500
      AND "complimentaryRevokedAt" >= "complimentaryGrantedAt"
    )
  ),
  ADD CONSTRAINT "Subscription_complimentaryGrantedById_fkey"
    FOREIGN KEY ("complimentaryGrantedById") REFERENCES bridge_ai.portal_profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Subscription_complimentaryRevokedById_fkey"
    FOREIGN KEY ("complimentaryRevokedById") REFERENCES bridge_ai.portal_profiles(id) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Subscription_accessSource_status_currentPeriodEnd_idx"
  ON bridge_ai."Subscription" ("accessSource", status, "currentPeriodEnd");
CREATE INDEX "Subscription_complimentaryGrantedById_idx"
  ON bridge_ai."Subscription" ("complimentaryGrantedById");
CREATE INDEX "Subscription_complimentaryRevokedById_idx"
  ON bridge_ai."Subscription" ("complimentaryRevokedById");

COMMENT ON COLUMN bridge_ai."Subscription"."accessSource" IS
  'Authoritative access source. COMPLIMENTARY is granted only by a verified platform administrator and never represents a Stripe payment.';
COMMENT ON COLUMN bridge_ai."Subscription"."complimentaryReason" IS
  'Administrator-supplied promotional or testing reason; material changes are also written to the append-only audit log.';
