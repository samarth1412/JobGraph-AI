import type { Locator, Page } from "playwright";
import type { CandidateProfileJson, ExtractedField, FieldMapping, NeedsReviewItem } from "./types.js";
import { fieldLocator, resolveRoot } from "./tools/locatorUtils.js";
import { captureRecoverySnapshot } from "./tools/RecoveryTool.js";
import { pickOptionForField, snapChoiceToOptions } from "./tools/OptionSelectionTool.js";
import { selectComboboxOption } from "./tools/ComboboxSelectionTool.js";
import { stagehandAct, type StagehandHandle } from "./stagehandBridge.js";
import { emitFieldTelemetry } from "./telemetry.js";
import { createLogger } from "./logger.js";

const log = createLogger("ApplySteps");

export interface ApplyExecutionOptions {
  iteration?: number;
  stagehand?: StagehandHandle | null;
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

async function fillOneControl(loc: Locator, f: ExtractedField, value: string): Promise<void> {
  const first = loc.first();
  await first.scrollIntoViewIfNeeded().catch(() => {});
  await first.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});

  const tag = f.tag;
  const type = (f.type || "").toLowerCase();

  if (tag === "textarea") {
    await first.fill(value, { timeout: 9000 });
    return;
  }

  if (tag === "input" && type === "checkbox") {
    const want =
      /^(yes|true|1|on|y|checked)$/i.test(value.trim()) ||
      norm(value) === "i agree" ||
      norm(value) === "agree";
    const checked = await first.isChecked().catch(() => false);
    if (want && !checked) await first.check({ timeout: 6000 });
    else if (!want && checked) await first.uncheck({ timeout: 6000 });
    return;
  }

  if (tag === "input" && type === "radio") {
    await first.click({ timeout: 5000 });
    return;
  }

  const editable =
    (await first.getAttribute("contenteditable").catch(() => null)) === "true" ||
    (f.role || "").toLowerCase() === "combobox";

  if (editable) {
    await first.click({ timeout: 3000 }).catch(() => {});
    await first.fill(value, { timeout: 9000 }).catch(async () => {
      await first.evaluate((el, v) => {
        el.textContent = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
    });
    return;
  }

  if (tag === "input" && ["text", "email", "tel", "url", "search", "number"].includes(type)) {
    await first.fill(value, { timeout: 9000 });
    return;
  }

  await first.fill(value, { timeout: 9000 }).catch(async () => {
    await first.click({ timeout: 2000 }).catch(() => {});
    await first.pressSequentially(value, { delay: 15, timeout: 12_000 }).catch(() => {});
  });
}

export async function applyMappings(page: Page, mappings: FieldMapping[], exec?: ApplyExecutionOptions): Promise<void> {
  const iteration = exec?.iteration;
  const sh = exec?.stagehand ?? null;
  for (const m of mappings) {
    emitFieldTelemetry({
      phase: "mapped",
      label: m.field.labelsText?.slice(0, 180),
      selectorHint: m.field.selectorHint,
      profileKey: m.profileKey,
      value: m.value.slice(0, 400),
      confidence: m.confidence,
      reason: m.source,
      iteration,
    });
    try {
      const root = resolveRoot(page, m.field.frameUrl);
      const loc = fieldLocator(root, m.field);
      await fillOneControl(loc, m.field, m.value);
      emitFieldTelemetry({
        phase: "filled",
        label: m.field.labelsText?.slice(0, 180),
        selectorHint: m.field.selectorHint,
        profileKey: m.profileKey,
        value: m.value.slice(0, 400),
        confidence: m.confidence,
        iteration,
      });
    } catch (err) {
      const labelShort = (m.field.labelsText || m.field.placeholder || "").trim().slice(0, 120);
      const healed = await stagehandAct(
        sh,
        page,
        `In the job application form, fill the field labeled "${labelShort}" with exactly this text: ${m.value.slice(0, 500)}`
      );
      if (healed) {
        emitFieldTelemetry({
          phase: "filled",
          label: m.field.labelsText?.slice(0, 180),
          selectorHint: m.field.selectorHint,
          profileKey: m.profileKey,
          value: m.value.slice(0, 400),
          confidence: m.confidence,
          reason: "stagehand_recovery",
          iteration,
        });
        continue;
      }
      emitFieldTelemetry({
        phase: "failure",
        label: m.field.labelsText?.slice(0, 180),
        selectorHint: m.field.selectorHint,
        profileKey: m.profileKey,
        failure: String(err),
        iteration,
      });
      log.warn("fill failed", { err: String(err), hint: m.field.selectorHint });
      await captureRecoverySnapshot(page, `fill:${m.profileKey}:${m.field.selectorHint}`, err);
    }
  }
}

function pseudoSelectFromRadioGroup(group: ExtractedField[]): ExtractedField {
  const rep = group[0]!;
  const options = group.map((r) => ({
    value: r.id || r.currentValue || r.name || "",
    text: (
      r.labelsText ||
      r.nearbyText ||
      r.ariaLabel ||
      r.placeholder ||
      r.currentValue ||
      "Option"
    )
      .trim()
      .slice(0, 240),
  }));
  return { ...rep, tag: "select", type: "select", options };
}

function pickRadioFromChoice(group: ExtractedField[], choiceLabel: string): ExtractedField | null {
  const labels = group.map((g) => g.labelsText || g.nearbyText || "").filter(Boolean);
  const snapped = labels.length ? snapChoiceToOptions(choiceLabel, labels) : null;
  const target = norm(snapped || choiceLabel);
  if (!target) return null;

  for (const r of group) {
    const blob = norm(`${r.labelsText} ${r.nearbyText} ${r.ariaLabel}`);
    if (blob && (blob === target || blob.includes(target) || target.includes(blob.slice(0, Math.min(blob.length, 80)))))
      return r;
  }
  const loose = snapped || choiceLabel;
  for (const r of group) {
    const t = (r.labelsText || "").trim();
    if (t && snapChoiceToOptions(loose, [t])) return r;
  }
  return null;
}

/** Same-name `<input type="radio">` groups handled like selects */
export async function collectRadioNeedsReview(
  page: Page,
  candidate: CandidateProfileJson,
  fields: ExtractedField[],
  threshold: number,
  iteration?: number
): Promise<NeedsReviewItem[]> {
  const needsReview: NeedsReviewItem[] = [];
  const radios = fields.filter((f) => f.tag === "input" && norm(f.type) === "radio" && !f.disabled);
  const groups = new Map<string, ExtractedField[]>();
  for (const r of radios) {
    const key = `${r.frameUrl || "__main__"}\x00${(r.name || "").trim() || r.selectorHint}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const pseudo = pseudoSelectFromRadioGroup(group);
    try {
      const pick = await pickOptionForField(candidate, pseudo, threshold);
      if (!pick) {
        needsReview.push({
          field: pseudo,
          reason: "could not confidently pick radio group option",
        });
        continue;
      }
      emitFieldTelemetry({
        phase: "radio",
        label: pseudo.labelsText?.slice(0, 180),
        selectorHint: pseudo.selectorHint,
        value: pick.valueText,
        confidence: pick.confidence,
        reason: pick.source,
        iteration,
      });
      const chosen = pickRadioFromChoice(group, pick.valueText);
      if (!chosen) {
        needsReview.push({
          field: pseudo,
          reason: "picked radio option but could not locate matching control",
        });
        continue;
      }
      const root = resolveRoot(page, chosen.frameUrl);
      const loc = fieldLocator(root, chosen).first();
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await loc.click({ timeout: 6000 });
    } catch (err) {
      needsReview.push({
        field: pseudoSelectFromRadioGroup(group),
        reason: `radio click failed: ${String(err)}`,
      });
      emitFieldTelemetry({
        phase: "failure",
        label: pseudo.labelsText?.slice(0, 180),
        selectorHint: pseudo.selectorHint,
        fieldKind: "radio_group",
        failure: String(err),
        iteration,
      });
      await captureRecoverySnapshot(page, "radio_group", err);
    }
  }
  return needsReview;
}

/** Select options for `<select>` controls; returns items that need human review */
export async function collectSelectNeedsReview(
  page: Page,
  candidate: CandidateProfileJson,
  fields: ExtractedField[],
  threshold: number,
  iteration?: number
): Promise<NeedsReviewItem[]> {
  const needsReview: NeedsReviewItem[] = [];
  for (const f of fields) {
    if (f.tag !== "select") continue;
    try {
      const pick = await pickOptionForField(candidate, f, threshold);
      if (!pick) {
        needsReview.push({ field: f, reason: "could not confidently pick select option" });
        continue;
      }
      emitFieldTelemetry({
        phase: "select",
        label: f.labelsText?.slice(0, 180),
        selectorHint: f.selectorHint,
        value: pick.valueText,
        confidence: pick.confidence,
        reason: pick.source,
        iteration,
      });
      const root = resolveRoot(page, f.frameUrl);
      const loc = fieldLocator(root, f).first();
      await loc.scrollIntoViewIfNeeded().catch(() => {});

      const optTexts = (f.options || []).map((o) => o.text || o.value).filter(Boolean);
      const snapped = optTexts.length > 0 ? snapChoiceToOptions(pick.valueText, optTexts) : null;
      const primary = snapped ?? pick.valueText;

      await loc.selectOption({ label: primary }).catch(async () => {
        await loc.selectOption({ value: primary }).catch(async () => {
          await loc.selectOption({ label: pick.valueText }).catch(async () => {
            await loc.selectOption({ value: pick.valueText }).catch(() => {});
          });
        });
      });
    } catch (err) {
      needsReview.push({ field: f, reason: `select failed: ${String(err)}` });
      emitFieldTelemetry({
        phase: "failure",
        label: f.labelsText?.slice(0, 180),
        selectorHint: f.selectorHint,
        fieldKind: "select",
        failure: String(err),
        iteration,
      });
      await captureRecoverySnapshot(page, `select:${f.selectorHint}`, err);
    }
  }
  return needsReview;
}

/** Combobox-style controls extracted as role=combobox / type=combobox */
export async function collectComboboxNeedsReview(
  page: Page,
  candidate: CandidateProfileJson,
  fields: ExtractedField[],
  threshold: number,
  iteration?: number
): Promise<NeedsReviewItem[]> {
  const needsReview: NeedsReviewItem[] = [];
  const combos = fields.filter(
    (f) => !f.disabled && ((f.role || "").toLowerCase() === "combobox" || (f.type || "").toLowerCase() === "combobox")
  );

  for (const f of combos) {
    const res = await selectComboboxOption(page, candidate, f, threshold, iteration);
    if (!res.ok) {
      needsReview.push({
        field: f,
        reason: res.reason || "combobox selection failed",
      });
      await captureRecoverySnapshot(page, `combobox:${f.selectorHint}`, new Error(res.reason || "combobox"));
    }
  }
  return needsReview;
}
