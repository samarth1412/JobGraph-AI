import type { Frame, Page } from "playwright";
import { createLogger } from "../logger.js";
import type { ExtractedField } from "../types.js";
import { emitFieldTelemetry } from "../telemetry.js";

const log = createLogger("FieldExtractionTool");

interface RawExtracted {
  selectorHint: string;
  tag: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  ariaLabel: string;
  role: string;
  labelsText: string;
  nearbyText: string;
  required: boolean;
  disabled: boolean;
  currentValue: string;
  options?: Array<{ value: string; text: string }>;
}

function stableHint(el: RawExtracted, frameUrl: string): string {
  const key = [frameUrl, el.tag, el.type, el.name, el.id, el.placeholder].join("|");
  return key.slice(0, 400);
}

function dedupeKeyField(f: ExtractedField): string {
  const label = (f.labelsText || "").replace(/\s+/g, " ").trim().slice(0, 160).toLowerCase();
  return [f.frameUrl || "", f.tag, f.type, f.name, f.id, label].join("|").slice(0, 450);
}

async function extractFromFrame(frame: Frame, iteration?: number): Promise<ExtractedField[]> {
  const frameUrl = frame.url();
  const raw = await frame.evaluate(() => {
    function isVisible(el: Element): boolean {
      if (!(el instanceof HTMLElement)) return false;
      if (typeof el.checkVisibility === "function") {
        try {
          return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
        } catch {
          /* fall through */
        }
      }
      const style = window.getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return false;
      if (rect.width < 1 && rect.height < 1) return false;
      return true;
    }

    function nearby(el: Element, depth: number): string {
      let p: Element | null = el.parentElement;
      let d = 0;
      const chunks: string[] = [];
      while (p && d < depth) {
        const t = (p.textContent || "").replace(/\s+/g, " ").trim();
        if (t && t.length < 400) chunks.push(t);
        p = p.parentElement;
        d++;
      }
      return chunks.join(" :: ").slice(0, 500);
    }

    function labelsFor(input: Element): string {
      const parts: string[] = [];
      const aria = input.getAttribute("aria-label");
      if (aria) parts.push(aria);
      const labelledBy = input.getAttribute("aria-labelledby");
      if (labelledBy) {
        labelledBy.split(/\s+/).forEach((id) => {
          const node = document.getElementById(id);
          if (node?.textContent) parts.push(node.textContent.trim());
        });
      }
      const id = input.getAttribute("id");
      if (id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lbl?.textContent) parts.push(lbl.textContent.trim());
      }
      const wrap = input.closest("label");
      if (wrap?.textContent) parts.push(wrap.textContent.trim());
      return parts.join(" ").slice(0, 500);
    }

    const out: RawExtracted[] = [];
    const nodes = Array.from(
      document.querySelectorAll('input, textarea, select, [role="combobox"], [contenteditable="true"]')
    );

    for (const node of nodes) {
      if (!isVisible(node)) continue;

      const tag = node.tagName.toLowerCase();
      let type = (node as HTMLInputElement).type || "";
      if (tag === "textarea") type = "textarea";
      if ((node as HTMLElement).getAttribute("role") === "combobox") type = "combobox";

      const el = node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (el.disabled) continue;
      if ("readOnly" in el && (el as HTMLInputElement).readOnly) continue;

      const options =
        tag === "select"
          ? Array.from((node as HTMLSelectElement).options).map((o) => ({
              value: o.value,
              text: (o.text || "").trim(),
            }))
          : undefined;

      out.push({
        selectorHint: "",
        tag,
        type,
        name: el.getAttribute("name") || "",
        id: el.getAttribute("id") || "",
        placeholder: (el as HTMLInputElement).placeholder || "",
        ariaLabel: el.getAttribute("aria-label") || "",
        role: el.getAttribute("role") || "",
        labelsText: labelsFor(node),
        nearbyText: nearby(node, 4),
        required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true",
        disabled: (el as HTMLInputElement).disabled === true,
        currentValue:
          tag === "select"
            ? (el as HTMLSelectElement).value || ""
            : (el as HTMLInputElement).value || (node.textContent || "").trim(),
        options,
      });
    }
    return out;
  });

  const mapped = raw.map((r) => ({
    ...r,
    selectorHint: stableHint(r, frameUrl),
    frameUrl,
  }));

  const seen = new Set<string>();
  const deduped: ExtractedField[] = [];
  for (const f of mapped) {
    const key = dedupeKeyField(f);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(f);
  }

  for (const f of deduped) {
    emitFieldTelemetry({
      phase: "detected",
      label: f.labelsText?.slice(0, 180),
      selectorHint: f.selectorHint,
      fieldKind: `${f.tag}:${f.type}`,
      iteration,
    });
  }

  return deduped;
}

/** Extract visible, enabled fields across main page and frames */
export async function extractAllFields(page: Page, iteration?: number): Promise<ExtractedField[]> {
  const fields: ExtractedField[] = [];
  const frames = page.frames();
  for (const frame of frames) {
    try {
      const chunk = await extractFromFrame(frame, iteration);
      fields.push(...chunk);
    } catch (err) {
      log.warn("skip frame extract", { frame: frame.url(), err: String(err) });
    }
  }
  log.info("extracted fields", { count: fields.length });
  return fields;
}
