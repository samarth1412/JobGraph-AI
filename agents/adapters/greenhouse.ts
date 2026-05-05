import { genericAdapter } from "./generic.js";
import type { AtsAdapter } from "./types.js";

export const greenhouseAdapter: AtsAdapter = {
  ...genericAdapter,
  name: "greenhouse" as const,
  applyEntrySelectors: [
    ...genericAdapter.applyEntrySelectors,
    "a:has-text('Apply for this job')",
    "button:has-text('Apply for this job')",
    "#application_form",
    "[id*='application']",
  ],
  resumeUploadButtonHints: [...genericAdapter.resumeUploadButtonHints, "attach"],
};
