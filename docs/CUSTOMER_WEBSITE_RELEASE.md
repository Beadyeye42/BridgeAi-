# Customer website release — 11 September 2026

## Scope

- Customer-first homepage, WhatsApp request action and returning Buyer Hub access.
- Dedicated supplier explanation, public membership pricing and public support pages.
- Responsive shared navigation/footer and precise approval, privacy and selection explanations.
- Existing membership charges, matching logic, authentication, payments, WhatsApp processing and database policies are unchanged.
- Dependency updates resolve the five findings reported by the release dependency audit.

Public pricing uses a fixed, read-only transaction selecting active membership plans and an explicit public-field projection. It does not accept a caller-supplied identity, grant an authenticated/worker context, expose payment-provider IDs or export a general public database callback. Existing RLS remains enabled and forced. If pricing cannot load, the page displays an explicit unavailable message rather than stale prices.

## Verification

- 601 tests across 71 files passed, including three executable public-pricing boundary tests.
- Typecheck, Prisma validation, production build and `git diff --check` passed.
- ESLint passed with no errors; one pre-existing warning remains for full-page navigation in `components/auth/logout-button.tsx`.
- `npm audit --audit-level=low` reports zero dependency vulnerabilities.
- Vercel preview built successfully. Hosted pricing returned all five active plans at £0.00, £14.99, £29.99, £59.99 and £89.99 without a supplier session.
- Desktop and 390px phone layouts reviewed; phone navigation and FAQ interaction exercised. Buyer login and supplier registration entry pages checked without submitting forms.
- The 118 applied migration versions match the repository filenames. No migration was added or applied in this release.

## Verification limits and existing notices

The SQL rollback integration suite could not be rerun on this host: no disposable PostgreSQL/Docker runtime is available, and local production environment exports mask database credentials. The existing suite is intended for an isolated test database, not real customer records. It was last recorded as passing in the 7 September security release. The new public read was additionally verified against the hosted runtime; no database write path or policy changed.

No real customer messages, supplier applications, login messages or payment transactions were submitted. This release is not a claim of full authenticated WhatsApp/Stripe end-to-end testing.

Supabase advisors retain the same notices recorded in the previous release: [leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [104 multiple-permissive-policy findings](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies), and [63 unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). Those configuration/performance items were not changed as part of this website update.

Previous production deployment for application rollback: `dpl_AuwxhkNjfHi7g1HogJ4WNTAP65eR` (commit `6af5610`).
