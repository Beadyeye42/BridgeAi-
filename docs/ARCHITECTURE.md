# Bridge AI architecture

## System context

```mermaid
flowchart LR
  Customer["Customer · WhatsApp only"] --> Meta["Meta WhatsApp Cloud API"]
  Meta --> Intake["Verified webhook and intake"]
  Supplier["Supplier browser"] --> Portal["Next.js portal on Vercel"]
  Admin["Administrator browser"] --> Portal
  Portal --> Auth["Supabase Auth"]
  Portal --> DAL["Prisma identity-aware data layer"]
  DAL --> DB[("Supabase PostgreSQL · bridge_ai")]
  Intake --> DB
  Portal --> Storage["Private Supabase Storage"]
  Portal --> Stripe["Stripe Checkout and Billing Portal"]
  Stripe --> BillingHook["Signature-verified billing webhook"]
  BillingHook --> DB
  Auth --> Policies["JWT identity"]
  Policies --> DAL
  Policies --> Storage
```

Customers have no portal profile, credentials or session. `customer_contacts` represents a WhatsApp/channel contact and is never an authentication table.

## Identity and authorisation

Supabase Auth owns credentials, email confirmation, password recovery, cookie refresh and session invalidation. The Next.js proxy refreshes Auth cookies. Protected server code calls `supabase.auth.getUser()` rather than trusting browser session data.

The verified Auth UUID maps to `bridge_ai.portal_profiles.id`, whose database foreign key targets `auth.users.id`. Authorisation is relational:

- Supplier: an active `company_memberships` record determines the company and role.
- Administrator: an active `platform_administrators` record, optionally joined to explicit permissions.
- Customer: no portal identity.

Supplier registration and invitation acceptance use narrow `bridge_private` database functions. Each function verifies the Auth identity/email and atomically creates the profile, tenant relationship and audit entry. No signup metadata can grant administrator access. Administrators are deliberately provisioned through a controlled database migration/runbook, never by a public UI.

## Database isolation

Supabase SQL migrations under `supabase/migrations` are the sole DDL history. Prisma describes and queries the resulting schema but does not own a second migration stream.

All 26 `bridge_ai` tables have RLS enabled and forced. The application database role inherits the Supabase `authenticated` role but does not bypass RLS. For each Prisma operation, the data layer starts a transaction and installs the UUID returned by `getUser()` into transaction-local `request.jwt.claim.sub` and the `authenticated` role claim. Policies then evaluate the same protected identity helpers used by direct Supabase requests. Bootstrap access uses a separate, narrowly scoped function rather than a general RLS bypass.

The tenant chain is:

`auth.users → portal_profiles → company_memberships → supplier_companies → supplier-owned records`

Request access additionally requires a valid supplier assignment. Attachments have exactly one allowed parent and, where supplier-owned, an explicit company parent. Administrators see all application rows only while their protected administrator record is active.

## Invariants and audit

Database constraints and triggers enforce rules that cannot safely depend on UI validation:

- case-insensitive unique email identity;
- one primary membership per user/company and at least one active owner per company;
- positive quantities, non-negative price/budget/radius and valid coverage shapes;
- a request cannot exceed its configurable supplier distribution limit;
- supplier distribution is hard-capped at five, all assignments use the request’s shared deadline, and the `Europe/London` response clock pauses from Friday 15:00 until Monday 08:00;
- assignment state and quotation state/timestamps cannot contradict one another;
- a quote cannot be submitted without an approved company and active membership, only one quote per request can be customer-selected, and accepted status requires both a verified paid fee and matching contact grant;
- attachment size and parent relationships are valid;
- coverage rules have exactly one valid shape: postcode area, a bounded radius with validated coordinates, or nationwide; only one active nationwide rule is allowed per supplier;
- audit records are append-only for normal application and authenticated roles.

Material application mutations write an `audit_logs` row in the same transaction. Sensitive access such as protected attachment download and administrator entry is also audited. Audit entries contain identifiers and safe metadata, not plaintext customer secrets.

