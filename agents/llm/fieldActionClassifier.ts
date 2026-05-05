import { createLogger } from "../logger.js";
import type { CandidateProfileJson, ExtractedField, MapFieldsContext } from "../types.js";
import { callOpenAiJsonObject } from "./openaiFallback.js";

const log = createLogger("FieldActionClassifier");

export type FieldClassifierAction = "fill" | "select" | "check" | "skip";

export interface FieldClassifierResult {
  action: FieldClassifierAction;
  value: string;
  confidence: number;
  reason: string;
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function blob(f: ExtractedField): string {
  return norm(`${f.labelsText} ${f.placeholder} ${f.ariaLabel} ${f.name} ${f.id} ${f.nearbyText}`);
}

const SENSITIVE_EEO =
  /\b(gender|race|ethnicity|veteran|disability|sexual orientation|lgbt|marital status|national origin|citizenship status)\b/i;

export async function classifyFieldAction(
  candidate: CandidateProfileJson,
  ctx: MapFieldsContext,
  field: ExtractedField,
  optionsList: string[]
): Promise<FieldClassifierResult | null> {
  const b = blob(field);
  const jd = (ctx.jobDescription || "").trim().slice(0, 4500);
  const sensitive = SENSITIVE_EEO.test(b);

  const DECLINE_OPT =
    /prefer not to answer|decline to self-identify|i decline|i do not wish to answer|choose not to identify|rather not say|wish not to disclose|do not wish to disclose/i;

  const intakeSubset = {
    gender: candidate.custom_answers?.gender,
    "race/ethnicity": candidate.custom_answers?.["race/ethnicity"],
    ethnicity: candidate.custom_answers?.ethnicity,
    veteran: candidate.custom_answers?.["veteran status"] ?? candidate.custom_answers?.veteran,
    disability: candidate.custom_answers?.disability ?? candidate.custom_answers?.["disability status"],
    sponsorship: candidate.sponsorship_required ?? candidate.custom_answers?.sponsorship,
    work_authorization:
      candidate.work_authorization ?? candidate.custom_answers?.["work authorization"],
  };

  const prompt = `You classify ONE job application form control and decide how to answer from verified facts only.

Job: ${ctx.jobTitle} at ${ctx.jobCompany}
${jd ? `\nJob description excerpt:\n${jd}\n` : ""}

Field context:
${b}

Field metadata: tag=${field.tag}, type=${field.type}, role=${field.role || ""}, required=${field.required}

Candidate facts JSON (legal answers only — never invent employers, dates, degrees, certifications):
${JSON.stringify({
    legal_name: candidate.legal_name,
    email: candidate.email,
    phone: candidate.phone,
    linkedin: candidate.linkedin,
    github: candidate.github,
    portfolio: candidate.portfolio,
    resume_summary: candidate.resume_summary,
    education: candidate.education,
    skills: candidate.skills,
    location_preferences: candidate.location_preferences,
    intake_answers: intakeSubset,
    custom_answers: candidate.custom_answers || {},
  })}

Known option texts on the control (may be empty for plain text):
${JSON.stringify(optionsList.slice(0, 80))}

Rules:
1) Prefer action "fill" with a truthful concise answer when this is a text/textarea-style question and facts exist in JSON.
2) For lists/radios/checkboxes, choose action "select" or "check" and set value to the EXACT best matching option text from the options list when possible.
3) Sensitive EEO / demographics: NEVER guess. If intake_answers / custom_answers do not contain a clear answer for this field, use action "skip" with empty value and explain why.
4) If the question is sensitive and options include "Prefer not to answer" / "Decline to self-identify" / similar, you may use action "select" with that EXACT option text ONLY when no factual answer exists in JSON — never invent demographics.
5) If unsure or facts are missing for non-sensitive prompts, prefer action "skip" with low confidence rather than inventing.
6) Keep fill answers short unless the prompt clearly needs a paragraph (max ~2000 chars).

Return JSON ONLY:
{"action":"fill"|"select"|"check"|"skip","value":"<string>","confidence":0-1,"reason":"<short>"}`;

  const obj = await callOpenAiJsonObject(prompt);
  if (!obj) return null;
  const action = String(obj.action || "").toLowerCase() as FieldClassifierAction;
  const value = String(obj.value ?? "").trim();
  const confidence = Number(obj.confidence ?? 0);
  const reason = String(obj.reason ?? "").trim();

  const allowed: FieldClassifierAction[] = ["fill", "select", "check", "skip"];
  if (!allowed.includes(action)) {
    log.warn("classifier invalid action", { action: obj.action });
    return null;
  }

  if (sensitive) {
    const hasIntake = Object.values(intakeSubset).some((v) => typeof v === "string" && v.trim().length > 0);
    if (!hasIntake) {
      if (action === "skip" || !value.trim()) {
        return {
          action: "skip",
          value: "",
          confidence: Math.min(confidence, 0.45),
          reason: reason || "sensitive field — no saved intake answer",
        };
      }
      const declineOpt = optionsList.find((o) => DECLINE_OPT.test(o));
      if (declineOpt && action === "select") {
        if (DECLINE_OPT.test(value) || norm(value) === norm(declineOpt)) {
          return { action: "select", value: declineOpt, confidence: Math.max(confidence, 0.88), reason };
        }
      }
      return {
        action: "skip",
        value: "",
        confidence: 0.22,
        reason: "sensitive field — refusing to guess without intake answers",
      };
    }
  }

  log.debug("field classifier", { action, confidence, len: value.length });
  return { action, value, confidence, reason };
}
