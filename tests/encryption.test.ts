import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { blindIndex, decryptPrivateValue, encryptPrivateValue } from "../lib/security/encryption";

describe("private customer data", () => {
  beforeEach(() => { process.env.PII_ENCRYPTION_KEY_V1 = randomBytes(32).toString("base64"); process.env.PII_BLIND_INDEX_KEY = "test-only-blind-index-secret"; });
  afterEach(() => { delete process.env.PII_ENCRYPTION_KEY_V1; delete process.env.PII_BLIND_INDEX_KEY; });

  it("encrypts customer values with authenticated encryption", () => {
    const encrypted = encryptPrivateValue("+447700900142");
    expect(encrypted.subarray(0, 3)).toEqual(Buffer.from([0x42, 0x41, 0x01]));
    expect(encrypted.toString("utf8")).not.toContain("+447700900142");
    expect(decryptPrivateValue(encrypted)).toBe("+447700900142");
  });

  it("can still decrypt legacy unversioned version-one values", async () => {
    const { createCipheriv, randomBytes } = await import("node:crypto");
    const iv = randomBytes(12);
    const key = Buffer.from(process.env.PII_ENCRYPTION_KEY_V1!, "base64");
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update("legacy", "utf8"), cipher.final()]);
    expect(decryptPrivateValue(Buffer.concat([iv, cipher.getAuthTag(), ciphertext]))).toBe("legacy");
  });

  it("creates deterministic blind indexes without returning plaintext", () => {
    expect(blindIndex("CUSTOMER@EXAMPLE.COM")).toBe(blindIndex("customer@example.com"));
    expect(blindIndex("customer@example.com")).not.toContain("customer");
    const first = blindIndex("customer@example.com");
    process.env.PII_BLIND_INDEX_KEY = "a-different-test-only-secret";
    expect(blindIndex("customer@example.com")).not.toBe(first);
  });
});
