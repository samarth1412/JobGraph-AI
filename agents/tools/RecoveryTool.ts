import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { createLogger } from "../logger.js";
import type { RecoverySnapshot } from "../types.js";

const log = createLogger("RecoveryTool");

export interface RecoveryOptions {
  outDir?: string;
}

function sanitizeSegment(label: string): string {
  return label.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

/** Capture diagnostics after a failed step for debugging / retry planning */
export async function captureRecoverySnapshot(
  page: Page,
  failedAction: string,
  error: unknown,
  opts: RecoveryOptions = {}
): Promise<RecoverySnapshot> {
  const errMsg = error instanceof Error ? error.message : String(error);
  const baseRoot =
    opts.outDir ??
    path.join(process.cwd(), "agents", ".recovery", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(baseRoot, { recursive: true });

  const ts = new Date().toISOString();
  const segment = `${sanitizeSegment(failedAction)}_${Date.now()}`;
  const base = path.join(baseRoot, segment);
  await mkdir(base, { recursive: true });

  const screenshotPath = path.join(base, "viewport.png");
  const htmlPath = path.join(base, "dom.html");
  const a11yPath = path.join(base, "dom_outline.txt");
  const urlPath = path.join(base, "url.txt");

  try {
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
    const html = await page.content().catch(() => "");
    await writeFile(htmlPath, html, "utf8").catch(() => {});

    const outline = await page
      .evaluate(() => {
        const lines: string[] = [];
        if (!document.body) return "";
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let node: Node | null = walker.currentNode;
        let count = 0;
        while (node && count++ < 1200) {
          const el = node as HTMLElement;
          const tag = el.tagName?.toLowerCase() || "";
          const role = el.getAttribute("role") || "";
          const nm = el.getAttribute("aria-label") || el.getAttribute("name") || "";
          const id = el.id ? `#${el.id}` : "";
          const typ = el.getAttribute("type") || "";
          if (
            ["input", "textarea", "select", "button", "a", "label"].includes(tag) ||
            role ||
            (tag === "div" && el.className && /select|dropdown|combobox|menu/i.test(el.className))
          ) {
            lines.push(`${tag}${id} type=${typ} role=${role} name=${nm.slice(0, 120)}`);
          }
          node = walker.nextNode();
        }
        return lines.join("\n");
      })
      .catch(() => "");
    await writeFile(a11yPath, outline, "utf8").catch(() => {});
    await writeFile(urlPath, page.url(), "utf8").catch(() => {});
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
