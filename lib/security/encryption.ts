import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const MAGIC = Buffer.from("BA");
const CURRENT_KEY_VERSION = 1;

function encryptionKey(version = CURRENT_KEY_VERSION) {
  const encoded = process.env[`PII_ENCRYPTION_KEY_V${version}`] ?? (version === 1 ? process.env.PII_ENCRYPTION_KEY : undefined);
  if (!encoded) throw new Error(`PII_ENCRYPTION_KEY_V${version} is required`);
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("PII_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
}

export function encryptPrivateValue(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([MAGIC, Buffer.from([CURRENT_KEY_VERSION]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptPrivateValue(payload: Uint8Array) {
  const buffer = Buffer.from(payload);
  const versioned = buffer.subarray(0, 2).equals(MAGIC);
  const version = versioned ? buffer[2] : 1;
  const offset = versioned ? 3 : 0;
  const iv = buffer.subarray(offset, offset + 12);
  const authTag = buffer.subarray(offset + 12, offset + 28);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(version), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(buffer.subarray(offset + 28)), decipher.final()]).toString("utf8");
}

export function blindIndex(value: string) {
  const secret = process.env.PII_BLIND_INDEX_KEY;
  if (!secret) throw new Error("PII_BLIND_INDEX_KEY is required");
  return createHash("sha256").update(`${secret}:${value.trim().toLowerCase()}`).digest("hex");
}
