import type { CandidateProfileJson, ExtractedField, FieldMapping, NeedsReviewItem } from "../types.js";
import { callOpenAiJsonObject } from "../llm/openaiFallback.js";
import { createLogger } from "../logger.js";

const log = createLogger("FieldMappingTool");

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function blob(f: ExtractedField): string {
  return norm(`${f.labelsText} ${f.placeholder} ${f.ariaLabel} ${f.name} ${f.id} ${f.nearbyText}`);
}

/** Job posting context for LLM-assisted mapping */
export interface MapFieldsContext {
  jobTitle: string;
  jobCompany: string;
  /** Trimmed description excerpt — improves cover-letter-style answers */
  jobDescription?: string;
  /** Caps grounded OpenAI calls per apply run */
  maxSmartLlmFields?: number;
}

function customAnswersMatch(candidate: CandidateProfileJson, f: ExtractedField): FieldMapping | null {
  const ca = candidate.custom_answers;
  if (!ca || typeof ca !== "object") return null;
  const b = blob(f);
  for (const [key, raw] of Object.entries(ca)) {
    const val = typeof raw === "string" ? raw.trim() : "";
    if (!val) continue;
    const kn = norm(key);
    if (kn.length >= 4 && b.includes(kn)) {
      return { field: f, profileKey: `custom_answers.${key}`, value: val, confidence: 0.88, source: "rule" };
    }
    const tokens = kn.split(/[^a-z0-9]+/).filter((t) => t.length > 3);
    if (tokens.length === 0) continue;
    const hits = tokens.filter((t) => b.includes(t)).length;
    if (hits >= Math.min(2, tokens.length)) {
      return { field: f, profileKey: `custom_answers.${key}`, value: val, confidence: 0.82, source: "rule" };
    }
  }
  return null;
}

