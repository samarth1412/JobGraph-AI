import { createLogger } from "../logger.js";

const log = createLogger("OpenAI fallback");

const REQUEST_MS = Math.min(120_000, Number(process.env.OPENAI_TIMEOUT_MS || 45_000) || 45_000);

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const ms = init.timeoutMs ?? REQUEST_MS;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function oneCompletion(
  key: string,
  model: string,
  prompt: string
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null; rawText: string }> {
  const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You output ONLY compact JSON. Never invent facts not grounded in provided resume/job context.",
        },
        { role: "user", content: prompt },
      ],
    }),
    timeoutMs: REQUEST_MS,
  });
  const rawText = await res.text().catch(() => "");
  if (!res.ok) {
    return { ok: false, status: res.status, body: null, rawText };
  }
  try {
    const data = JSON.parse(rawText) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { ok: true, status: res.status, body: null, rawText };
    return { ok: true, status: res.status, body: JSON.parse(content) as Record<string, unknown>, rawText };
  } catch {
    return { ok: false, status: res.status, body: null, rawText };
  }
}

export async function callOpenAiJsonObject(prompt: string): Promise<Record<string, unknown> | null> {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!key) {
    log.debug("OPENAI_API_KEY not set — skipping LLM fallback");
    return null;
  }

  try {
    let attempt = await oneCompletion(key, model, prompt);
    if (!attempt.ok && (attempt.status === 429 || attempt.status >= 500)) {
      log.warn("OpenAI retry after transient error", { status: attempt.status });
      await new Promise((r) => setTimeout(r, 900));
      attempt = await oneCompletion(key, model, prompt);
    }
    if (!attempt.ok) {
      log.warn("OpenAI HTTP error", { status: attempt.status, body: attempt.rawText.slice(0, 800) });
      return null;
    }
    return attempt.body;
  } catch (e) {
    log.error("OpenAI call failed", { err: String(e) });
    return null;
  }
}
