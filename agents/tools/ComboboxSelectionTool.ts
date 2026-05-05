import type { CandidateProfileJson, ExtractedField } from "../types.js";
import { createLogger } from "../logger.js";
import { emitFieldTelemetry } from "../telemetry.js";
import { pickOptionForField, snapChoiceToOptions } from "./OptionSelectionTool.js";
import { fieldLocator, resolveRoot } from "./locatorUtils.js";
import type { Frame, Locator, Page } from "playwright";

const log = createLogger("ComboboxSelectionTool");

async function openCombobox(loc: Locator): Promise<void> {
  const first = loc.first();
  await first.scrollIntoViewIfNeeded().catch(() => {});
  await first.click({ timeout: 4000 }).catch(() => {});
  await first.press("ArrowDown").catch(() => {});
}

async function readVisibleOptions(root: Page | Frame): Promise<string[]> {
  return root.evaluate(() => {
    const selectors = [
      '[role="listbox"] [role="option"]',
      '[role="menu"] [role="menuitem"]',
      ".select__option",
      '[class*="menu-option"]',
      '[class*="dropdown-option"]',
      '[data-value]',
      "li[aria-selected]",
      '[class*="select-option"]',
    ];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el) => {
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (t.length >= 1 && t.length < 400 && !seen.has(t.toLowerCase())) {
          seen.add(t.toLowerCase());
          out.push(t);
        }
      });
    }
    return out;
  });
}

async function clickOptionByText(root: Page | Frame, choice: string): Promise<boolean> {
  const snapped = choice.trim();
  if (!snapped) return false;

  const patterns = [
    () => root.getByRole("option", { name: new RegExp(snapped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }),
    () => root.locator(".select__option").filter({ hasText: new RegExp(snapped.slice(0, 48), "i") }),
    () => root.locator('[role="option"]').filter({ hasText: new RegExp(snapped.slice(0, 48), "i") }),
    () => root.locator('[class*="menu-option"]').filter({ hasText: new RegExp(snapped.slice(0, 48), "i") }),
  ];

  for (const mk of patterns) {
    const loc = mk().first();
    const vis = await loc.isVisible().catch(() => false);
    if (!vis) continue;
    await loc.click({ timeout: 5000 }).catch(() => {});
    return true;
  }
  return false;
}

/**
 * Fill React-select / Workday / Ashby / Greenhouse combobox-style controls using OptionSelectionTool for values.
 */
export async function selectComboboxOption(
  page: Page,
  candidate: CandidateProfileJson,
  field: ExtractedField,
  minConfidence: number,
  iteration?: number
): Promise<{ ok: boolean; reason?: string; picked?: string; confidence?: number }> {
  const root = resolveRoot(page, field.frameUrl);
  const loc = fieldLocator(root, field);

  try {
    await openCombobox(loc);
    await page.waitForTimeout(350);

    let opts = await readVisibleOptions(root);
    if (!opts.length) {
      for (const fr of page.frames()) {
        if (fr === page.mainFrame()) continue;
        opts = await readVisibleOptions(fr).catch(() => []);
        if (opts.length) break;
      }
    }

    const pseudo: ExtractedField = {
      ...field,
      tag: "select",
      type: "select",
      options: opts.map((t) => ({ value: t, text: t })),
    };

    const pick = await pickOptionForField(candidate, pseudo, minConfidence);
    if (!pick) {
      emitFieldTelemetry({
        phase: "failure",
        label: field.labelsText?.slice(0, 180),
        selectorHint: field.selectorHint,
        fieldKind: "combobox",
        reason: "no confident combobox pick",
        iteration,
      });
      await loc.press("Escape").catch(() => {});
      return { ok: false, reason: "no confident combobox pick" };
    }

    const snapped = opts.length ? snapChoiceToOptions(pick.valueText, opts) : null;
    const primary = snapped ?? pick.valueText;
    const clicked = await clickOptionByText(root, primary).catch(() => false);

    emitFieldTelemetry({
      phase: "combobox",
      label: field.labelsText?.slice(0, 180),
      selectorHint: field.selectorHint,
      fieldKind: "combobox",
      value: primary,
      confidence: pick.confidence,
      reason: pick.source,
      iteration,
    });

    if (!clicked) {
      await loc.press("Escape").catch(() => {});
      return { ok: false, reason: "could not click combobox option", picked: primary, confidence: pick.confidence };
    }

    log.info("combobox selected", { primary, confidence: pick.confidence });
    return { ok: true, picked: primary, confidence: pick.confidence };
  } catch (err) {
    emitFieldTelemetry({
      phase: "failure",
      label: field.labelsText?.slice(0, 180),
      selectorHint: field.selectorHint,
      fieldKind: "combobox",
      failure: String(err),
      iteration,
    });
    return { ok: false, reason: String(err) };
  }
}
