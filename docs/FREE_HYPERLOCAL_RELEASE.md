# Free Hyperlocal release

Hyperlocal retains its tier, plan ID and code, with £0/month and a fixed 2-mile radius. Local remains 40 miles, Regional 100, and Nationwide unchanged. Industry eligibility, administrator safety restrictions, and stored opportunity limits are preserved. Production currently has limits 5/10/20/30; an older conversation and the public pricing card described Hyperlocal as 3. The Hyperlocal card now reflects the existing limit of 5.

## Application and billing

- Coverage creation requires exactly 2 miles for Hyperlocal. Matching and opportunity access enforce the canonical 2-mile ceiling even with stale plan data. Safety overrides may still restrict access further.
- Supplier and administrator displays, registration and homepage pricing use free/fixed-radius wording. Before choosing Hyperlocal, suppliers must save 2-mile coverage at their registered company base. Pre-plan and other-tier coverage forms offer 2 miles for this transition.
- Admin validation permits £0 only for Hyperlocal, fixes its radius at 2, and prevents manual Stripe Price IDs for this tier. Its zero recurring Price is managed server-side, with cached Stripe prices checked for a zero monthly amount.
- Existing Stripe subscription/webhook machinery remains the activation authority. Free Checkout uses `payment_method_collection: if_required` and excludes promotions. Stripe configuration is still required; free does not mean an offline subscription bypass. Paid upgrades use `error_if_incomplete` to avoid granting paid access when collection fails. A free subscriber without a payment method must add one through the existing billing portal before upgrading.
- Hyperlocal tax remains disabled. Other tiers' tax settings are unchanged.

## Database release order

1. Recheck Hyperlocal subscriptions and Stripe before release. At inspection, the production database had one Hyperlocal subscription, none linked to a Stripe subscription. A database price update does not change existing Stripe billing. If paid Stripe subscriptions appear before release, move their items to a zero recurring Price with explicit proration treatment and verify webhook reconciliation. Do not cancel or refund them as part of the SQL migration.
2. Apply only `20260906221744_free_hyperlocal_two_miles.sql` to the intended database using the migration workflow. Do not run an unreviewed blanket `supabase db push`: live history contains older migrations with names matching the repository but differing version timestamps. Reconcile history by comparing migration contents before any blanket deployment.
3. The migration changes the existing seed row, replaces price/radius constraints and the effective-limit/coverage functions, clears its cached Price ID, and writes an audit record. It keeps historical migrations immutable. `prisma/seed.ts` seeds only development identities, so requires no pricing change.
4. Usable company-base coverage is resized to 2 miles. Off-base, unresolved, nationwide and coverage restricted below 2 miles are deactivated. Current open assignments are reconciled using the existing collection-aware function; assignments outside the new boundary may be withdrawn. Review affected suppliers and their coverage. Industry flags and opportunity caps are untouched.
5. Deploy the application after database verification, then verify registration, coverage, free Checkout, subscription activation, paid upgrade and webhook renewal in an isolated Stripe test environment. Free Checkout deliberately returns 503 if the database still has the old price/radius, rather than charging £14.99.

The feature branch is intended for a Vercel preview. Production and its database are not changed by pushing this branch. A preview connected to the unmigrated production database can show the new public copy but cannot complete free activation; use an isolated migrated database and Stripe test keys for the full billing flow.

## Verification

Application tests include 2-mile boundaries, stale-plan limits, free Checkout options, industry eligibility, fixed-radius rejection, pre-migration rejection, tenant selection and billing audit assertions. The SQL security suite runs in a rollback transaction and additionally tests database price/radius constraints, fixed coverage, cross-company writes and the migration audit.

Local SQL validation used a disposable PostgreSQL 17 Supabase container. Supabase Auth/Storage schemas were loaded without data; two dummy auth users were created. Historical migrations expect quarantined public tables/functions and the externally provisioned `bridge_ai_app` role: minimal legacy stubs and the role were provided in this disposable environment. These bootstrap accommodations are not production changes.

Production advisors were inspected read-only. Existing findings: leaked-password protection disabled, unused indexes and multiple permissive policies. No policies or authentication settings are changed by this release. See [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) and [policy performance guidance](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).
