import { BRAND_NAME } from "@/lib/brand";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-mark" aria-label={BRAND_NAME}>
      <span className="brand-glyph" aria-hidden="true"><i /><i /><i /></span>
      {!compact && <span>Bridge-<b>iT</b></span>}
    </div>
  );
}
