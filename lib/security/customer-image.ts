import "server-only";
import sharp from "sharp";

const MAX_INPUT_PIXELS = 40_000_000;
const MAX_OUTPUT_BYTES = 5_000_000;

type CustomerImageMimeType = "image/jpeg" | "image/png";

export type SanitizedCustomerImage = {
  bytes: Uint8Array;
  mimeType: CustomerImageMimeType;
  extension: "jpg" | "png";
};

/**
 * Rebuilds an untrusted customer image from decoded pixels. The generated file
 * contains no source metadata, embedded profiles or trailing source payloads.
 */
export async function sanitizeCustomerImage(
  bytes: Uint8Array,
  mimeType: CustomerImageMimeType,
): Promise<SanitizedCustomerImage> {
  let pipeline = sharp(Buffer.from(bytes), {
    failOn: "warning",
    limitInputPixels: MAX_INPUT_PIXELS,
    limitInputChannels: 4,
    sequentialRead: true,
    autoOrient: true,
  });

  pipeline = mimeType === "image/jpeg"
    ? pipeline.jpeg({ quality: 88, chromaSubsampling: "4:4:4", mozjpeg: true })
    : pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });

  let output: Buffer;
  try {
    output = await pipeline.toBuffer();
  } catch {
    throw new Error("CUSTOMER_IMAGE_SANITIZE_FAILED");
  }

  if (output.byteLength === 0 || output.byteLength > MAX_OUTPUT_BYTES) {
    throw new Error("CUSTOMER_IMAGE_SANITIZED_TOO_LARGE");
  }

  return {
    bytes: new Uint8Array(output),
    mimeType,
    extension: mimeType === "image/jpeg" ? "jpg" : "png",
  };
}
