# Bridge-iT

Bridge-iT is an AI-powered WhatsApp procurement platform owned by Ironbridge Group Ltd. Customers communicate only through WhatsApp. Approved suppliers and Bridge-iT administrators use this Next.js portal to distribute enquiries, submit quotations and operate the marketplace.

This repository is the security foundation for the first supplier-portal release. Authentication is owned by Supabase Auth, application data is isolated with PostgreSQL row-level security (RLS), files are kept in a private Supabase Storage bucket, and Prisma remains the typed server-side data layer.

## Security model

- Customers never have portal identities. Their contact values and message content are encrypted at rest and exposed to suppliers only when required to quote.
- Supabase Auth is the sole password, session, email-verification and password-recovery authority. There are no application password hashes, session-token tables or reset-token tables.
- A portal identity is an `auth.users` row plus a `bridge_ai.portal_profiles` row. Supplier access requires an active `bridge_ai.company_memberships` row. Administrator access requires an active `bridge_ai.platform_administrators` row; user metadata is not an authority.
- All application tables have RLS enabled and forced. Server-side Prisma transactions install the verified Auth user ID as a transaction-local Postgres claim, so application SQL is subject to the same policies. WhatsApp workers use separate transaction-local worker identities with narrowly scoped policies.
- Supplier records are isolated by company. Suspension/removal immediately removes membership-based access. Administrator policies require a protected database record.
- Important writes create append-only audit records. Database triggers enforce cross-row invariants such as the request distribution limit, quotation/assignment consistency and the requirement for an active company owner.
- Product categories are hierarchical industries rather than one flat list. The launched catalogues are Windows, doors and glazing; Plumbing, heating and mechanical (PHE); and Transport, delivery and removals. Suppliers first choose an industry, then activate exact products; the advanced capability screen changes by industry and records the relevant manufacturers, systems, vehicles, service features, lead times and live capacity used by matching.
- Each job normally has no more than three active competing suppliers. Bridge-iT ranks eligible suppliers automatically; a decline or expired invitation can release the slot to the next ranked supplier. The UK response clock pauses at 3:00 pm Friday and resumes at 8:00 am Monday, so weekend time is never consumed.
- Supplier approval requires the legal company name, company address, Companies House number, director's name, company phone and company email. Insurance and accreditation documents are optional and do not block approval or quoting. Automatic matching requires an approved supplier, active geographic membership, exact product capability, current capacity, compatible lead time, fulfilment support and matching service/delivery coverage. There is no public opportunity board or first-come claim flow.
- Geographic membership is database-backed and administrator-configurable: Local Partner defaults to £29.99/month and up to 40 miles/5 live opportunities; Regional Partner to £59.99/month and up to 100 miles/10; Nationwide Partner to £89.99/month and 20. Paying for a wider tier changes geographic eligibility only—it never overrides capability, deadline or capacity checks. Service and delivery coverage are stored separately, while collection uses declared depots, days and notice requirements.
- Meta WhatsApp webhooks use the standard challenge handshake and require a valid `X-Hub-Signature-256` HMAC over the exact request bytes. Accepted events are bounded, idempotent and audited; raw webhook payloads are never persisted.
- WhatsApp AI work is durable and asynchronous. The first reply discloses automation and requires `CONTINUE`; message content is not sent to OpenAI before that consent. OpenAI Structured Outputs update an encrypted draft, while deterministic server rules accept only an explicit confirmation such as `YES` or `CONFIRM` before a quote request is created. OpenAI responses are not retained by the provider request (`store: false`).
- Customer JPG, PNG and PDF files are downloaded only from verified Meta media references, bounded by type and size, checked against their declared checksum and real file signature, then stored under private `customers/<conversation-id>/...` keys with `PENDING` scan status. A server-only vision/document request extracts quote facts; that encrypted summary may guide intake, while the original file remains unavailable to suppliers until a real malware scanner marks it `CLEAN`.
- Submitted supplier quotations enqueue a customer update containing no supplier name or contact data—only price and lead time for at most five quotes. Customer selection accepts simple case-insensitive replies such as `YES`, `ACCEPT` or a displayed quote number. Selection locks the request, closes every losing assignment and quotation, and a database trigger rejects any late quotation submission to a won, lost, expired or cancelled request.
- Supplier billing uses Stripe Checkout with one recurring Stripe Price per active geographic plan. Plan prices, radius limits, live-opportunity limits and VAT behaviour are editable by administrators. Promotions are separate records with eligible plans, price, duration, subscriber cap, dates and existing-subscriber eligibility; Stripe coupons are created server-side when required. Ironbridge Group Ltd is not currently VAT registered, so VAT is disabled by default. There are no lead, introduction, winning, commission or pay-per-quote fees.
- Affiliate accounting is invoice-ledger based. A supplier is permanently attributed at registration, but no earnings are estimated from referral or customer counts. Each successful Stripe subscription invoice creates one immutable commission row, the first successful payment is a zero-value qualification row, and the following twelve successful paid periods earn the configured percentage of actual eligible revenue excluding VAT. Failed or unpaid invoices create no commission. Refunds and disputes create separate negative adjustment rows rather than rewriting the original invoice record, preserving a complete audit trail through cancellations, retries, upgrades and payouts.
- Storage is private. Object keys are company-prefixed (`companies/<company-id>/...`) and Storage RLS checks active membership or protected administrator status.
- Supplier owners and managers can upload private insurance, certification and trade-membership evidence. Documents remain locked while malware scanning is pending; suppliers cannot change review state, and every administrator decision is audited.
- Supplier and administrator dashboards share one approval-readiness checklist. Approval is blocked in both the API and database until company details, categories, coverage, hours, ownership and current evidence are complete.
- The administrator operations centre exposes failed WhatsApp jobs, webhooks, notifications and serious system events. Only idempotent jobs can be retried; uncertain outbound deliveries require manual review, and every retry is audit logged.
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

