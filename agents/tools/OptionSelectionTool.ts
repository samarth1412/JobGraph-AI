import type { CandidateProfileJson, ExtractedField } from "../types.js";
import { createLogger } from "../logger.js";
import { callOpenAiJsonObject } from "../llm/openaiFallback.js";

const log = createLogger("OptionSelectionTool");

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function blob(f: ExtractedField): string {
  return norm(`${f.labelsText} ${f.placeholder} ${f.ariaLabel} ${f.nearbyText}`);
}

const SENSITIVE_RE =
  /\b(gender|race|ethnicity|veteran|disability|sexual orientation|lgbt|marital status)\b/i;

/** Prefer generic decline wording when present */
const DECLINE_PREFERENCE =
  /prefer not to answer|decline to self-identify|i decline|i do not wish to answer|choose not to identify|rather not say|wish not to disclose|do not wish to disclose/i;

/** Snap model output to closest real `<option>` label/value */
export function snapChoiceToOptions(rawChoice: string, opts: string[]): string | null {
  const want = norm(rawChoice);
  if (!want) return null;
  for (const o of opts) {
    if (norm(o) === want) return o;
  }
  for (const o of opts) {
    const n = norm(o);
    if (n.includes(want) || want.includes(n)) return o;
  }
  let best: { o: string; score: number } | null = null;
  for (const o of opts) {
    const n = norm(o);
    const tokens = want.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    const hits = tokens.filter((t) => n.includes(t)).length;
    const score = hits / Math.max(1, tokens.length);
    if (hits && (!best || score > best.score)) best = { o, score };
  }
  return best && best.score >= 0.5 ? best.o : null;
}

function scoreOption(profileHint: string, optionText: string): number {
  const a = norm(profileHint);
  const b = norm(optionText);
  if (!a || !b) return 0;
  if (b.includes(a) || a.includes(b)) return 0.92;
  const tokens = a.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const hits = tokens.filter((t) => b.includes(t)).length;
  return hits ? 0.55 + Math.min(0.35, hits * 0.06) : 0;
}

/** Better overlap for long EEO labels vs intake answers */
function scoreDemographicHint(hint: string, optionText: string): number {
  const base = scoreOption(hint, optionText);
  if (base >= minOverlapThreshold(hint)) return base;
  const a = norm(hint);
  const b = norm(optionText);
  if (!a || !b) return base;
  const ta = new Set(a.split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  const tb = new Set(b.split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  if (!union) return base;
  const j = inter / union;
  return Math.max(base, 0.42 + j * 0.48);
}

function minOverlapThreshold(hint: string): number {
  return hint.split(/\s+/).length > 4 ? 0.38 : 0.55;
}

function profileHintForSelect(candidate: CandidateProfileJson, labelBlob: string): string {
  if (/sponsor|visa/.test(labelBlob)) {
    return norm(
      candidate.sponsorship_required ||
        candidate.custom_answers?.["visa sponsorship"] ||
        candidate.custom_answers?.sponsorship ||
        ""
    );
  }
  if (/authorized|eligible to work|legally authorized|right to work/.test(labelBlob)) {
    return norm(
      candidate.work_authorization ||
        candidate.custom_answers?.["work authorization"] ||
        ""
    );
  }
  if (/gender/.test(labelBlob)) return norm(candidate.custom_answers?.gender || "");
  if (/race|ethnicity/.test(labelBlob)) {
    return norm(
      candidate.custom_answers?.["race/ethnicity"] ||
        candidate.custom_answers?.ethnicity ||
        ""
    );
  }
  if (/veteran/.test(labelBlob)) {
    return norm(
      candidate.custom_answers?.["veteran status"] ||
        candidate.custom_answers?.veteran ||
        ""
    );
  }
  if (/disability/.test(labelBlob)) {
    return norm(candidate.custom_answers?.disability || candidate.custom_answers?.["disability status"] || "");
  }
  return "";
}

export interface OptionPick {
  valueText: string;
  confidence: number;
  source: "deterministic" | "llm";
}

/** Pick closest option for select-like controls; uses intake demographics when user answered upfront */
export async function pickOptionForField(
  candidate: CandidateProfileJson,
  field: ExtractedField,
  minConfidence: number
): Promise<OptionPick | null> {
  const labelBlob = blob(field);
  const sensitive = SENSITIVE_RE.test(labelBlob);

  const opts =
    field.options?.map((o) => o.text || o.value).filter(Boolean) ||
    (await inferOptionsFromDomPlaceholder());

  if (!opts?.length) return null;

  const profileHint = profileHintForSelect(candidate, labelBlob);

  if (sensitive && !profileHint) {
    const decline = opts.find((o) => DECLINE_PREFERENCE.test(o));
    if (decline) return { valueText: decline, confidence: 0.92, source: "deterministic" };
    return null;
  }

  if (
    sensitive &&
    profileHint &&
    (DECLINE_PREFERENCE.test(profileHint) || /^prefer\s+not\b/i.test(profileHint))
  ) {
    const decline = opts.find((o) => DECLINE_PREFERENCE.test(o));
    if (decline) return { valueText: decline, confidence: 0.92, source: "deterministic" };
  }

  const scorer = sensitive && profileHint ? scoreDemographicHint : scoreOption;

  let best: { text: string; score: number } | null = null;
  for (const o of opts) {
    const hintForScore = profileHint || labelBlob;
    const s = scorer(hintForScore, o);
    if (!best || s > best.score) best = { text: o, score: s };
  }

  if (profileHint && sensitive) {
    for (const o of opts) {
      if (norm(o) === norm(profileHint))
        return { valueText: o, confidence: 0.96, source: "deterministic" };
    }
  }

  if (best && best.score >= minConfidence) {
    return { valueText: best.text, confidence: best.score, source: "deterministic" };
  }

  // Sponsorship / work authorization often benefit from LLM phrasing match — never for demographics.
  if (sensitive) return null;

  const llm = await callOpenAiJsonObject(`Choose ONE option text exactly from options list that best matches profile facts.

Label context:
${labelBlob}

Profile JSON:
${JSON.stringify(candidate)}

Options:
${JSON.stringify(opts)}

Return JSON ONLY: {"choice":"<exact option text>","confidence":0-1}
If unsure use confidence < 0.6.`);

  const rawChoice = String(llm?.choice || "");
  const conf = Number(llm?.confidence ?? 0);
  const snapped = snapChoiceToOptions(rawChoice, opts);
  const choice = snapped || rawChoice;
  if (!choice || conf < minConfidence) return null;
  log.debug("LLM option pick", { rawChoice, choice, conf });
  return { valueText: choice, confidence: conf, source: "llm" };
}

async function inferOptionsFromDomPlaceholder(): Promise<string[]> {
  return [];
}
