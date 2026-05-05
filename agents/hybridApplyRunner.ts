import type { Page } from "playwright";
import { createLogger } from "./logger.js";
import type { ApplyAgentOptions, ReviewSummary } from "./types.js";
import { compileHybridApplyGraph } from "./graph/applyLangGraph.js";

const log = createLogger("HybridApplyRunner");

/**
 * End-to-end hybrid pipeline orchestrated by LangGraph: navigation → resume → extract →
 * map/fill → selects → summary. Playwright-first with LLM only inside mapping/option tools.
 */
export async function runHybridApply(page: Page, opts: ApplyAgentOptions): Promise<ReviewSummary> {
  const graph = compileHybridApplyGraph(page, opts);
  const out = await graph.invoke({});
  const summary = out.reviewSummary;
  if (!summary) {
    log.error("LangGraph apply finished without reviewSummary");
    throw new Error("Hybrid apply graph did not produce a review summary");
  }
  return summary;
}

export { compileHybridApplyGraph } from "./graph/applyLangGraph.js";
