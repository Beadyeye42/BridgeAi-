export function money(pence: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(pence / 100);
}

export function affiliateStatusLabel(status: string) {
  return status.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
