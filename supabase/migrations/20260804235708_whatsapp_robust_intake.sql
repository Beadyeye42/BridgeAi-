-- Store AI-derived file context encrypted. The original upload remains in the
-- private bucket and keeps its independent malware-scan status.
ALTER TABLE bridge_ai."Attachment"
  ADD COLUMN "aiSummaryEncrypted" bytea,
  ADD COLUMN "aiAnalyzedAt" timestamptz,
  ADD COLUMN "aiAnalysisModel" text,
  ADD COLUMN "aiResponseIdHash" text;

ALTER TABLE bridge_ai."Attachment"
  ADD CONSTRAINT attachment_ai_analysis_complete CHECK (
    (
      "aiSummaryEncrypted" IS NULL
      AND "aiAnalyzedAt" IS NULL
      AND "aiAnalysisModel" IS NULL
      AND "aiResponseIdHash" IS NULL
    )
    OR (
      "aiSummaryEncrypted" IS NOT NULL
      AND "aiAnalyzedAt" IS NOT NULL
      AND length(trim("aiAnalysisModel")) BETWEEN 1 AND 120
      AND "aiResponseIdHash" ~ '^[a-f0-9]{64}$'
    )
  );
