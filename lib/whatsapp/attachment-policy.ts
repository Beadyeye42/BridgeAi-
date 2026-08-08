export type AttachmentAnalysisForPolicy = {
  usefulForQuote: boolean;
  needsHumanReview: boolean;
};

export type AttachmentAutomationDecision =
  | { action: "USE_FOR_QUOTE" }
  | { action: "EXCLUDE_AND_CONTINUE" };

/**
 * The model extracts facts, but Bridge AI owns the workflow decision.
 * A relevant trade file must not block intake merely because a measurement or
 * specification needs the supplier to verify it. Files the model says are not
 * useful are excluded from the request without pausing the customer journey.
 */
export function attachmentAutomationDecision(
  analysis: AttachmentAnalysisForPolicy,
): AttachmentAutomationDecision {
  return analysis.usefulForQuote
    ? { action: "USE_FOR_QUOTE" }
    : { action: "EXCLUDE_AND_CONTINUE" };
}
