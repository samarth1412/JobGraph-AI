import type { CandidateProfileJson, JobContextJson } from "../types.js";
import { callOpenAiJsonObject } from "../llm/openaiFallback.js";
import { createLogger } from "../logger.js";

const log = createLogger("CustomQuestionAnswerTool");

export interface CustomAnswerResult {
  answer: string;
  confidence: number;
  storedForReview: boolean;
}

/**
 * Short truthful answers for supplemental questions (resume + job posting context).
 * Never invents employers/titles not present in candidate JSON.
 */
export async function answerCustomQuestion(input: {
  questionLabelBlob: string;
  candidate: CandidateProfileJson;
  job: JobContextJson;
}): Promise<CustomAnswerResult | null> {
  const prompt = `Write a concise truthful answer (max ~900 chars) for a job application question.

Question/context:
${input.questionLabelBlob}

Candidate JSON (only source of facts):
${JSON.stringify(input.candidate)}

Job context:
Title: ${input.job.title || ""}
Company: ${input.job.company || ""}
Description excerpt:
${(input.job.description || "").slice(0, 6000)}

Return JSON ONLY:
{"answer":"<text>","confidence":0-1}

If you cannot answer truthfully from candidate JSON, return {"answer":"","confidence":0.2}`;

  const obj = await callOpenAiJsonObject(prompt);
  if (!obj) return null;
  const answer = String(obj.answer || "");
  const confidence = Number(obj.confidence ?? 0);
  log.debug("custom answer", { confidence, len: answer.length });
  return {
    answer,
    confidence,
    storedForReview: true,
  };
}
