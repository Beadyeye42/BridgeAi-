# Free Hyperlocal access

Approved suppliers in an eligible Hyperlocal service industry can activate free access within an inclusive two-mile radius of their registered base. They must select active coverage between one and two miles before activating. No card or Stripe subscription is required. The existing limit of three live opportunities applies.

Wider coverage requires a paid membership: Hyperlocal £14.99/month up to 10 miles, Local £29.99/month up to 40 miles, Regional £59.99/month up to 100 miles, or Nationwide £89.99/month. Existing industry eligibility rules continue to apply.

Starting an upgrade preserves the free two-mile entitlement until Stripe confirms an active subscription. Existing paid memberships are not automatically cancelled or converted. Free activation writes its audit event in the same database transaction.

Deployment requires the two free-hyperlocal migrations, in timestamp order, and a regenerated Prisma client. This change depends on the audit fixes in PR #52. Production migration history must first be reconciled as described in AUDIT_2026-09-06.md; do not replay mismatched historical migrations using include-all. This feature has not been activated in production.
