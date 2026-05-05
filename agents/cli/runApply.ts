import { chromium } from "playwright";
import { runHybridApply } from "../hybridApplyRunner.js";
import type { ApplyAgentOptions } from "../types.js";

type Payload = {
  applyUrl: string;
  options: ApplyAgentOptions;
};

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) throw new Error("Missing stdin payload JSON.");
  const payload = JSON.parse(raw) as Payload;
  if (!payload.applyUrl) throw new Error("Missing applyUrl.");
  const skipResume = payload.options?.skipResumeUpload === true;
  if (!skipResume && !(payload.options?.resumePdfPath || "").trim()) {
    throw new Error(
      "Missing options.resumePdfPath (set skipResumeUpload: true when the user uploads resume manually)."
    );
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(payload.applyUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const summary = await runHybridApply(page, browser, payload.options);
    process.stdout.write(JSON.stringify({ ok: true, summary }, null, 2));
  } finally {
    // Keep browser open only for review mode; otherwise close.
    if (payload.options.reviewMode === false) {
      await browser.close().catch(() => {});
    }
  }
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err?.message || err) + "\n");
  process.stdout.write(JSON.stringify({ ok: false, error: String(err) }));
  process.exit(1);
});

