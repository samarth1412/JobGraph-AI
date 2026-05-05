import { genericAdapter } from "./generic.js";
import type { AtsAdapter } from "./types.js";

/**
 * Workday often gates forms behind login — adapter biases detection only.
 */
export const workdayAdapter: AtsAdapter = {
  ...genericAdapter,
  name: "workday" as const,
  applyEntrySelectors: [
    ...genericAdapter.applyEntrySelectors,
    "a:has-text('Apply')",
    "button:has-text('Apply Manually')",
    "[data-automation-id='jobPostingApplyButton']",
  ],
};
