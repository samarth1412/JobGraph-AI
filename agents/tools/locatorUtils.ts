import type { Frame, Page } from "playwright";
import type { ExtractedField } from "../types.js";

/** Minimal escaping for CSS attribute selectors */
export function escapeAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function resolveRoot(page: Page, frameUrl?: string): Page | Frame {
  if (!frameUrl) return page;
  const hit = page.frames().find((fr) => fr.url() === frameUrl);
  return hit ?? page;
}

/** Prefer stable selectors; fall back to label-ish locator */
export function fieldLocator(root: Page | Frame, f: ExtractedField) {
  if (f.id) return root.locator(`[id="${escapeAttr(f.id)}"]`);
  if (f.name) return root.locator(`[name="${escapeAttr(f.name)}"]`);
  const hint = (f.labelsText || f.placeholder || f.ariaLabel || "").trim().slice(0, 80);
  if (hint.length >= 3) {
    const safe = hint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 48);
    return root.getByLabel(new RegExp(safe, "i"));
  }
  return root.locator("#__jg_missing_locator__");
}
