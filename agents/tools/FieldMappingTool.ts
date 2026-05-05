import type { CandidateProfileJson, ExtractedField, FieldMapping, MapFieldsContext, NeedsReviewItem } from "../types.js";
import { classifyFieldAction } from "../llm/fieldActionClassifier.js";
import { createLogger } from "../logger.js";

const log = createLogger("FieldMappingTool");

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function blob(f: ExtractedField): string {
  return norm(`${f.labelsText} ${f.placeholder} ${f.ariaLabel} ${f.name} ${f.id} ${f.nearbyText}`);
}

/** Match saved onboarding answers when question text overlaps the stored key (non-classifier path). */
function customAnswersLooseMatch(candidate: CandidateProfileJson, f: ExtractedField): FieldMapping | null {
  const ca = candidate.custom_answers;
  if (!ca || typeof ca !== "object") return null;
  const b = blob(f);
  const idBlob = norm(`${f.name} ${f.id} ${f.placeholder}`);
  for (const [key, raw] of Object.entries(ca)) {
    const val = typeof raw === "string" ? raw.trim() : "";
    if (!val) continue;
    const kn = norm(key);
    if (kn.length < 3) continue;
    if (kn.length >= 4 && (b.includes(kn) || idBlob.includes(kn.replace(/\s+/g, "")))) {
      return { field: f, profileKey: `custom_answers.${key}`, value: val, confidence: 0.88, source: "rule" };
    }
    const tokens = kn.split(/[^a-z0-9]+/).filter((t) => t.length > 3);
    if (tokens.length === 0) continue;
    const hits = tokens.filter((t) => b.includes(t) || idBlob.includes(t)).length;
    if (hits >= Math.min(2, tokens.length)) {
      return { field: f, profileKey: `custom_answers.${key}`, value: val, confidence: 0.82, source: "rule" };
    }
  }
  return null;
}

function intakeStructuredMatch(candidate: CandidateProfileJson, f: ExtractedField): FieldMapping | null {
  const ca = candidate.custom_answers;
  if (!ca || typeof ca !== "object") return null;
  const b = blob(f);

  if (/\bgender\b/i.test(b) && !/pronoun/i.test(b)) {
    const v = String(ca.gender || "").trim();
    if (v) return { field: f, profileKey: "custom_answers.gender", value: v, confidence: 0.93, source: "rule" };
  }
  if (/\brace\b|\bethnicity\b/i.test(b)) {
    const v = String(ca["race/ethnicity"] || ca.ethnicity || "").trim();
    if (v)
      return {
        field: f,
        profileKey: "custom_answers.race/ethnicity",
        value: v,
        confidence: 0.92,
        source: "rule",
      };
  }
  if (/\bveteran\b/i.test(b)) {
    const v = String(ca["veteran status"] || ca.veteran || "").trim();
    if (v)
      return {
        field: f,
        profileKey: "custom_answers.veteran",
        value: v,
        confidence: 0.91,
        source: "rule",
      };
  }
  if (/\bdisability\b/i.test(b)) {
    const v = String(ca.disability || ca["disability status"] || "").trim();
    if (v)
      return {
        field: f,
        profileKey: "custom_answers.disability",
        value: v,
        confidence: 0.91,
        source: "rule",
      };
  }

  const sp = String(candidate.sponsorship_required || ca.sponsorship || ca["visa sponsorship"] || "").trim();
  if (sp && /\bsponsor|visa\b/i.test(b) && (f.tag === "input" || f.tag === "textarea"))
    return { field: f, profileKey: "sponsorship_required", value: sp, confidence: 0.9, source: "rule" };

  const wa = String(candidate.work_authorization || ca["work authorization"] || "").trim();
  if (
    wa &&
    /\b(work authorization|eligible to work|authorized to work|legally authorized)\b/i.test(b) &&
    (f.tag === "input" || f.tag === "textarea")
  ) {
    return { field: f, profileKey: "work_authorization", value: wa, confidence: 0.9, source: "rule" };
  }

  return null;
}