function ruleMatch(candidate: CandidateProfileJson, f: ExtractedField): FieldMapping | null {
  const b = blob(f);
  const name = (candidate.legal_name || "").trim();
  const email = (candidate.email || "").trim();
  const phone = (candidate.phone || "").trim();

  if (email && /email|e-mail/.test(b) && f.tag === "input" && (f.type === "email" || f.type === "text" || !f.type))
    return { field: f, profileKey: "email", value: email, confidence: 0.95, source: "rule" };

  if (phone && /phone|mobile|tel/.test(b) && f.tag === "input")
    return { field: f, profileKey: "phone", value: phone, confidence: 0.93, source: "rule" };

  if (name) {
    if (/full name|legal name/.test(b) && (f.tag === "input" || f.tag === "textarea"))
      return { field: f, profileKey: "legal_name", value: name, confidence: 0.94, source: "rule" };
    if (/\bfirst name\b|^first name/.test(b)) {
      const parts = name.split(/\s+/);
      return { field: f, profileKey: "legal_name.first", value: parts[0] || "", confidence: 0.9, source: "rule" };
    }
    if (/last name|surname|family name/.test(b)) {
      const parts = name.split(/\s+/);
      return {
        field: f,
        profileKey: "legal_name.last",
        value: parts.length > 1 ? parts[parts.length - 1]! : "",
        confidence: parts.length > 1 ? 0.9 : 0.55,
        source: "rule",
      };
    }
  }

  const li = (candidate.linkedin || "").trim();
  if (li && /linkedin/.test(b))
    return { field: f, profileKey: "linkedin", value: li, confidence: 0.92, source: "rule" };

  const gh = (candidate.github || "").trim();
  if (gh && /github|git\s*hub/.test(b))
    return { field: f, profileKey: "github", value: gh, confidence: 0.92, source: "rule" };

  const spNeed = (candidate.sponsorship_required || "").trim();
  if (spNeed && /\bsponsor|visa\s*sponsor/i.test(b) && (f.tag === "input" || f.tag === "textarea")) {
    return { field: f, profileKey: "sponsorship_required", value: spNeed, confidence: 0.84, source: "rule" };
  }

  const wa = (candidate.work_authorization || "").trim();
  if (
    wa &&
    /\b(work authorization|eligible to work|authorized to work|legally authorized)\b/i.test(b) &&
    (f.tag === "input" || f.tag === "textarea")
  ) {
    return { field: f, profileKey: "work_authorization", value: wa, confidence: 0.82, source: "rule" };
  }

  const pf = (candidate.portfolio || "").trim();
  if (pf && /portfolio|personal\s*website|website/.test(b))
    return { field: f, profileKey: "portfolio", value: pf, confidence: 0.88, source: "rule" };

  const skills =
    candidate.skills?.map((s) => String(s).trim()).filter(Boolean).join(", ") || "";
  if (skills && /\b(skills|technologies|tech\s*stack|programming\s+languages)\b/.test(b))
    return { field: f, profileKey: "skills", value: skills.slice(0, 4000), confidence: 0.84, source: "rule" };

  const locs = candidate.location_preferences?.map((x) => String(x).trim()).filter(Boolean) || [];
  if (
    locs.length &&
    /\b(location|city|based\s+in|where\s+do\s+you\s+live|mailing\s+city|office\s+location)\b/.test(b) &&
    !/\b(remote\s+only|100%\s*remote\s+only)\b/.test(b)
  ) {
    return {
      field: f,
      profileKey: "location_preferences",
      value: locs[0]!,
      confidence: 0.78,
      source: "rule",
    };
  }

  const summary = (candidate.resume_summary || "").trim();
  if (summary && /\b(summary|professional\s+summary|about\s+yourself|bio)\b/.test(b) && f.tag === "textarea") {
    return { field: f, profileKey: "resume_summary", value: summary.slice(0, 8000), confidence: 0.86, source: "rule" };
  }

  const edu = candidate.education || {};
  if (/school|university|college/.test(b) && edu.school)
    return { field: f, profileKey: "education.school", value: edu.school, confidence: 0.82, source: "rule" };
  if (/degree/.test(b) && edu.degree)
    return { field: f, profileKey: "education.degree", value: edu.degree, confidence: 0.82, source: "rule" };
  if (/major|field of study|discipline/.test(b) && (edu.major || edu.field))
    return {
      field: f,
      profileKey: "education.major",
      value: String(edu.major || edu.field || ""),
      confidence: 0.82,
      source: "rule",
    };

  return null;
}

/** Strong signal for longer narrative answers */
function shouldTryLlmForEssayPrompt(f: ExtractedField): boolean {
  if (f.tag !== "textarea" && !(f.tag === "input" && (f.type === "text" || !f.type))) return false;
  const b = blob(f);
  return /\b(why|describe|tell\s+us|explain|cover\s+letter|anything\s+else|additional\s+comments|motivation|what\s+interests|why\s+are\s+you|why\s+this\s+role|availability|notice\s+period)\b/.test(
    b
  );
}

/** Short text / textarea that looks like a real question (skip anonymous boxes to save latency/tokens) */
function wantsGroundedLlmFill(f: ExtractedField): boolean {
  const t = (f.type || "").toLowerCase();
  const b = blob(f);
  if (f.tag === "textarea") {
    if (b.length >= 28) return true;
    return /\b(cover|letter|summary|tell|why|describe|motivat|additional|comments|essay|bio|about\s+your)\b/i.test(b);
  }
  if (f.tag === "input" && ["text", "search", ""].includes(t)) return b.length >= 12;
  return false;
}

