import type { Browser, Page } from "playwright";
import { adapterForPage, adapterForUrl } from "./adapters/index.js";
import {
  applyMappings,
  collectComboboxNeedsReview,
  collectRadioNeedsReview,
  collectSelectNeedsReview,
} from "./applySteps.js";
import { createLogger } from "./logger.js";
import { initStagehandForBrowser } from "./stagehandBridge.js";
import type {
  ApplyAgentOptions,
  ExtractedField,
  FieldMapping,
  NeedsReviewItem,
  ResumeUploadResult,
  ReviewSummary,
} from "./types.js";
import { navigateToApplicationForm } from "./tools/ApplyNavigationTool.js";
import { extractAllFields } from "./tools/FieldExtractionTool.js";
import { mapFieldsHybrid } from "./tools/FieldMappingTool.js";
import { buildReviewSummary } from "./tools/ReviewBeforeSubmit.js";
import { uploadResume } from "./tools/ResumeUploadTool.js";
import { emitFieldTelemetry } from "./telemetry.js";

const log = createLogger("MultiStepApplyRunner");

const MAX_FLOW_ITERATIONS = 28;

function dedupeMappings(mappings: FieldMapping[]): FieldMapping[] {
  const map = new Map<string, FieldMapping>();
  for (const m of mappings) {
    const k = m.field.selectorHint;
    const prev = map.get(k);
    if (!prev || m.confidence > prev.confidence) map.set(k, m);
  }
  return [...map.values()];
}

