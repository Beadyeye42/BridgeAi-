export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-mark" aria-label="Bridge AI">
      <span className="brand-glyph" aria-hidden="true"><i /><i /><i /></span>
      {!compact && <span>Bridge <b>AI</b></span>}
    </div>
  );
}
