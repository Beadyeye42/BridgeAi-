# Bridge AI

Bridge AI is an AI-powered WhatsApp procurement platform owned by Ironbridge Group Ltd. Customers communicate only through WhatsApp. Approved suppliers and Bridge AI administrators use this Next.js portal to distribute enquiries, submit quotations and operate the marketplace.

This repository is the security foundation for the first supplier-portal release. Authentication is owned by Supabase Auth, application data is isolated with PostgreSQL row-level security (RLS), files are kept in a private Supabase Storage bucket, and Prisma remains the typed server-side data layer.

## Security model

- Customers never have portal identities. Their contact values and message content are encrypted at rest and exposed to suppliers only when required to quote.
- Supabase Auth is the sole password, session, email-verification and password-recovery authority. There are no application password hashes, session-token tables or reset-token tables.
- A portal identity is an `auth.users` row plus a `bridge_ai.portal_profiles` row. Supplier access requires an active `bridge_ai.company_memberships` row. Administrator access requires an active `bridge_ai.platform_administrators` row; user metadata is not an authority.
- All 24 application tables have RLS enabled and forced. Server-side Prisma transactions install the verified Auth user ID as a transaction-local Postgres claim, so application SQL is subject to the same policies.
- Supplier records are isolated by company. Suspension/removal immediately removes membership-based access. Administrator policies require a protected database record.
- Important writes create append-only audit records. Database triggers enforce cross-row invariants such as the request distribution limit, quotation/assignment consistency and the requirement for an active company owner.
- Storage is private. Object keys are company-prefixed (`companies/<company-id>/...`) and Storage RLS checks active membership or protected administrator status.
- Secrets, database credentials and Meta/AI/payment keys are server-only. Only the Supabase URL and publishable key may use `NEXT_PUBLIC_` names.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SUPABASE_SECURITY.md](docs/SUPABASE_SECURITY.md), and [SECURITY_REMEDIATION_REPORT.md](SECURITY_REMEDIATION_REPORT.md) for the design and verification evidence.

## Stack

- Next.js 16 App Router, React 19, TypeScript and Tailwind CSS 4
- Supabase Auth, PostgreSQL and private Storage
- Prisma ORM 6
- Zod and Vitest
- Vercel Node.js runtime

## Local development

Prerequisites: Node.js 22+, npm, the Supabase CLI, and access to the intended Supabase project.

1. Run `npm install`.
2. Copy `.env.example` to `.env.local` and fill in the project-specific values.
3. Generate independent encryption and blind-index secrets. Keep the transaction-pooler and direct database URLs server-only.
4. Run `npm run db:generate`.
5. Link the CLI to the correct Supabase project, review the pending SQL, then run `npm run db:deploy`. Supabase SQL files under `supabase/migrations` are the only migration authority; do not create Prisma SQL migrations.
6. Run `npm run dev`.

Development seeding is intentionally opt-in. Set `ALLOW_DEVELOPMENT_SEED=true`, `SEED_SUPPLIER_EMAIL` and `SEED_SUPPLIER_PASSWORD`, then run `npm run db:seed`. The seed creates a real, confirmed Supabase Auth user and its supplier tenant. It always refuses to run in production and contains no default credentials.

Configure the Supabase Auth site URL and redirect allow-list for `/auth/callback`, and configure production SMTP and email templates before release. Password recovery uses Supabase email delivery; the old Resend application mailer is not an authentication authority.

## Commands

- `npm run dev` — start local development
- `npm run build` — generate Prisma Client and build for production
- `npm test` — unit and static security tests
- `npm run typecheck` — TypeScript checks
- `npm run lint` — lint the repository
- `npm run db:generate` — regenerate Prisma Client
- `npm run db:migrate` — create a timestamped Supabase migration
- `npm run db:deploy` — apply committed Supabase migrations
- `npm run db:status` — compare local and remote Supabase migration history
- `npm run db:seed` — create an explicitly configured development supplier
- `npm run db:studio` — inspect data with Prisma Studio

The live adversarial SQL suite is [tests/sql/security_integration.sql](tests/sql/security_integration.sql). Run it in a controlled database transaction against a non-production environment; it rolls its fixtures back.

## Vercel deployment

1. Connect the repository and Supabase project to Vercel.
2. Supply all variables documented in `.env.example` using Vercel encrypted environment settings.
3. Apply reviewed Supabase migrations from a controlled release job before promoting the application deployment.
4. Use the default `npm run build` build command.

External malware scanning, production WhatsApp ingestion/AI orchestration and Stripe billing remain integration work. The application does not present those boundaries as completed functionality.