For WhatsApp, configure Meta’s callback URL as `https://<portal-host>/api/webhooks/meta-whatsapp`, subscribe it to WhatsApp message events, and set independent server-only values for `META_WHATSAPP_VERIFY_TOKEN`, `META_WHATSAPP_APP_SECRET`, `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID` and the tested `META_GRAPH_API_VERSION`. Configure `OPENAI_API_KEY` and `OPENAI_MODEL` only in the server environment. The webhook verifies signatures before parsing, stores an encrypted message and queue item transactionally, responds promptly, then uses Next.js background work for AI/media/outbound calls. Processing is serialised per conversation, rapid customer message bursts are coalesced, and outbound delivery uses stable idempotency records so uncertain retries cannot repeat a reply. The protected `/api/cron/process-whatsapp` route provides recovery processing when invoked with `CRON_SECRET`.

Production monitoring uses a protected database outbox and Resend. Set `MONITORING_ALERT_EMAILS` to one or more comma-separated administrator addresses alongside `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL` and `CRON_SECRET`. Terminal WhatsApp jobs, failed Stripe webhooks, failed or delayed attachment security checks, and attachment storage errors are deduplicated and emailed without customer contact or message contents. Provider delivery uses an idempotency key, failed sends use bounded retries, and `/api/cron/monitor-production` performs a scheduled safety sweep.

Supplier opportunity and winner emails use the same Resend account. A matched-opportunity email is queued atomically only for the selected suppliers when an assignment is created, unless a team member has disabled new-request emails. Winner emails are queued when the customer selects a quotation and respect quotation-update preferences. The shared queue uses locked claims, stable provider idempotency keys and five bounded retries; customer contact details are never put in email and remain behind the authenticated portal. `EMAIL_FROM` must use a sender on a domain verified in Resend.

Bridge-iT defaults to `WHATSAPP_ALLOW_PAID_TEMPLATES=false`. Free-form service replies are sent only inside the rolling 24-hour customer-service window. Each newly submitted supplier quotation refreshes the customer's complete numbered quote list while that window remains open. Outside the window, Bridge-iT uses an approved template only when paid templates have been deliberately enabled; otherwise it records an administrator-visible delivery failure and the customer can reply `QUOTES` to reopen the service window and request the latest list.

