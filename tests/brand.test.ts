import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_NAME, LEGAL_OWNER_NAME } from "../lib/brand";

describe("Bridge-iT brand safeguards", () => {
  it("keeps the trading brand separate from the legal owner", () => {
    expect(BRAND_NAME).toBe("Bridge-iT");
    expect(LEGAL_OWNER_NAME).toBe("Ironbridge Group Ltd");
  });

  it("does not reintroduce the former name on critical public surfaces", () => {
    const publicFiles = [
      "app/layout.tsx",
      "app/page.tsx",
      "components/brand-mark.tsx",
      "lib/email.ts",
      "lib/notifications/affiliate-invitation-email.ts",
      "lib/notifications/winner-email.ts",
      "lib/whatsapp/policy.ts",
    ];

    for (const file of publicFiles) {
      const contents = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(contents, file).not.toContain("Bridge AI");
    }
  });
});