function ruleMatch(candidate: CandidateProfileJson, f: ExtractedField): FieldMapping | null {
  const b = blob(f);
  const name = (candidate.legal_name || "").trim();
  const email = (candidate.email || "").trim();
  const phone = (candidate.phone || "").trim();

  if (email && f.tag === "input") {
    const nm = norm(`${f.name} ${f.id}`);
    const looksLikeEmail =
      /email|e-mail/.test(b) ||
      /\bemail\b/.test(nm) ||
      ["email", "e_mail", "candidate_email", "contact_email"].includes(nm.replace(/-/g, "_")) ||
      (f.type || "").toLowerCase() === "email";
    if (looksLikeEmail)
      return { field: f, profileKey: "email", value: email, confidence: 0.95, source: "rule" };
  }

  if (phone && f.tag === "input") {
    const nm = norm(`${f.name} ${f.id}`);
    const looksLikePhone =
      /phone|mobile|tel|cell/.test(b) || /\b(phone|mobile|tel)\b/.test(nm) || (f.type || "").toLowerCase() === "tel";
    if (looksLikePhone) return { field: f, profileKey: "phone", value: phone, confidence: 0.93, source: "rule" };
  }

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
  if (li && /linkedin/.test(b)) return { field: f, profileKey: "linkedin", value: li, confidence: 0.92, source: "rule" };

  const gh = (candidate.github || "").trim();
  if (gh && /github|git\s*hub/.test(b))
    return { field: f, profileKey: "github", value: gh, confidence: 0.92, source: "rule" };

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

function shouldTryClassifier(f: ExtractedField): boolean {
  const t = (f.type || "").toLowerCase();
  const b = blob(f);
  if (f.tag === "textarea") {
    if (b.length >= 12) return true;
    return /\b(cover|letter|summary|tell|why|describe|motivat|additional|comments|essay|bio|about\s+your)\b/i.test(b);
  }
  if (f.tag === "input" && ["text", "search", "", "email", "tel", "url", "number"].includes(t)) return b.length >= 6;
  return false;
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
 * Deterministic mapping first; LLM classifier for remaining question-like controls.
 * Select/radio/combobox handled separately.
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

    const intake = intakeStructuredMatch(candidate, f);
    if (intake) {
      if (intake.confidence >= minConfidenceAutoFill) mappings.push(intake);
      else
        needsReview.push({
          field: f,
          reason: "intake rule below threshold",
          suggestedValue: intake.value,
        });
      continue;
    }

    const customLoose = customAnswersLooseMatch(candidate, f);
    if (customLoose) {
      if (customLoose.confidence >= minConfidenceAutoFill) mappings.push(customLoose);
      else
        needsReview.push({
          field: f,
          reason: "custom answer below threshold",
          suggestedValue: customLoose.value,
        });
      continue;
    }

    if (!shouldTryClassifier(f)) {
      needsReview.push({ field: f, reason: "no deterministic mapping (skipped classifier)" });
      continue;
    }

    if (!hasOpenAi) {
      needsReview.push({
        field: f,
        reason: "Classifier requires OPENAI_API_KEY — question-like field with no rule match",
      });
      continue;
    }
    if (llmRemaining <= 0) {
      needsReview.push({ field: f, reason: "Classifier budget exhausted for this run" });
      continue;
    }
    llmRemaining -= 1;

    const cls = await classifyFieldAction(candidate, ctx, f, f.options?.map((o) => o.text || o.value).filter(Boolean) || []);
    if (!cls) {
      needsReview.push({ field: f, reason: "classifier returned no result" });
      continue;
    }

    if (cls.action === "skip" || !cls.value.trim()) {
      needsReview.push({
        field: f,
        reason: cls.reason || "classifier skip",
        suggestedValue: cls.value || undefined,
        llmConfidence: cls.confidence,
      });
      continue;
    }

    if (cls.confidence < minConfidenceAutoFill) {
      needsReview.push({
        field: f,
        reason: cls.reason || "classifier below threshold",
        suggestedValue: cls.value,
        llmConfidence: cls.confidence,
      });
      continue;
    }

    log.debug("classifier mapping", { action: cls.action, confidence: cls.confidence });
    mappings.push({
      field: f,
      profileKey: `classifier.${cls.action}`,
      value: cls.value,
      confidence: cls.confidence,
      source: "classifier",
    });
  }

  return { mappings, needsReview };
}
