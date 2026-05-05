import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { Page } from "playwright";
import { adapterForPage, adapterForUrl } from "../adapters/index.js";
import { applyMappings, collectRadioNeedsReview, collectSelectNeedsReview } from "../applySteps.js";
import { createLogger } from "../logger.js";
import type {
  ApplyAgentOptions,
  ExtractedField,
  FieldMapping,
  NeedsReviewItem,
  ResumeUploadResult,
  ReviewSummary,
} from "../types.js";
import { navigateToApplicationForm } from "../tools/ApplyNavigationTool.js";
import { uploadResume } from "../tools/ResumeUploadTool.js";
import { extractAllFields } from "../tools/FieldExtractionTool.js";
import { mapFieldsHybrid } from "../tools/FieldMappingTool.js";
import { buildReviewSummary } from "../tools/ReviewBeforeSubmit.js";

const log = createLogger("ApplyLangGraph");

function skippedResumeResult(): ResumeUploadResult {
  return {
    ok: true,
    pathUsed: "",
    detail: "Skipped — attach your resume manually in the browser window.",
    skipped: true,
  };
}

const ApplyGraphState = Annotation.Root({
  mappings: Annotation<FieldMapping[]>(),
  needsReview: Annotation<NeedsReviewItem[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
  skipped: Annotation<Array<{ label: string; reason: string }>>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
  resume: Annotation<ResumeUploadResult>(),
  fields: Annotation<ExtractedField[]>(),
  reviewSummary: Annotation<ReviewSummary>(),
});

export type CompiledHybridApplyGraph = ReturnType<typeof compileHybridApplyGraph>;

/** LangGraph state machine over the same Playwright-first hybrid steps */
export function compileHybridApplyGraph(page: Page, opts: ApplyAgentOptions) {
  const threshold = opts.autoFillMinConfidence ?? 0.8;
  const reviewMode = opts.reviewMode !== false;
  const smartCap = opts.maxSmartLlmFields ?? 18;
  let active = page;

  return new StateGraph(ApplyGraphState)
    .addNode("navigate", async () => {
      const adapterHint = adapterForUrl(active.url());
      const nav = await navigateToApplicationForm(active, adapterHint, { reviewMode });
      active = nav.page;
      log.info("graph.navigate", { ok: nav.result.ok, url: active.url() });
      return {};
    })
    .addNode("resume_upload", async () => {
      if (opts.skipResumeUpload) {
        log.info("graph.resume_upload", { skipped: true });
        return { resume: skippedResumeResult() };
      }
      const adapter = await adapterForPage(active);
      const resumeResult = await uploadResume(active, opts.resumePdfPath, adapter);
      log.info("graph.resume_upload", { ok: resumeResult.ok });
      return { resume: resumeResult };
    })
    .addNode("extract_fields", async () => {
      const fields = await extractAllFields(active);
      log.info("graph.extract_fields", { count: fields.length });
      return { fields };
    })
    .addNode("map_fields", async (state) => {
      const { mappings, needsReview } = await mapFieldsHybrid(opts.candidate, state.fields, {
        jobTitle: opts.job.title || "",
        jobCompany: opts.job.company || "",
        jobDescription: opts.job.description || "",
        maxSmartLlmFields: smartCap,
      }, threshold);
      log.info("graph.map_fields", { mappings: mappings.length, needsReview: needsReview.length });
      return { mappings, needsReview };
    })
    .addNode("apply_text_fields", async (state) => {
      await applyMappings(active, state.mappings);
      return {};
    })
    .addNode("apply_selects", async (state) => {
      const radioNr = await collectRadioNeedsReview(active, opts.candidate, state.fields, threshold);
      const selectNr = await collectSelectNeedsReview(active, opts.candidate, state.fields, threshold);
      return { needsReview: [...radioNr, ...selectNr] };
    })
    .addNode("finalize", async (state) => {
      const summary = buildReviewSummary({
        filled: state.mappings,
        skipped: state.skipped,
        needsReview: state.needsReview,
        resume: state.resume,
        submitted: false,
      });
      log.info("graph.finalize", {
        filled: summary.filledFields.length,
        needsReview: summary.needsReview.length,
      });
      return { reviewSummary: summary };
    })
    .addEdge(START, "navigate")
    .addEdge("navigate", "resume_upload")
    .addEdge("resume_upload", "extract_fields")
    .addEdge("extract_fields", "map_fields")
    .addEdge("map_fields", "apply_text_fields")
    .addEdge("apply_text_fields", "apply_selects")
    .addEdge("apply_selects", "finalize")
    .addEdge("finalize", END)
    .compile();
}
