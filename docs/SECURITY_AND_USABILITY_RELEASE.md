# Security and usability release — 7 September 2026

The release saves quote-notification jobs atomically with quotation versions, reserves buyer login attempts under database locks before generating magic links, and limits the bytes actually received by buyer login endpoints. The membership page includes a coverage editor and clear free-plan prerequisites; supplier dashboards explain empty request and quotation states.

## Migration reconciliation

The 114 production migration records were compared with repository SQL. 100 match after removing comments/whitespace (including the differently named fallback enum migration). Fourteen reviewed historical differences are recorded with SHA-256 digests in `audit/migration-reconciliation-2026-09-07.json`: six intentional retired-schema no-ops, three legacy-object bootstrap guards, one conditional role grant and four changes superseded by subsequent corrective migrations. Only 52 local filenames were renamed; production history and historical SQL were not rewritten. All migrations replayed successfully in production timestamp order into disposable Supabase PostgreSQL 17.

All four new migrations were applied successfully to production on 7 September 2026 at 14:18–14:19 UTC. Local filenames now use the versions recorded by Supabase: 20260907141854, 20260907141907, 20260907141908 and 20260907141912. Migration SQL was unchanged. Production contains 118 migrations, the free plan is £0 within two miles, both new triggers are installed, and all application tables retain enabled and forced RLS. Never replay historical migrations with `--include-all`. Recheck production history immediately before deployment because another branch may introduce its own migrations.

## Rollout

This work is based on PR #54 and includes audit PR #52. PR #53 contains an incompatible alternative pricing design; do not merge both pricing migrations. The retained design offers a separate free two-mile plan and existing paid ten-mile plan.

Apply new migrations before deploying the application. The notification trigger uses the same idempotency keys as the older enqueue function, allowing both application versions during rollout without duplicate job rows. Existing jobs are not replayed. Roll back application code if needed while retaining the additive database protections.

## Remaining external work

General PDF/evidence scanning requires a configured malware scanner and an operational worker. Pending files remain inaccessible. Leaked-password protection is disabled and requires Supabase Pro or above; the project is currently on Free. Live authenticated browser tests and Stripe/WhatsApp sandbox journeys remain required before claiming full end-to-end verification. Tests must never send messages to actual customers.

Release verification: 598 tests, typecheck, lint, Prisma validation, build and dependency audit passed before publication. The SQL rollback suite and concurrent-login test passed in disposable PostgreSQL. Post-migration advisors report the existing leaked-password warning, 104 multiple-permissive-policy notices and 63 unused indexes (including the newly created plan-tier index). Application rollout follows through PR #55 into main. Previous production deployment for application rollback: dpl_A6SZeEiJ4apr7ddmS5dmgo9MJNxZ (ea3c881).
