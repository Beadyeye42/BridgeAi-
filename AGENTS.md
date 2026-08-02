# Bridge AI contributor guide

## Product and identity boundaries

- Customers never receive portal accounts. Customer interactions enter only through trusted server-side WhatsApp ingestion.
- Supabase Auth is the sole credential/session/recovery authority. Do not add password hashes, reset tokens or application session tables.
- A supplier needs an active `company_memberships` row. Resolve its company from the verified identity; never accept tenant authority from the client.
- An administrator needs an active `platform_administrators` row. Never infer administrator status from email, Auth metadata or client state.
- Customer contact and message values remain encrypted. Expose only the minimum request context required for a supplier to quote.
- Every material authentication, supplier, membership, assignment, quotation, subscription and administrative change must append an audit record in the same transaction.

## Database conventions

- Supabase SQL under `supabase/migrations` is the only DDL/migration authority. Do not create Prisma migration SQL.
- Keep Prisma models synchronized with the applied schema and regenerate the client after model changes.
- All application tables must keep RLS enabled and forced. New tables require least-privilege policies and adversarial tenant tests in the same change.
- Server-side Prisma calls must run through the identity-aware data layer. `trustedPrisma` is limited to reviewed bootstrap functions and must not become a general policy bypass.
- Keep policy helpers in `bridge_private`, with fixed search paths and restricted execution privileges.
- Enforce cross-row security/business invariants in PostgreSQL, not only Zod or UI code.

## Application conventions

- Use App Router server components by default and client components only for interactive UI.
- Validate all untrusted input with Zod at the server boundary.
- Authorise with Supabase `getUser()` on the server; do not trust unverified session payloads.
- Store bytes in private Supabase Storage and metadata/opaque keys in PostgreSQL. Company-owned object keys must remain under `companies/<company-id>/...`.
- Require an authorised record and clean scan state before returning a short-lived signed URL.
- Keep Meta, OpenAI, Stripe, Supabase secret, encryption and database values server-only. Only the Supabase URL and publishable key may use `NEXT_PUBLIC_`.
- Do not present unavailable integration work or demonstration state as persisted functionality.

## Required checks

Before publishing, run:

```text
npm test
npm run typecheck
npm run lint
npx prisma validate
npm run build
npm audit --audit-level=low
```

For database/security changes, also compare Supabase migration history, run `tests/sql/security_integration.sql` in a rollback transaction, and inspect both Supabase security and performance advisors. Add an audit assertion and a cross-tenant denial test for every new material write path.