## Supplier matching

Assignment is a two-stage fail-closed process. The administrator page lists only suppliers that are approved, have an unexpired active membership, sell the request category, have not already been assigned and match at least one active coverage rule. The assignment API reloads and locks the request, repeats the same eligibility query and coverage calculation, then records the selected match type in the audit entry. Client-supplied supplier IDs are never treated as evidence of eligibility.

Coverage can be a UK postcode area/outward code, a 1–500 mile radius around a depot, or nationwide. Multiple distance rows represent multiple depots. Suppliers can enter a postcode or explicitly grant one-time browser geolocation access. The authenticated server route converts device coordinates to the nearest postcode without persisting the exact device coordinates. Server-side Postcodes.io lookup then validates depot postcodes and stores their WGS84 postcode-centroid coordinates. Request postcodes are resolved without sending customer identity or enquiry content. Radius calculations use the Haversine straight-line distance between postcode centroids, not route distance or drive time. Missing or unavailable coordinates never make a distance rule match; postcode and nationwide rules remain usable.

## Private information and files

Customer phone, email and message values use AES-256-GCM with a ciphertext version prefix. Blind indexes allow exact lookup without searchable plaintext. Supplier DTOs disclose only the request data needed to quote.

The Meta webhook boundary validates the verification token for subscription setup and checks `X-Hub-Signature-256` against the exact request bytes before JSON parsing. Requests are size/operation bounded. A SHA-256 body digest and Meta message IDs provide replay protection. Contact profile names, phone values and supported message content are encrypted inside the same transaction that creates append-only audit records. `WebhookEvent.payload` contains only a PII-free operational summary; raw webhook bodies are not retained. Failed processing is recorded with a coarse internal code so Meta can retry without sensitive error text entering logs or tables.

The `bridge-ai-private` Storage bucket is private and migration-provisioned. Policies require object keys beneath `companies/<company-id>/...` and verify active membership or protected administrator status. Database attachment metadata holds ownership, MIME/size/checksum and malware scan state. Downloads require authorisation and a `CLEAN` scan state, then receive a short-lived signed URL. A production scanner worker must be implemented before untrusted uploads are generally enabled.

## Billing and contact release

The recurring supplier membership is £5/month. A quote selected by the customer enters `SELECTED_PENDING_PAYMENT`; it is not called won and no customer contact data is released. The supplier receives two active business hours to pay the fixed £25 success fee. The same Europe/London weekend clock applies, and a protected Vercel cron expires missed windows.

Stripe card data never enters Bridge AI. Checkout redirects are presentation only. The raw-body Stripe webhook verifies its signature before parsing or writing, stores only a sanitized idempotency record, and is the sole payment authority. An on-time payment atomically marks the fee paid, creates a company-scoped `ContactAccessGrant`, accepts the quotation, rejects remaining submitted quotes, closes the request as won, notifies the supplier and writes audit entries. Suppliers still cannot read `CustomerContact` through the Supabase Data API: a reviewed server helper verifies the RLS-visible grant, decrypts only the minimum fields and audits every view. Late captured payments keep contact locked and create a critical refund-review event.

## Runtime and deployment boundaries

Prisma runtime traffic uses the Supavisor transaction pooler. Migrations use the direct/session connection through the Supabase CLI. The Supabase URL and publishable key are browser-safe by design; the secret key, database URIs, encryption keys, WhatsApp keys, AI keys and payment keys must never reach client bundles.

Auth site URLs, redirect allow-lists, production SMTP, email templates, abuse protection and leaked-password screening are Supabase project settings and must be verified separately for every environment.

All HTML responses receive a restrictive baseline content-security policy, clickjacking protection, MIME sniffing protection, a limited referrer policy and a permissions policy. Production additionally requires an HTTPS `APP_URL` and sends HSTS. Auth email redirects fail closed when the production origin is missing or invalid.
