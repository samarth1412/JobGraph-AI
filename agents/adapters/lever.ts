import { genericAdapter } from "./generic.js";
import type { AtsAdapter } from "./types.js";

export const leverAdapter: AtsAdapter = {
  ...genericAdapter,
  name: "lever" as const,
  applyEntrySelectors: [
    ...genericAdapter.applyEntrySelectors,
    "a:has-text('Apply for Job')",
    "button:has-text('Apply for Job')",
    "[class*='posting'] button",
  ],
};