function dedupeNeedsReview(items: NeedsReviewItem[]): NeedsReviewItem[] {
  const seen = new Set<string>();
  const out: NeedsReviewItem[] = [];
  for (const it of items) {
    const k = `${it.field.frameUrl || ""}\x00${it.field.selectorHint}\x00${it.reason}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

async function finalSubmitVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    function visible(el: Element): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const st = window.getComputedStyle(el);
      if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    }

    const nodes = document.querySelectorAll('button, [role="button"], input[type="submit"], a');
    for (const el of nodes) {
      const t = (
        (el as HTMLElement).innerText ||
        (el as HTMLInputElement).value ||
        el.textContent ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (!t) continue;
      if (/submit\s+(your\s+)?application|submit\s+my\s+application|finalize\s+application/.test(t)) {
        if (visible(el)) return true;
      }
    }
    return false;
  });
}

async function clickSafeContinuation(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    function visible(el: Element): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const st = window.getComputedStyle(el);
      if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    }

    function textOf(el: Element): string {
      return (
        (el as HTMLElement).innerText ||
        (el as HTMLInputElement).value ||
        el.textContent ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    }

    const blocked =
      /submit\s+(your\s+)?application|submit\s+my\s+application|finalize\s+application|send\s+application|^submit$/i;

    const candidates: HTMLElement[] = [];
    const nodes = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], a'));
    for (const el of nodes) {
      if (!(el instanceof HTMLElement)) continue;
      if (!visible(el)) continue;
      const t = textOf(el);
      if (!t || t.length > 140) continue;
      if (blocked.test(t)) continue;

      const wantsContinuation =
        /\b(next|continue|proceed)\b/i.test(t) ||
        /\bsave\b\s+and\b\s+continue\b/i.test(t) ||
        /\bsave\b\s+and\b\s+next\b/i.test(t);

      if (wantsContinuation) candidates.push(el);
    }

    const score = (el: HTMLElement): number => {
      const t = textOf(el);
      if (/\bsave\b\s+and\b\s+continue\b/i.test(t)) return 4;
      if (t === "continue") return 3;
      if (t === "next") return 2;
      if (/\bcontinue\b/i.test(t)) return 1;
      if (/\bnext\b/i.test(t)) return 1;
      return 0;
    };

    candidates.sort((a, b) => score(b) - score(a));
    const pick = candidates[0];
    if (pick) {
      pick.click();
      return true;
    }
    return false;
  });
}

function hasResumeFileInput(fields: ExtractedField[]): boolean {
  return fields.some((f) => f.tag === "input" && (f.type || "").toLowerCase() === "file");
}

/**
 * Multi-step Playwright-first flow with optional Stagehand recovery.
 * Stops when a final “Submit application” control is visible or progress stalls — never clicks it.
 */
export async function runMultiStepHybridApply(
  page: Page,
  browser: Browser,
  opts: ApplyAgentOptions
): Promise<ReviewSummary> {
  const threshold = opts.autoFillMinConfidence ?? 0.8;
  const reviewMode = opts.reviewMode !== false;
  const smartCap = opts.maxSmartLlmFields ?? 18;

  let active = page;
  const adapterHint = adapterForUrl(active.url());
  const nav = await navigateToApplicationForm(active, adapterHint, { reviewMode });
  active = nav.page;
  log.info("multi.navigate", { ok: nav.result.ok, url: active.url() });

  const stagehand = await initStagehandForBrowser(browser);

  let resume: ResumeUploadResult = opts.skipResumeUpload
    ? {
        ok: true,
        pathUsed: "",
        skipped: true,
        detail: "Skipped via skipResumeUpload — upload manually if needed.",
      }
    : {
        ok: false,
        pathUsed: (opts.resumePdfPath || "").trim(),
        detail: "Resume upload pending — waiting for a visible file input.",
      };
  let resumeAttempted = false;

  const allMappings: FieldMapping[] = [];
  const allNeedsReview: NeedsReviewItem[] = [];

  try {
    for (let iter = 0; iter < MAX_FLOW_ITERATIONS; iter++) {
      const fields = await extractAllFields(active, iter);

      const resumePath = (opts.resumePdfPath || "").trim();
      if (!opts.skipResumeUpload && resumePath && !resumeAttempted && hasResumeFileInput(fields)) {
        const adapter = await adapterForPage(active);
        resume = await uploadResume(active, resumePath, adapter);
        resumeAttempted = true;
        emitFieldTelemetry({
          phase: "resume_upload",
          reason: resume.skipped ? "skipped" : resume.ok ? "ok" : "failed",
          failure: resume.detail,
          iteration: iter,
        });
      }

      const { mappings, needsReview } = await mapFieldsHybrid(opts.candidate, fields, {
        jobTitle: opts.job.title || "",
        jobCompany: opts.job.company || "",
        jobDescription: opts.job.description || "",
        maxSmartLlmFields: smartCap,
      }, threshold);

      await applyMappings(active, mappings, { stagehand, iteration: iter });
      allMappings.push(...mappings);
      allNeedsReview.push(...needsReview);

      const radioNr = await collectRadioNeedsReview(active, opts.candidate, fields, threshold, iter);
      const selectNr = await collectSelectNeedsReview(active, opts.candidate, fields, threshold, iter);
      const comboNr = await collectComboboxNeedsReview(active, opts.candidate, fields, threshold, iter);
      allNeedsReview.push(...radioNr, ...selectNr, ...comboNr);

      // Fill current step first; only then stop—otherwise a visible "Submit application"
      // on landing/review pages would skip all extraction and mapping (nothing fills).
      if (await finalSubmitVisible(active)) {
        emitFieldTelemetry({
          phase: "navigation",
          reason: "final_submit_visible_stop",
          iteration: iter,
        });
        log.info("final submit visible — stopping navigation without clicking submit (review mode)");
        break;
      }

      const progressed = await clickSafeContinuation(active);
      emitFieldTelemetry({
        phase: "navigation",
        reason: progressed ? "clicked_safe_continue" : "no_safe_continue",
        iteration: iter,
      });

      if (!progressed) {
        log.info("no safe continuation control — ending loop", { iter });
        break;
      }

      await active.waitForTimeout(650).catch(() => {});
    }

    if (!opts.skipResumeUpload && !resumeAttempted && (opts.resumePdfPath || "").trim()) {
      resume = {
        ok: false,
        pathUsed: opts.resumePdfPath || "",
        detail: "Resume path provided but no visible file input was found during the run.",
      };
    }

    return buildReviewSummary({
      filled: dedupeMappings(allMappings),
      skipped: [],
      needsReview: dedupeNeedsReview(allNeedsReview),
      resume,
      submitted: false,
    });
  } finally {
    await stagehand?.close({ force: false }).catch(() => {});
  }
}
