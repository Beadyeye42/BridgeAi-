"use client";

import { useEffect } from "react";

export function AssignmentViewTracker({ assignmentId, status }: { assignmentId: string; status: string }) {
  useEffect(() => {
    if (status !== "PENDING") return;
    const controller = new AbortController();
    fetch(`/api/assignments/${assignmentId}/view`, { method: "POST", signal: controller.signal }).catch(() => undefined);
    return () => controller.abort();
  }, [assignmentId, status]);
  return null;
}
