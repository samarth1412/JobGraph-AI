import path from "node:path";
import type { Frame, Locator, Page } from "playwright";
import type { AtsAdapter } from "../adapters/index.js";
import { createLogger } from "../logger.js";
import type { ResumeUploadResult } from "../types.js";
import { withRecovery } from "./RecoveryTool.js";

const log = createLogger("ResumeUploadTool");

function allContexts(page: Page): (Page | Frame)[] {
  const frames = page.frames();
  return [page, ...frames.filter((f) => f !== page.mainFrame())];
}

async function clickUploadHelper(page: Page, adapter: AtsAdapter): Promise<boolean> {
  const hints = adapter.resumeUploadButtonHints.map((h) => h.toLowerCase());
  const selectors = [
    "button",
    "a",
    "[role='button']",
    "label",
    "span",
    "div",
  ];
  for (const ctx of allContexts(page)) {
    for (const sel of selectors) {
      const loc = ctx.locator(sel);
      const count = await loc.count().catch(() => 0);
      for (let i = 0; i < Math.min(count, 80); i++) {
        const el = loc.nth(i);
        const vis = await el.isVisible().catch(() => false);
        if (!vis) continue;
        const text = ((await el.innerText().catch(() => "")) || "").trim().slice(0, 120);
        const lower = text.toLowerCase();
        if (!lower) continue;
        const match =
          hints.some((h) => lower.includes(h)) ||
          /upload\s*resume|attach\s*resume|choose\s*file|select\s*file|add\s*resume/i.test(text);
        if (match) {
          await el.click({ timeout: 4000 }).catch(() => {});
          log.info("clicked upload helper", { text });
          return true;
        }
      }
    }
  }
  return false;
}

async function verifyUploadLikelySuccess(page: Page): Promise<boolean> {
  const positive =
    (await page.getByText(/\.pdf|\.docx|resume attached|upload complete|file uploaded|successfully uploaded/i).first().isVisible().catch(() => false)) ||
    (await page.locator("[class*='filename'], [data-filename]").first().isVisible().catch(() => false));
  const errVisible = await page.locator(".field-error, .error, [role='alert']").first().isVisible().catch(() => false);
  return Boolean(positive && !errVisible);
}

/**
 * Upload resume via Playwright: hidden file inputs supported via setInputFiles({ force: true }).
 */
export async function uploadResume(
  page: Page,
  resumePdfPath: string,
  adapter: AtsAdapter
): Promise<ResumeUploadResult> {
  const resolved = path.resolve(resumePdfPath);

  await clickUploadHelper(page, adapter).catch(() => {});

  const uploadViaLocator = async (loc: Locator) => {
    await loc
      .evaluate((el: HTMLInputElement) => {
        try {
          el.removeAttribute("hidden");
          el.style.display = "block";
          el.style.opacity = "1";
          el.style.position = "fixed";
          el.style.left = "-9999px";
        } catch {
          /* noop */
        }
      })
      .catch(() => {});
    await loc.setInputFiles(resolved, { timeout: 15000 });
  };

  try {
    await withRecovery(page, "resume_upload", [
      async () => {
        const main = page.locator('input[type="file"]').first();
        if ((await main.count()) > 0) {
          await uploadViaLocator(main);
          return;
        }
        throw new Error("no file input on main frame");
      },
      async () => {
        for (const ctx of allContexts(page)) {
          const loc = ctx.locator('input[type="file"]').first();
          if ((await loc.count()) > 0) {
            await uploadViaLocator(loc);
            return;
          }
        }
        throw new Error("no file input in any frame");
      },
      async () => {
        await clickUploadHelper(page, adapter);
        const loc = page.locator('input[type="file"]').first();
        if ((await loc.count()) === 0) throw new Error("still no file input after helper click");
        await uploadViaLocator(loc);
      },
    ]);

    await page.waitForTimeout(800);
    const verified = await verifyUploadLikelySuccess(page);
    log.info("resume setInputFiles completed", { resolved, verified });

    return {
      ok: true,
      pathUsed: resolved,
      detail: verified ? "Upload verified by UI hint" : "Uploaded file; UI verification inconclusive",
    };
  } catch (e) {
    log.error("resume upload failed", { resolved, err: String(e) });
    return { ok: false, pathUsed: resolved, detail: String(e) };
  }
}
