import type {
  FieldMapping,
  NeedsReviewItem,
  ResumeUploadResult,
  ReviewSummary,
} from "../types.js";

export function buildReviewSummary(input: {
  filled: FieldMapping[];
  skipped: Array<{ label: string; reason: string }>;
  needsReview: NeedsReviewItem[];
  resume: ResumeUploadResult;
  submitted: boolean;
}): ReviewSummary {
  return {
    filledFields: input.filled.map((m) => ({
      label: `${m.field.labelsText || m.field.placeholder || m.field.name || "field"}`.slice(0, 160),
      value: m.value.slice(0, 400),
      confidence: m.confidence,
    })),
    skippedFields: input.skipped,
    needsReview: input.needsReview,
    resumeUpload: input.resume,
    submitted: input.submitted,
  };
}
