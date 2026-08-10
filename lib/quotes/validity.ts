export const DEFAULT_QUOTATION_VALIDITY_DAYS = 7;

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;

export function minimumQuotationValidUntil(submittedAt: Date) {
  return new Date(submittedAt.getTime() + DEFAULT_QUOTATION_VALIDITY_DAYS * DAY_MILLISECONDS);
}

export function quotationValidUntil(submittedAt: Date, requested: Date | null | undefined) {
  const minimum = minimumQuotationValidUntil(submittedAt);
  return requested && requested > minimum ? requested : minimum;
}
