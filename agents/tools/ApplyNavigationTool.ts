import type { Frame, Page } from "playwright";
import type { AtsAdapter } from "../adapters/index.js";
import { createLogger } from "../logger.js";
import type { NavigationResult } from "../types.js";
import { captureRecoverySnapshot } from "./RecoveryTool.js";

const log = createLogger("ApplyNavigationTool");

const FORM_HINT =
  "input:not([type='hidden']):not([type='submit']), textarea, select, [contenteditable='true'], [role='combobox']";

const FORBIDDEN_SUBMIT = /^(submit(\s+application)?|send\s+application|finish\s+application)$/i;

/** Fewer DOM probes = faster navigation (was 120 × slow visibility checks) */
const MAX_ELEMENTS_SCAN = 42;

function normalizeBtnText(t: string): string {
  return t.replace(/\s+/g, " ").trim().slice(0, 140).toLowerCase();
}

async function hasVisibleForm(root: Page | Frame): Promise<boolean> {
  return root
    .locator(FORM_HINT)
    .locator(":visible")
    .first()
    .isVisible()
    .catch(() => false);
}

async function clickAdapterSelectors(page: Page, adapter: AtsAdapter): Promise<boolean> {
  for (const sel of adapter.applyEntrySelectors) {
    try {
      const loc = page.locator(sel).first();
      if ((await loc.count()) && (await loc.isVisible())) {
        await loc.click({ timeout: 4500 });
        log.info("clicked adapter selector", { sel });
        return true;
      }
    } catch {
      /* try next */
    }
  }
  return false;
}

/** ATS landing pages often expose a single obvious Apply control */
async function clickProminentApplyEntry(page: Page): Promise<boolean> {
  const tryClick = async (loc: ReturnType<Page["locator"]>): Promise<boolean> => {
    try {
      const target = loc.first();
      if (await target.isVisible().catch(() => false)) {
        await target.click({ timeout: 5000 });
        log.info("clicked prominent apply entry");
        return true;
      }
    } catch {
      /* next */
    }
    return false;
  };

  if (
    await tryClick(
      page.getByRole("link", {
        name: /apply for this job|apply for this position|apply now|easy apply|start application|^apply$/i,
      })
    )
  ) {
    return true;
  }
  if (
    await tryClick(
      page.getByRole("button", {
        name: /apply for this job|apply for this position|apply now|easy apply|start application|^apply$/i,
      })
    )
  ) {
    return true;
  }
  if (await tryClick(page.locator("a[href*='apply']").filter({ hasText: /apply/i }).first())) {
    return true;
  }
  return false;
}

async function clickByTextHints(page: Page, adapter: AtsAdapter): Promise<boolean> {
  const hints = adapter.continueTextHints;
  const selectors = ["button", "a", "[role='button']", "input[type='submit']"];
  for (const sel of selectors) {
    const loc = page.locator(sel);
    const count = await loc.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, MAX_ELEMENTS_SCAN); i++) {
      const el = loc.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const raw =
        ((await el.innerText().catch(() => "")) || (await el.getAttribute("value").catch(() => "")) || "").trim();
      const norm = normalizeBtnText(raw);
      if (!norm || norm.length > 120) continue;
      if (FORBIDDEN_SUBMIT.test(norm)) continue;
      if (hints.some((h) => norm.includes(h))) {
        await el.click({ timeout: 4500 }).catch(() => {});
        log.info("clicked continue hint", { raw });
        return true;
      }
      if (/^apply$|^apply now$|^start application$|^easy apply$|apply for this job/.test(norm)) {
        await el.click({ timeout: 4500 }).catch(() => {});
        log.info("clicked apply-ish", { raw });
        return true;
      }
    }
  }
  return false;
}

async function adoptLatestPage(contextPages: Page[]): Promise<Page> {
  if (!contextPages.length) throw new Error("no pages in context");
  return contextPages[contextPages.length - 1]!;
}

/**
 * Navigate from job URL until application-like form is visible.
 * Tuned for speed: prominent Apply first, no mouse-wheel jitter, short waits.
 */
export async function navigateToApplicationForm(
  startPage: Page,
  adapter: AtsAdapter,
  options: { reviewMode?: boolean; maxSteps?: number } = {}
): Promise<{ page: Page; result: NavigationResult }> {
  void options.reviewMode;
  const maxSteps = options.maxSteps ?? 10;
  const steps: string[] = [];
  let page = startPage;

  const waitStable = async () => {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(160);
  };

  if (!(await hasVisibleForm(page))) {
    for (let step = 0; step < maxSteps; step++) {
      if (await hasVisibleForm(page)) break;

      const beforePages = page.context().pages();

      let progressed = false;
      progressed ||= await clickProminentApplyEntry(page);
      if (!progressed) progressed = await clickAdapterSelectors(page, adapter);
      if (!progressed) progressed = await clickByTextHints(page, adapter);

      await waitStable();

      const afterPages = page.context().pages();
      if (afterPages.length > beforePages.length) {
        page = await adoptLatestPage(afterPages);
        steps.push("switched to new tab/popup");
        await waitStable();
      }

      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
          if (await hasVisibleForm(frame)) {
            steps.push(`form detected in frame ${frame.url()}`);
            break;
          }
        } catch {
          /* cross-origin */
        }
      }

      if (await hasVisibleForm(page)) break;

      if (!progressed) {
        await captureRecoverySnapshot(page, `navigate:stuck_step_${step}`, new Error("no clickable progression"));
        steps.push(`stuck at step ${step}`);
        break;
      }
      steps.push(`navigation step ${step + 1}`);
    }
  }

  const ok = await hasVisibleForm(page);
  log.info("navigation complete", { ok, url: page.url(), steps: steps.length });

  return {
    page,
    result: {
      ok,
      finalUrl: page.url(),
      steps,
    },
  };
}
