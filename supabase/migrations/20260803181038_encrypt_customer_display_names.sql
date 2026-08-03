-- Customer data has not entered the secure schema yet. Fail rather than
-- silently orphaning an existing blind index or dropping a plaintext name.
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM bridge_ai."CustomerContact") THEN
    RAISE EXCEPTION
      'CustomerContact must be empty before the encrypted-name/HMAC-index baseline is applied';
  END IF;
END
$migration$;

ALTER TABLE bridge_ai."CustomerContact"
  DROP COLUMN "displayName",
  ADD COLUMN "displayNameEncrypted" BYTEA;

COMMENT ON COLUMN bridge_ai."CustomerContact"."displayNameEncrypted" IS
  'AES-256-GCM ciphertext produced by the server-only PII encryption service';
