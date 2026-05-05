import type { Page } from "playwright";

/** Canonical candidate JSON passed into mapping / answering tools */
export interface CandidateProfileJson {
  candidate_id?: string;
  legal_name?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  work_authorization?: string;
  sponsorship_required?: string;
  /** Preferred locations — avoid guessing sensitive demographics here */
  location_preferences?: string[];
  education?: Record<string, string>;
  custom_answers?: Record<string, string>;
  /** Extra structured blob from resume parse */
  resume_summary?: string;
  skills?: string[];
}

export interface JobContextJson {
  job_id?: string;
  title?: string;
  company?: string;
  description?: string;
}

export interface ApplyAgentOptions {
  resumePdfPath: string;
  candidate: CandidateProfileJson;
  job: JobContextJson;
  /** Default true — never click final submit */
  reviewMode?: boolean;
  /** Confidence threshold for auto-fill */
  autoFillMinConfidence?: number;
  /** When true, agent does not attach a file — user uploads resume in the open browser */
  skipResumeUpload?: boolean;
  /** Max grounded OpenAI fills per run (latency/cost); navigation stays Playwright-first */
  maxSmartLlmFields?: number;
}

/** One extracted control from FieldExtractionTool */
export interface ExtractedField {
  /** Stable-ish fingerprint within page */
  selectorHint: string;
  tag: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  ariaLabel: string;
  role: string;
  labelsText: string;
  nearbyText: string;
  required: boolean;
  disabled: boolean;
  currentValue: string;
  /** For <select> options */
  options?: Array<{ value: string; text: string }>;
  /** Frame URL if inside iframe */
  frameUrl?: string;
}

export interface FieldMapping {
  field: ExtractedField;
  profileKey: string;
  value: string;
  confidence: number;
  source: "rule" | "llm";
}

export interface NeedsReviewItem {
  field: ExtractedField;
  reason: string;
  suggestedValue?: string;
  llmConfidence?: number;
}

export interface RecoverySnapshot {
  url: string;
  screenshotPath?: string;
  htmlSnapshotPath?: string;
  a11yTreePath?: string;
  failedAction: string;
  errorMessage: string;
  timestampIso: string;
}

export interface ResumeUploadResult {
  ok: boolean;
  pathUsed: string;
  detail?: string;
  skipped?: boolean;
}

export interface NavigationResult {
  ok: boolean;
  finalUrl: string;
  steps: string[];
}

export interface ReviewSummary {
  filledFields: Array<{ label: string; value: string; confidence: number }>;
  skippedFields: Array<{ label: string; reason: string }>;
  needsReview: NeedsReviewItem[];
  resumeUpload: ResumeUploadResult;
  submitted: boolean;
}

export type PageLike = Page;
