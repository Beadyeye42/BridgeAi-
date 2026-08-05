import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { sanitizeCustomerImage } from "@/lib/security/customer-image";

describe("customer image sanitisation", () => {
  it("rebuilds JPEG files from pixels and removes trailing source payloads", async () => {
    const original = await sharp({
      create: { width: 24, height: 16, channels: 3, background: { r: 32, g: 96, b: 64 } },
    }).jpeg().toBuffer();
    const marker = Buffer.from("UNTRUSTED_TRAILING_PAYLOAD");
    const input = Buffer.concat([original, marker]);

    const sanitized = await sanitizeCustomerImage(input, "image/jpeg");
    const metadata = await sharp(sanitized.bytes).metadata();

    expect(sanitized.mimeType).toBe("image/jpeg");
    expect(sanitized.extension).toBe("jpg");
    expect(metadata.width).toBe(24);
    expect(metadata.height).toBe(16);
    expect(Buffer.from(sanitized.bytes).includes(marker)).toBe(false);
  });

  it("rejects data that cannot be decoded as the declared image type", async () => {
    await expect(sanitizeCustomerImage(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg"))
      .rejects.toThrow("CUSTOMER_IMAGE_SANITIZE_FAILED");
  });
});
