import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("security foundation static controls", () => {
  it("contains no custom password or session implementation", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).not.toMatch(
      /passwordHash|AuthSession|PasswordResetToken|failedLoginAttempts/,
    );
    expect(read("app/api/auth/login/route.ts")).toContain("signInWithPassword");
    expect(read("app/api/auth/reset-password/route.ts")).toContain(
      "updateUser",
    );
  });

  it("keeps service secrets out of client components", () => {
    const files = globSync("{app,components,lib}/**/*.{ts,tsx}");
    for (const file of files) {
      const source = read(file);
      if (source.includes('"use client"') || source.includes("'use client'")) {
        expect(source, file).not.toMatch(
          /SUPABASE_SECRET_KEY|service_role|POSTGRES_|PII_ENCRYPTION|OPENAI_API_KEY|META_WHATSAPP/,
        );
      }
    }
  });

  it("re-verifies Supabase identity outside an explicit database scope", () => {
    const source = read("lib/db.ts");
    expect(source).toContain("supabase.auth.getUser()");
    expect(source).not.toContain("enterDatabaseIdentity");
  });

  it("does not fan out RLS-scoped Prisma work across the small production pool", () => {
    const files = globSync("{app,lib}/**/*.{ts,tsx}");
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toMatch(/Promise\.all\([\s\S]{0,4000}prisma\./);
    }
  });

  it("marks replacement bytes pending before the private Storage upsert", () => {
    const source = read("app/api/uploads/logo/route.ts");
    const pendingMetadata = source.indexOf('scanStatus: "PENDING"');
    const storageUpsert = source.indexOf(".upload(storageKey, bytes");
    expect(pendingMetadata).toBeGreaterThan(-1);
    expect(storageUpsert).toBeGreaterThan(pendingMetadata);
    expect(source).toContain('action: "SUPPLIER.LOGO_UPLOAD_FAILED"');
  });

  it("provisions storage, forced RLS and append-only auditing in committed SQL", () => {
    const migration = read(
      "supabase/migrations/20260802183212_security_foundation.sql",
    );
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("bridge-ai-private");
    expect(migration).toContain("audit_append_only");
    expect(migration).toContain("attachment_exactly_one_parent");
    expect(
      read(
        "supabase/migrations/20260802193121_secure_logo_attachment_lifecycle.sql",
      ),
    ).toContain("attachment_company_logo_delete");
    expect(
      read(
        "supabase/migrations/20260802193700_allow_suspended_company_access_revocation.sql",
      ),
    ).toContain("status NOT IN ('SUSPENDED', 'REJECTED')");
  });

  it("does not retain a parallel Prisma migration history", () => {
    expect(globSync("prisma/migrations/**/*.sql")).toHaveLength(0);
    expect(globSync("supabase/migrations/*.sql").length).toBeGreaterThanOrEqual(
      5,
    );
  });
});
