# Supabase security baseline

This document records the implemented baseline. It supersedes the earlier server-only/no-RLS design.

## Migration authority

`supabase/migrations` is the only database migration authority. The connected project and repository contain the same 15 migration versions. The six `202607...` files are migration-history reconciliation stubs: they intentionally do not recreate the obsolete insecure `public` design on a fresh project. The live legacy objects/data were preserved, stripped of privileged execution paths and quarantined behind deny-all policies. Do not replace these files with the old SQL or delete the history entries.

The `20260802183212_security_foundation.sql` migration establishes the current schema and baseline. Subsequent migrations install the application RLS role/context, secure invitation acceptance, cross-row authorisation invariants and advisor cleanup.

## RLS and privileges

- 24 of 24 Bridge AI tables have `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
- The baseline installs 54 application policies plus four `storage.objects` policies across supplier, administrator, reference-data, notification, audit and file paths.
- `anon` has no application-table privileges. The application role is subject to policies as `authenticated` and has no `BYPASSRLS` attribute.
- Policy helper functions live in the non-exposed `bridge_private` schema, set a fixed search path and are not generally executable.
- Supplier access requires an active membership and the relevant company/request relationship. Suspension or removal immediately makes policies fail.
- Administrator access requires an active row in `platform_administrators`; Auth/user metadata alone has no authority.

The Next.js data layer installs only an ID already verified by Supabase `getUser()` and uses transaction-local settings to prevent identity leakage through pooled connections. Never set RLS identity from request body, query-string or user-editable metadata.

## Storage

The `bridge-ai-private` bucket is non-public and has size/MIME restrictions. Objects use `companies/<company-uuid>/...` paths. Storage policies validate the path company against active membership or protected administrator status for each operation. The application does not create buckets lazily and does not use a service key for ordinary supplier downloads. Supplier logos use a deterministic object key for upsert, immutable metadata replacement, an explicit logo-only delete policy and a `CLEAN` scanner-state gate before download.

## Administrator provisioning

There is intentionally no self-service admin promotion. To provision one, first create/verify the person through Supabase Auth, then use a reviewed SQL migration executed by an authorised operator to:

1. insert the matching `portal_profiles` row if absent;
2. insert an active `platform_administrators` row referencing that profile;
3. optionally insert only the required `administrator_permissions` rows;
4. append an `audit_logs` entry naming the authorised operator/change reference.

Deactivation is performed by setting the protected administrator record inactive, not by editing Auth metadata. Use a second reviewer for production changes.

## Key rotation

Ciphertexts start with `BA`, a one-byte key version, then the AES-GCM IV, tag and ciphertext. Legacy unversioned ciphertexts are interpreted as version 1.

Safe rotation procedure:

1. Generate `PII_ENCRYPTION_KEY_V2` and deploy it to every runtime while retaining V1.
2. Update the application’s current write version only after both keys are available everywhere.
3. Re-encrypt old rows to V2 in small, restartable batches and record progress without logging plaintext.
4. Verify no V1/unversioned payload remains, including delayed jobs and retained operational data.
5. Retain V1 for the agreed backup/rollback window; retire it only after restore tests prove V2 is available.

Blind-index key rotation requires dual indexes and a controlled rebuild because it is not decryptable. Never reuse an encryption key as a blind-index secret.

## Verification

`tests/sql/security_integration.sql` is an adversarial transaction/rollback suite. It verifies cross-company read/write denial, Storage isolation, protected membership roles, append-only audit data, protected admin bypass, immediate suspension, case-insensitive uniqueness, primary-membership and numeric constraints, distribution limits, attachment ownership, consistent assignment/quotation state, and revoked execution on legacy privileged functions.

The unit/static suite additionally rejects custom password/session implementations, client-side secret references, missing RLS/Storage/audit migration primitives and Prisma SQL migration files.

## Advisor status and release limitations

After the live browser and Storage exercise, the Supabase security advisor still reports exactly one project-level warning and no missing-RLS/exposed-table warning: leaked-password protection is disabled. The connected project is on the Free plan and the dashboard identifies this control as Pro-only. A paid-plan change needs explicit owner authorisation; until then the warning cannot be cleared and `security-baseline-v1` must not be created. See [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

The performance advisor reports 40 overlapping-permissive-policy notices and 37 unused-index notices. The overlaps are deliberate readable separation of tenant and administrator paths; they can be consolidated after policy equivalence testing. Unused-index notices are expected before representative production traffic exists. Reassess both from query statistics after launch: [multiple permissive policies](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies), [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

Before production release, independently verify Auth site/redirect URLs, confirmation and recovery email templates, production SMTP, CAPTCHA/rate limits, and MFA enrolment/recovery UX. The schema and authorisation model are MFA-ready because they rely on verified Supabase identities, but MFA is not currently enforced.
