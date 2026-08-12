# Bridge-iT security-foundation remediation report

Date: 2 August 2026  
Supabase project: `dhsdjckobidmsfxmblea` (`eu-west-2`)

## Outcome

Feature work was paused and the authentication, database, tenancy, audit and Storage foundations were replaced with a Supabase-native security model. The application builds successfully against the new model and the live adversarial database suite passes in a rolled-back transaction.

Release decision: **blocked from security-baseline tagging**. The connected Supabase project is on the Free plan, while leaked-password protection is a Pro-plan control. The security advisor therefore still reports one warning. The final password-changing action in the recovery journey also awaits an authorised human submission.

## Implemented changes

### Authentication and roles

- Replaced application password hashing, lockout, bearer-session and reset-token storage with Supabase Auth.
- Added server/browser Supabase clients, cookie refresh proxy and Auth callback exchange.
- Login, confirmed-email registration, recovery, password update and global logout use Supabase APIs.
- Portal profiles use the Supabase Auth UUID. Supplier authority comes from active company membership; administrator authority comes only from a protected administrator table.
- Registration and invitation acceptance use restricted atomic database functions and produce audit entries.
- Removed the legacy auth models and code. The password UI minimum is eight characters; the requested six-character minimum was not retained because it weakens the security baseline.

### Database and tenancy

- Made the 15 committed Supabase SQL versions the sole migration history and removed Prisma SQL migration authority.
- Rebuilt the Bridge-iT schema as 24 RLS-enabled and RLS-forced tables with 54 application policies plus four Storage policies.
- Added an identity-aware Prisma execution layer that installs only a server-verified Auth UUID transaction-locally and remains subject to RLS.
- Enforced company isolation, request-assignment access, protected administrator access and immediate denial for suspended/removed membership.
- Added uniqueness, numeric/range, attachment-parent, distribution, date and state-consistency constraints plus deferred active-owner protection.
- Added required foreign-key indexes.

### Audit, privacy and files

- Made audit records append-only for application/authenticated roles and audited sensitive admin/file access.
- Versioned AES-256-GCM ciphertexts while retaining read compatibility for legacy V1 values. Documented safe rotation.
- Provisioned a private, restricted Storage bucket through migration. Company-prefixed object policies enforce tenant access; ordinary downloads no longer use an administrative key.
- Added an application-backed supplier-logo lifecycle with private upload, scan-gated read, deterministic upsert and audited delete. Suppliers may replace immutable logo metadata without gaining authority over scanner state.
- Preserved legacy public data but removed privileged function execution and placed old objects behind deny-all quarantine policies.
- Replaced known seed credentials with explicit environment inputs, real Supabase Auth user creation, cleanup on failure and a production hard stop.

## Verification evidence

- Live catalog: 24/24 Bridge-iT tables have RLS enabled and forced; 54 application policies plus four Storage policies; zero custom password/session/reset tables; private Storage bucket.
- Live adversarial SQL suite: passed and rolled back. It covers cross-company select/update/insert, membership escalation, Storage access, audit mutation, fake administrator access, suspension, uniqueness/primary membership, numeric/radius/distribution/attachment constraints, assignment/quotation invariants and legacy function execution.
- Disposable browser Auth journey: registration, delivered confirmation email, callback confirmation, login, logout, cookie persistence in a second tab, protected-route redirect, recovery request, valid recovery callback and invalid/expired callback behaviour passed. The final password mutation is intentionally awaiting authorised human submission.
- Private Storage through the real application: upload, scan-gated read/download, replace/upsert, delete, cross-company not-found denial and suspended-user forbidden denial passed. Disposable bytes and the cross-company fixture were removed after testing.
- Browser testing exposed and remediated an identity-scope continuation issue, a production-pool concurrency timeout, an over-restrictive active-owner invariant during company suspension and missing logo-metadata delete authority.
- Application tests: 37 tests across five files passed after the live findings were remediated.
- TypeScript, ESLint, Prisma validation and the Next.js production build passed during remediation.
- Dependency audit was remediated to zero known npm vulnerabilities during the review.
- Security advisor: one remaining project setting warning (`auth_leaked_password_protection`); no missing-RLS or exposed-table finding.
- Performance advisor: 37 unused-index notices (no representative workload yet) and 40 multiple-permissive-policy notices (separate tenant/admin paths). Missing-FK and legacy policy initialization findings were remediated.

## Migration reconciliation

The local and connected migration histories contain the same 15 versions. The six `202607...` local files are intentionally documented no-op reconciliation files. They retain the remote history while ensuring a fresh deployment cannot recreate the obsolete public schema. Existing legacy live data was not destructively deleted; its access paths were quarantined. The nine `202608...` migrations establish and harden Bridge-iT.

## Required release follow-ups

These items remain open and must not be represented as complete:

1. Upgrade/authorise the Supabase plan change, enable leaked-password screening, and confirm the security advisor clears: [password security guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Do not tag the baseline while this warning remains.
2. Verify Auth site URL/redirect allow-list, confirmation and recovery templates, production SMTP, rate limits and CAPTCHA in every release environment.
3. Implement and test MFA enrolment, recovery and enforcement policy if required. The database authority model is ready for verified Supabase Auth sessions, but MFA is not enforced today.
4. Complete the final password update through the already-validated recovery UI as an authorised human action, then verify old-password denial and new-password login before deleting the disposable Auth identity.
5. Implement the malware-scanner worker before generally enabling untrusted uploads. The live application correctly withheld a pending object and served it only after the scanner-state fixture was changed to `CLEAN`; the scanner worker itself is not implemented.
6. Reassess overlapping policies and unused indexes after representative query statistics exist. Any policy consolidation requires the same adversarial tests.

No production administrator is auto-provisioned. Follow the reviewed, audited runbook in `docs/SUPABASE_SECURITY.md` for deliberate administrator creation.
