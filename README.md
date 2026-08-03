# Bridge AI

Bridge AI is an AI-powered WhatsApp procurement platform owned by Ironbridge Group Ltd. Customers communicate only through WhatsApp. Approved suppliers and Bridge AI administrators use this Next.js portal to distribute enquiries, submit quotations and operate the marketplace.

This repository is the security foundation for the first supplier-portal release. Authentication is owned by Supabase Auth, application data is isolated with PostgreSQL row-level security (RLS), files are kept in a private Supabase Storage bucket, and Prisma remains the typed server-side data layer.

## Security model

- Customers never have portal identities. Their contact values and message content are encrypted at rest and exposed to suppliers only when required to quote.
- Supabase Auth is the sole password, session, email-verification and password-recovery authority. There are no application password hashes, session-token tables or reset-token tables.
- A portal identity is an `auth.users` row plus a `bridge_ai.portal_profiles` row. Supplier access requires an active `bridge_ai.company_memberships` row. Administrator access requires an active `bridge_ai.platform_administrators` row; user metadata is not an authority.
- All 27 application tables have RLS enabled and forced. Server-side Prisma transactions install the verified Auth user ID as a transaction-local Postgres claim, so application SQL is subject to the same policies.
- Supplier records are isolated by company. Suspension/removal immediately removes membership-based access. Administrator policies require a protected database record.
- Important writes create append-only audit records. Database triggers enforce cross-row invariants such as the request distribution limit, quotation/assignment consistency and the requirement for an active company owner.
- Each job can be distributed to 1–5 suppliers (default 3), and all assigned suppliers share one response deadline. The UK response clock pauses at 3:00 pm Friday and resumes at 8:00 am Monday, so weekend time is never consumed.
- Automatic matching requires an approved supplier, an active £5 membership, the request product category and at least one active coverage rule. Suppliers can choose a postcode area, a 1–500 mile straight-line radius from one or more depot postcodes, or nationwide UK coverage. Distance uses postcode-centroid coordinates from Postcodes.io; it is an eligibility radius, not a driving-time promise. The assignment API repeats the match check transactionally before creating any assignment.
- Meta WhatsApp webhooks use the standard challenge handshake and require a valid `X-Hub-Signature-256` HMAC over the exact request bytes. Accepted events are bounded, idempotent and audited; raw webhook payloads are never persisted.
- Supplier billing uses Stripe Checkout: £5/month membership and a £25 success fee only after the customer selects a quote. Browser redirects never grant access; only a signature-verified, idempotent Stripe webhook can create the tenant-scoped contact-access grant. Unpaid grants expire after two active UK business hours.
- Storage is private. Object keys are company-prefixed (`companies/<company-id>/...`) and Storage RLS checks active membership or protected administrator status.
- Supplier owners and managers can upload private insurance, certification and trade-membership evidence. Documents remain locked while malware scanning is pending; suppliers cannot change review state, and every administrator decision is audited.
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

For WhatsApp intake, configure Meta’s callback URL as `https://<portal-host>/api/webhooks/meta-whatsapp`, subscribe it to WhatsApp message events, and set independent server-only values for `META_WHATSAPP_VERIFY_TOKEN` and `META_WHATSAPP_APP_SECRET`. The route verifies the signature before parsing JSON. Text/captions/location/reply content, phone numbers and profile names are encrypted before storage. Event metadata contains only opaque IDs and counts. Media references are recorded only in memory at intake; downloading/scanning media is deliberately unavailable until a malware-scanning worker is selected and implemented.

For billing, create a recurring £5 GBP Stripe Price and set `STRIPE_MEMBERSHIP_PRICE_ID`, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Register `https://<portal-host>/api/webhooks/stripe` for Checkout Session completion and customer subscription events. Set `CRON_SECRET`; Vercel calls the protected expiry route every 15 minutes. The £25 payment is a one-off Checkout item and contact data remains locked until the verified webhook commits the grant.

Coverage postcode validation and radius coordinates use the server-side [Postcodes.io](https://postcodes.io/) lookup API. Suppliers may press “Use my current location” to grant one-time browser location access; the server converts those coordinates to the nearest postcode and Bridge AI does not persist the exact device coordinates. Customer names, contact details and request content are never included. Postcode-area and nationwide matching continue to work if the coordinate service is temporarily unavailable, while distance matching fails closed with a visible administrator warning.

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

External malware scanning, WhatsApp media retrieval/outbound sending and AI orchestration remain integration work. Stripe code is complete but checkout remains intentionally unavailable until the real Stripe product, keys and webhook endpoint are configured.
