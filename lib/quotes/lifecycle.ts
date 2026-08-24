export type JobLifecycleStatus = "SELECTED" | "CONFIRMED" | "COMPLETED" | "CANCELLED_AFTER_SELECTION";

export function isSelectedLifecycleStatus(status: string): status is JobLifecycleStatus {
  return ["SELECTED", "CONFIRMED", "COMPLETED", "CANCELLED_AFTER_SELECTION"].includes(status);
}

export function lifecycleDisplay(status: string) {
  if (status === "SELECTED" || status === "WON") return "Selected";
  if (status === "CONFIRMED") return "Confirmed job";
  if (status === "COMPLETED") return "Completed";
  if (status === "CANCELLED_AFTER_SELECTION") return "Did not proceed";
  return status;
}
