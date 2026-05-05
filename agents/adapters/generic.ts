import type { AtsAdapter } from "./types.js";

/**
 * Generic ATS apply flow — safe defaults when vendor is unknown.
 */
export const genericAdapter: AtsAdapter = {
  name: "generic",
  /** Extra Playwright selectors tried before text-based clicks */
  applyEntrySelectors: [
    "a:has-text('Apply')",
    "button:has-text('Apply')",
    "a:has-text('Apply Now')",
    "button:has-text('Apply Now')",
    "a:has-text('Start application')",
    "button:has-text('Start application')",
    "[data-testid*='apply']",
  ],
  /** Substrings matched against normalized button/link text */
  continueTextHints: [
    "continue",
    "next",
    "save and continue",
    "proceed",
    "get started",
    "continue to application",
  ],
  resumeUploadButtonHints: [
    "upload resume",
    "attach resume",
    "choose file",
    "select file",
    "browse",
    "add resume",
  ],
};
