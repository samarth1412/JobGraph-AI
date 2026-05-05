import type { Frame, Page } from "playwright";
import { createLogger } from "../logger.js";
import type { ExtractedField } from "../types.js";

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

async function extractFromFrame(frame: Frame): Promise<ExtractedField[]> {
  const frameUrl = frame.url();
  const raw = await frame.evaluate(() => {
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
      const tag = node.tagName.toLowerCase();
      let type = (node as HTMLInputElement).type || "";
      if (tag === "textarea") type = "textarea";
      if ((node as HTMLElement).getAttribute("role") === "combobox") type = "combobox";

      const el = node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
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

  return raw.map((r) => ({
    ...r,
    selectorHint: stableHint(r, frameUrl),
    frameUrl,
  }));
}

/** Extract visible-ish fields across main page and frames */
export async function extractAllFields(page: Page): Promise<ExtractedField[]> {
  const fields: ExtractedField[] = [];
  const frames = page.frames();
  for (const frame of frames) {
    try {
      const chunk = await extractFromFrame(frame);
      fields.push(...chunk);
    } catch (err) {
      log.warn("skip frame extract", { frame: frame.url(), err: String(err) });
    }
  }
  log.info("extracted fields", { count: fields.length });
  return fields;
}
