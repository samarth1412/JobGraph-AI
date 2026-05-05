import type { Browser, Page } from "playwright";

function browserCdpUrl(browser: Browser): string {
  const anyBrowser = browser as unknown as { wsEndpoint?: () => string };
  const ws = anyBrowser.wsEndpoint?.();
  if (!ws) throw new Error("Browser wsEndpoint unavailable — use Chromium launch for Stagehand CDP attach.");
  return ws;
}
import { createLogger } from "./logger.js";

const log = createLogger("StagehandBridge");

export type StagehandHandle = {
  act(instruction: string, options?: { page?: Page; timeout?: number }): Promise<{ success: boolean; message?: string }>;
  close(options?: { force?: boolean }): Promise<void>;
};

/**
 * Attach Stagehand v3 to an existing Playwright Chromium instance via CDP.
 * Disabled when APPLY_STAGEHAND=0 or init fails.
 */
export async function initStagehandForBrowser(browser: Browser): Promise<StagehandHandle | null> {
  if (process.env.APPLY_STAGEHAND === "0") {
    log.info("Stagehand disabled via APPLY_STAGEHAND=0");
    return null;
  }
  try {
    const mod = await import("@browserbasehq/stagehand");
    const Stagehand = (mod as { Stagehand?: unknown; default?: unknown }).Stagehand ?? mod.default;
    if (typeof Stagehand !== "function") {
      log.warn("Stagehand export missing");
      return null;
    }
    const modelName = (process.env.STAGEHAND_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini") as string;
    const inst = new (Stagehand as new (opts: Record<string, unknown>) => {
      init(): Promise<void>;
      act(
        instruction: string,
        options?: { page?: Page; timeout?: number }
      ): Promise<{ success: boolean; message?: string }>;
      close(options?: { force?: boolean }): Promise<void>;
    })({
      env: "LOCAL",
      localBrowserLaunchOptions: { cdpUrl: browserCdpUrl(browser) },
      model: modelName,
      verbose: 0,
      disablePino: true,
    });
    await inst.init();
    log.info("Stagehand attached via CDP");
    return inst;
  } catch (err) {
    log.warn("Stagehand init failed — continuing Playwright-only", { err: String(err) });
    return null;
  }
}

export async function stagehandAct(inst: StagehandHandle | null, page: Page, instruction: string): Promise<boolean> {
  if (!inst) return false;
  try {
    const res = await inst.act(instruction, { page, timeout: 28_000 });
    return Boolean(res.success);
  } catch {
    return false;
  }
}
