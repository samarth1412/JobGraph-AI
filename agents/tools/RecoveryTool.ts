import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { createLogger } from "../logger.js";
import type { RecoverySnapshot } from "../types.js";

const log = createLogger("RecoveryTool");

export interface RecoveryOptions {
  outDir?: string;
}

/** Capture diagnostics after a failed step for debugging / retry planning */
export async function captureRecoverySnapshot(
  page: Page,
  failedAction: string,
  error: unknown,
  opts: RecoveryOptions = {}
): Promise<RecoverySnapshot> {
  const errMsg = error instanceof Error ? error.message : String(error);
  const base =
    opts.outDir ??
    path.join(process.cwd(), "agents", ".recovery", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(base, { recursive: true });

  const ts = new Date().toISOString();
  const screenshotPath = path.join(base, "viewport.png");
  const htmlPath = path.join(base, "page.html");
  const a11yPath = path.join(base, "accessibility.txt");

  try {
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
    const html = await page.content().catch(() => "");
    await writeFile(htmlPath, html, "utf8").catch(() => {});
    await writeFile(a11yPath, "(accessibility snapshot omitted — optional enrichment)", "utf8").catch(() => {});
  } catch (capErr) {
    log.warn("partial recovery capture failed", { capErr: String(capErr) });
  }

  log.error("recovery snapshot saved", { failedAction, errMsg, base });

  return {
    url: page.url(),
    screenshotPath,
    htmlSnapshotPath: htmlPath,
    a11yTreePath: a11yPath,
    failedAction,
    errorMessage: errMsg,
    timestampIso: ts,
  };
}

/** Run async work with retries and alternate strategies */
export async function withRecovery<T>(
  page: Page,
  label: string,
  strategies: Array<() => Promise<T>>,
  opts?: RecoveryOptions
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < strategies.length; i++) {
    try {
      return await strategies[i]();
    } catch (err) {
      lastErr = err;
      log.warn(`strategy ${i + 1}/${strategies.length} failed`, { label, err: String(err) });
      await captureRecoverySnapshot(page, `${label}:strategy:${i + 1}`, err, opts);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
