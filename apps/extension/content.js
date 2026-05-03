const fieldMap = {
  legal_name: ["name", "full name", "legal name", "preferred name", "first and last"],
  email: ["email", "e-mail"],
  phone: ["phone", "mobile", "telephone"],
  linkedin: ["linkedin", "linked in"],
  github: ["github", "git hub"],
  portfolio: ["portfolio", "website", "personal site"],
  work_authorization: ["work authorization", "authorized to work", "legally authorized", "eligible to work"],
  sponsorship_required: ["sponsorship", "visa", "require sponsorship", "future sponsorship"],
};

const yesTerms = ["yes", "y", "true"];
const noTerms = ["no", "n", "false"];

function labelFor(input) {
  const id = input.getAttribute("id");
  const aria = input.getAttribute("aria-label") || "";
  const name = input.getAttribute("name") || "";
  const placeholder = input.getAttribute("placeholder") || "";
  const title = input.getAttribute("title") || "";
  const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.innerText || "" : "";
  const wrapper = input.closest("label, div, fieldset")?.innerText || "";
  return `${aria} ${name} ${placeholder} ${title} ${label} ${wrapper}`.toLowerCase();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "JOBGRAPH_AUTOFILL") return;
  const stats = fillProfile(message.profile);
  showJobGraphBanner(stats, "Manual autofill complete. Review before submitting.");
});

async function autoFillIfEnabled() {
  chrome.storage.local.get(["jobgraphApi", "jobgraphCandidate", "jobgraphAutoFill"], async (settings) => {
    const api = (settings.jobgraphApi || "http://127.0.0.1:8022").replace(/\/$/, "");
    const candidate = settings.jobgraphCandidate || "default";
    try {
      const session = await fetchActiveApplySession(api, candidate);
      if (session?.active) {
        const stats = fillProfile(session.session.autofill_profile || {});
        await fetch(`${api}/apply-session/${session.session.id}/filled`, { method: "POST" }).catch(() => {});
        showJobGraphBanner(stats, "Apply session detected. Known fields were filled from your resume profile.");
        return;
      }
      if (!settings.jobgraphAutoFill) return;
      const response = await fetch(`${api}/autofill/${encodeURIComponent(candidate)}`);
      if (!response.ok) return;
      const stats = fillProfile(await response.json());
      showJobGraphBanner(stats, "Auto-fill enabled. Known fields were filled from your resume profile.");
    } catch {
      // Silent by design: application pages should not show extension errors.
    }
  });
}

async function fetchActiveApplySession(api, candidate) {
  const response = await fetch(`${api}/apply-session/${encodeURIComponent(candidate)}/active?url=${encodeURIComponent(window.location.href)}`);
  if (!response.ok) return null;
  return response.json();
}

function fillProfile(profile) {
  const filled = new Set();
  let filledCount = 0;
  document.querySelectorAll("input, textarea, select").forEach((input) => {
    if (input.type === "file" || input.type === "hidden" || input.disabled || input.readOnly) return;
    const label = labelFor(input);
    const direct = directValue(profile, label);
    const custom = customAnswer(profile, label);
    const value = direct || custom;
    if (!value) return;

    if (input.tagName === "SELECT") {
      if (selectOption(input, value)) {
        filled.add(input);
        filledCount += 1;
      }
      return;
    }

    if (input.type === "checkbox" || input.type === "radio") {
      if (chooseBoolean(input, value, label)) {
        filled.add(input);
        filledCount += 1;
      }
      return;
    }

    setNativeValue(input, value);
    filled.add(input);
    filledCount += 1;
  });
  const requiredCount = markUnknownRequired(filled);
  const fileCount = markFileInputs();
  return { filledCount, requiredCount, fileCount };
}

function directValue(profile, label) {
  for (const [key, terms] of Object.entries(fieldMap)) {
    if (profile[key] && terms.some((term) => label.includes(term))) return profile[key];
  }
  const education = profile.education || {};
  if (education.school && /school|university|college/.test(label)) return education.school;
  if (education.degree && /degree/.test(label)) return education.degree;
  return "";
}

function customAnswer(profile, label) {
  const answers = profile.custom_answers || {};
  for (const [question, answer] of Object.entries(answers)) {
    if (answer && label.includes(question.toLowerCase().slice(0, 48))) return answer;
  }
  return "";
}

function selectOption(select, value) {
  const normalized = String(value).toLowerCase();
  const option = Array.from(select.options).find((item) => {
    const text = `${item.text} ${item.value}`.toLowerCase();
    return text.includes(normalized) || normalized.includes(text.trim());
  });
  if (!option) return false;
  select.value = option.value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function chooseBoolean(input, value, label) {
  const normalized = String(value).toLowerCase();
  const wantsYes = yesTerms.some((term) => normalized.includes(term));
  const wantsNo = noTerms.some((term) => normalized.includes(term));
  const optionText = labelFor(input);
  if ((wantsYes && /yes|authorized|agree|true/.test(optionText)) || (wantsNo && /no|not|false/.test(optionText))) {
    input.checked = true;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  return false;
}

function setNativeValue(input, value) {
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function markUnknownRequired(filled) {
  let count = 0;
  document.querySelectorAll("input[required], textarea[required], select[required]").forEach((input) => {
    if (filled.has(input) || input.value) return;
    input.style.outline = "2px solid #b58cf4";
    input.dataset.jobgraphNeedsReview = "true";
    count += 1;
  });
  return count;
}

function markFileInputs() {
  let count = 0;
  document.querySelectorAll("input[type='file']").forEach((input) => {
    input.style.outline = "2px solid #00de8a";
    input.dataset.jobgraphNeedsResumeUpload = "true";
    count += 1;
  });
  return count;
}

function showJobGraphBanner(stats, message) {
  const existing = document.getElementById("jobgraph-autofill-banner");
  if (existing) existing.remove();
  const banner = document.createElement("div");
  banner.id = "jobgraph-autofill-banner";
  banner.style.cssText = [
    "position:fixed",
    "right:18px",
    "bottom:18px",
    "z-index:2147483647",
    "max-width:360px",
    "background:#171717",
    "color:white",
    "border:1px solid rgba(255,255,255,0.18)",
    "border-radius:12px",
    "box-shadow:0 18px 60px rgba(0,0,0,0.35)",
    "padding:14px",
    "font-family:Arial,sans-serif",
    "font-size:13px",
    "line-height:1.4",
  ].join(";");
  banner.innerHTML = `
    <div style="font-weight:700;margin-bottom:6px">JobGraph AI Autofill</div>
    <div>${escapeHtml(message)}</div>
    <div style="margin-top:8px;color:#d4d4d8">
      Filled ${stats.filledCount || 0} fields.
      ${stats.requiredCount ? `${stats.requiredCount} required fields need review.` : "No empty required fields detected."}
      ${stats.fileCount ? `${stats.fileCount} file upload field${stats.fileCount === 1 ? "" : "s"} must be selected manually.` : ""}
    </div>
    <div style="margin-top:8px;color:#b58cf4;font-weight:700">Review everything. JobGraph will not submit for you.</div>
  `;
  document.body.appendChild(banner);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

setTimeout(autoFillIfEnabled, 900);
