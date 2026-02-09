import type {
  MEDeliverable,
  EnrichedDeliverable,
  DeliverableStatus,
  EvidenceStrength,
  Output,
  MediaArticle,
  MEFramework,
  MEMilestoneView,
} from "./types";

/**
 * Check if an output matches a deliverable by searching the output's title
 * and description against the deliverable's searchTerms.
 * Uses case-insensitive substring matching.
 */
function outputMatchesDeliverable(
  output: Output,
  deliverable: MEDeliverable
): boolean {
  const haystack = `${output.title} ${output.description || ""}`.toLowerCase();
  return deliverable.searchTerms.some((term) =>
    haystack.includes(term.toLowerCase())
  );
}

/**
 * Check if a media article matches a deliverable.
 */
function mediaMatchesDeliverable(
  article: MediaArticle,
  deliverable: MEDeliverable
): boolean {
  const haystack = `${article.title} ${article.excerpt || ""}`.toLowerCase();
  return deliverable.searchTerms.some((term) =>
    haystack.includes(term.toLowerCase())
  );
}

/**
 * Parse a year from a deliverable's expectedDate string.
 * Handles formats like "2025", "end 2024", "spring 2025", "2025-26", "2025-2029", "ongoing"
 */
function parseExpectedYear(expectedDate: string): number | null {
  if (expectedDate.toLowerCase() === "ongoing") return null;
  const match = expectedDate.match(/(\d{4})/);
  return match ? parseInt(match[1]) : null;
}

/**
 * Compute the status of a deliverable based on matched outputs.
 */
function computeStatus(
  deliverable: MEDeliverable,
  matchedOutputs: Output[]
): DeliverableStatus {
  const now = new Date();
  const currentYear = now.getFullYear();
  const expectedYear = parseExpectedYear(deliverable.expectedDate);

  if (matchedOutputs.length === 0) {
    // Check if past expected date
    if (expectedYear !== null && currentYear > expectedYear) {
      return "at-risk";
    }
    // Special case: "end 2024" — we are past that
    if (
      deliverable.expectedDate.toLowerCase().includes("end 2024") &&
      currentYear >= 2025
    ) {
      return "at-risk";
    }
    return "not-started";
  }

  // Check for strong completion signals
  const hasEnactedBill = matchedOutputs.some(
    (o) =>
      o.type === "bill" &&
      o.status?.toLowerCase().includes("royal assent")
  );
  const hasPublishedStrategy = matchedOutputs.some((o) =>
    ["policy_paper", "white_paper", "action_plan", "framework"].includes(o.type)
  );

  if (hasEnactedBill || hasPublishedStrategy) {
    return "delivered";
  }

  return "in-progress";
}

/**
 * Compute evidence strength based on number and quality of matched outputs.
 */
function computeEvidenceStrength(
  matchedOutputs: Output[],
  matchedMedia: MediaArticle[]
): EvidenceStrength {
  if (matchedOutputs.length === 0 && matchedMedia.length === 0) return "none";

  const hasHighConfidenceOutput = matchedOutputs.some(
    (o) => o.confidence === "high"
  );
  const hasBillOrPaper = matchedOutputs.some((o) =>
    ["bill", "policy_paper", "white_paper", "action_plan"].includes(o.type)
  );

  if (hasBillOrPaper && hasHighConfidenceOutput) return "strong";
  if (matchedOutputs.length >= 2 || matchedMedia.length >= 3) return "moderate";
  return "weak";
}

/**
 * Enrich all deliverables for a milestone with matched outputs and computed status.
 * This is the main entry point — call at build time in the page component.
 */
export function enrichDeliverables(
  framework: MEFramework,
  outputs: Output[],
  mediaArticles: MediaArticle[]
): MEMilestoneView {
  const enriched: EnrichedDeliverable[] = framework.deliverables.map(
    (deliverable) => {
      const matchedOutputs = outputs.filter((o) =>
        outputMatchesDeliverable(o, deliverable)
      );
      const matchedMedia = mediaArticles.filter((a) =>
        mediaMatchesDeliverable(a, deliverable)
      );
      const computedStatus = computeStatus(deliverable, matchedOutputs);
      const evidenceStrength = computeEvidenceStrength(
        matchedOutputs,
        matchedMedia
      );

      return {
        ...deliverable,
        computedStatus,
        matchedOutputs,
        matchedMedia,
        evidenceStrength,
      };
    }
  );

  const deliveredCount = enriched.filter(
    (d) => d.computedStatus === "delivered"
  ).length;
  const inProgressCount = enriched.filter(
    (d) => d.computedStatus === "in-progress"
  ).length;
  const notStartedCount = enriched.filter(
    (d) => d.computedStatus === "not-started"
  ).length;
  const atRiskCount = enriched.filter(
    (d) => d.computedStatus === "at-risk"
  ).length;

  const total = enriched.length;
  const overallProgress =
    total > 0
      ? Math.round(
          ((deliveredCount * 100 + inProgressCount * 50 + atRiskCount * 25) /
            (total * 100)) *
            100
        )
      : 0;

  return {
    framework,
    enrichedDeliverables: enriched,
    deliveredCount,
    inProgressCount,
    notStartedCount,
    atRiskCount,
    overallProgress,
  };
}