async function llmMapGroundedQuestion(
  candidate: CandidateProfileJson,
  ctx: MapFieldsContext,
  f: ExtractedField,
  essayStyle: boolean
): Promise<FieldMapping | null> {
  const jd = (ctx.jobDescription || "").trim().slice(0, 4500);
  const b = blob(f);
  const hardCap = f.tag === "textarea" ? (essayStyle ? 3200 : 2000) : 420;
  const tone = essayStyle
    ? "Write 2–6 complete sentences when appropriate."
    : "Prefer one concise phrase or a single short sentence unless the question clearly needs more.";

  const prompt = `You fill ONE job application form field. Treat "Field context" as the employer's question.

Job: ${ctx.jobTitle} at ${ctx.jobCompany}
${jd ? `\nJob description excerpt:\n${jd}\n` : ""}

Field context (labels, placeholders, aria, nearby text):
${b}

Candidate JSON — ONLY allowed source of facts (parsed resume + onboarding answers). Never invent employers, degrees, dates, or certifications not present.
${JSON.stringify(candidate)}

Instructions:
- ${tone}
- Stay under ~${hardCap} characters unless empty is correct.
- Demographics / EEO: use custom_answers or explicit profile fields only; never guess.
- If you cannot answer truthfully from JSON, return {"value":"","confidence":0.22}.

Return JSON ONLY:
{"value":"<answer>","confidence":0-1}`;

  const obj = await callOpenAiJsonObject(prompt);
  if (!obj) return null;
  const value = String(obj.value || "").trim();
  const confidence = Number(obj.confidence ?? 0);
  if (!value) return null;
  log.debug("LLM grounded question mapping", { confidence, essayStyle });
  return { field: f, profileKey: "llm.grounded", value: value.slice(0, hardCap), confidence, source: "llm" };
}

function skipField(f: ExtractedField): boolean {
  const t = (f.type || "").toLowerCase();
  if (t === "hidden" || t === "submit" || t === "button") return true;
  if (t === "password") return true;
  if (t === "file") return true;
  if (f.tag === "select") return true;
  if (t === "radio" || t === "checkbox") return true;
  if ((f.role || "").toLowerCase() === "combobox") return true;
  return false;
}

/**
 * Deterministic mapping first; LLM only for ambiguous free-text prompts.
 * Select/radio/combobox handled by OptionSelectionTool + Playwright clicks separately.
 */
export async function mapFieldsHybrid(
  candidate: CandidateProfileJson,
  fields: ExtractedField[],
  ctx: MapFieldsContext,
  minConfidenceAutoFill: number
): Promise<{ mappings: FieldMapping[]; needsReview: NeedsReviewItem[] }> {
  const mappings: FieldMapping[] = [];
  const needsReview: NeedsReviewItem[] = [];
  let llmRemaining = ctx.maxSmartLlmFields ?? 16;
  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY?.trim());

  for (const f of fields) {
    if (skipField(f)) continue;
    if (f.disabled) continue;

    const rule = ruleMatch(candidate, f);
    if (rule) {
      if (rule.confidence >= minConfidenceAutoFill) mappings.push(rule);
      else needsReview.push({ field: f, reason: "rule below threshold", suggestedValue: rule.value });
      continue;
    }

    const custom = customAnswersMatch(candidate, f);
    if (custom) {
      if (custom.confidence >= minConfidenceAutoFill) mappings.push(custom);
      else
        needsReview.push({
          field: f,
          reason: "custom answer below threshold",
          suggestedValue: custom.value,
        });
      continue;
    }

    const essay = shouldTryLlmForEssayPrompt(f);
    const groundedOk = wantsGroundedLlmFill(f);

    if (essay || groundedOk) {
      if (!hasOpenAi) {
        needsReview.push({
          field: f,
          reason: "Smart fill needs OPENAI_API_KEY — question-like field with no rule match",
        });
        continue;
      }
      if (llmRemaining <= 0) {
        needsReview.push({ field: f, reason: "Smart LLM budget exhausted for this run" });
        continue;
      }
      llmRemaining -= 1;
      const llm = await llmMapGroundedQuestion(candidate, ctx, f, essay);
      if (llm && llm.confidence >= minConfidenceAutoFill) mappings.push(llm);
      else if (llm)
        needsReview.push({
          field: f,
          reason: "LLM answer below threshold",
          suggestedValue: llm.value,
          llmConfidence: llm.confidence,
        });
      else needsReview.push({ field: f, reason: "no grounded LLM mapping" });
      continue;
    }

    needsReview.push({ field: f, reason: "no deterministic mapping (skipped AI)" });
  }

  return { mappings, needsReview };
}
