export type JobLifecycleStatus = "SELECTED" | "CONFIRMED" | "COMPLETED" | "CANCELLED_AFTER_SELECTION";

export function isSelectedLifecycleStatus(status: string): status is JobLifecycleStatus {
  return ["SELECTED", "CONFIRMED", "COMPLETED", "CANCELLED_AFTER_SELECTION"].includes(status);
}

export function supplierSelectionNextStep(categorySlug: string, industrySlug?: string | null) {
  const key = `${industrySlug ?? ""} ${categorySlug}`.toLowerCase();
  if (key.includes("window") || key.includes("door") || key.includes("glazing")) return "Arrange the survey and confirm the final specification with the customer.";
  if (key.includes("transport") || key.includes("removal") || key.includes("delivery") || key.includes("van")) return "Confirm the collection, delivery and booking details with the customer.";
  if (key.includes("vehicle") || key.includes("repair")) return "Arrange the inspection or repair booking with the customer.";
  if (key.includes("scaffold")) return "Arrange the site confirmation and erection date with the customer.";
  if (key.includes("plant") || key.includes("hire")) return "Confirm equipment availability, delivery and hire dates with the customer.";
  if (key.includes("concrete")) return "Confirm the final specification and delivery slot with the customer.";
  if (key.includes("flor")) return "Finalise the flowers, quantities and delivery details with the customer.";
  if (key.includes("wedding") || key.includes("event")) return "Contact the customer to finalise the booking.";
  if (key.includes("fabricat") || key.includes("metal") || key.includes("steel")) return "Confirm the drawings and final specification before accepting the order.";
  if (key.includes("home") || key.includes("service")) return "Arrange the visit or work date with the customer.";
  return "Contact the customer and confirm the final order, booking or work arrangements.";
}

export function lifecycleDisplay(status: string) {
  if (status === "SELECTED" || status === "WON") return "Selected";
  if (status === "CONFIRMED") return "Confirmed job";
  if (status === "COMPLETED") return "Completed";
  if (status === "CANCELLED_AFTER_SELECTION") return "Did not proceed";
  return status;
}
