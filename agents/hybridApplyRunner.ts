import type { Browser, Page } from "playwright";
import { createLogger } from "./logger.js";
import type { ApplyAgentOptions, ReviewSummary } from "./types.js";
import { runMultiStepHybridApply } from "./multiStepApplyRunner.js";

const log = createLogger("HybridApplyRunner");

/**
 * Multi-step Playwright + optional Stagehand recovery: navigate → loop (extract → fill → selects/comboboxes → safe continue)
 * until a final submit control is visible. Never clicks final submit while reviewMode is on.
 */
export async function runHybridApply(
  page: Page,
  browser: Browser,
  opts: ApplyAgentOptions
): Promise<ReviewSummary> {
  log.info("starting multi-step hybrid apply");
  return runMultiStepHybridApply(page, browser, opts);
}

export { compileHybridApplyGraph } from "./graph/applyLangGraph.js";