Returning WhatsApp customers receive a simple command menu headed “What do you need? Bridge it.” `1` or `NEW QUOTE` starts an isolated intake session, while natural requests such as “another quote for aluminium bifolds” start the new session and retain the product details from that same message. `2` or `MY QUOTES` lists the customer’s five most recent requests without revealing supplier identities or contact details. `HELLO`, `MENU` and `HELP` show the menu without changing or deleting an unsent draft. Customers never choose an industry: AI silently maps their message or file to the most specific launched product category, while unsupported requests are not published. Deterministic readiness rules require WHAT, WHERE, WHEN, quantity, price-critical specification and fulfilment method before confirmation. PHE requests recognise boilers and packages, heat pumps, cylinders, underfloor heating, radiators, pipework, valves and controls, pumps and pressurisation, and mechanical plant packages. Transport requests use a short staged conversation: load/photo and both route postcodes, access at each end, then carrying or loading assistance; dates and only genuinely relevant load constraints follow if still missing. Schedules, schematics and heat-loss calculations are accepted alongside photos, drawings and PDFs; Bridge-iT extracts procurement facts but does not perform engineering design or promise product suitability.

Meta permits free-form replies only inside the rolling 24-hour customer-service window. Create and approve an `en_GB` utility template with two body variables—request reference and the anonymous quote lines—then configure its exact lowercase name in `META_WHATSAPP_QUOTE_TEMPLATE_NAME`. The suggested name is `bridge_ai_quote_update`. Create a second utility template with request reference, supplier name, email and phone variables for `META_WHATSAPP_CONTACT_TEMPLATE_NAME` (suggested `bridge_ai_contact_unlocked`). The code deliberately raises an administrator-visible failure instead of attempting an invalid free-form update outside the window.

For billing, set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, then register `https://<portal-host>/api/webhooks/stripe` for Checkout Session completion, subscription lifecycle, `invoice.paid`, `invoice.payment_failed`, `charge.refunded` and dispute events. The application creates each geographic plan's Stripe Product and immutable recurring Price on first use and stores the provider identifiers. Editing a plan price clears the old mapping so the next checkout creates a replacement Price. Promotion coupons are also generated server-side and never trusted from browser input. The old introductory/standard Price environment variables remain only for already-created legacy founding subscriptions. VAT stays disabled until Ironbridge Group Ltd is VAT registered; update the plan setting, Stripe Tax registration and public wording together if that changes.

Affiliates use `/join?ref=<code>` and a dedicated `/affiliate` portal. Attribution is established atomically when the referred supplier account is created and cannot later be replaced. The protected production-monitoring cron validates matured commission rows, sends affiliate notifications and keeps payout balances derived from ledger entries. Administrators can suspend affiliates, inspect referrals and invoice rows, record manual adjustments as new ledger entries, and generate auditable payout batches. Never replace this design with a calculation such as “commission rate × current subscribers”; the commission ledger is the accounting source of truth.

Coverage postcode validation and radius coordinates use the server-side [Postcodes.io](https://postcodes.io/) lookup API. Suppliers may press “Use my current location” to grant one-time browser location access; the server converts those coordinates to the nearest postcode and Bridge-iT does not persist the exact device coordinates. A supplier has one company geographic origin, preventing multiple radius centres from stretching a Local or Regional entitlement. Customer names, contact details and request content are never sent to the postcode service. Distance matching fails closed when coordinates cannot be validated.

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

WhatsApp media retrieval, encrypted attachment analysis, AI intake, outbound text and quote summaries are implemented, but remain unavailable until the real Meta phone-number ID/permanent access token and OpenAI API key are configured. Malware scanning is still an explicit release dependency: customer media remains private and `PENDING`, so no code claims it has been scanned or exposes it prematurely. Stripe code is complete but checkout remains unavailable until the real Stripe product, keys and webhook endpoint are configured.
