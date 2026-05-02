const fieldMap = {
  legal_name: ["name", "full name", "legal name", "preferred name", "first and last"],
  email: ["email", "e-mail"],
  phone: ["phone", "mobile", "telephone"],
  linkedin: ["linkedin", "linked in"],
  github: ["github", "git hub"],
  portfolio: ["portfolio", "website", "personal site"],
  work_authorization: ["work authorization", "authorized to work", "legally authorized"],
  sponsorship_required: ["sponsorship", "visa", "require sponsorship"],
};

function labelFor(input) {
  const id = input.getAttribute("id");
  const aria = input.getAttribute("aria-label") || "";
  const name = input.getAttribute("name") || "";
  const placeholder = input.getAttribute("placeholder") || "";
  const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.innerText || "" : "";
  return `${aria} ${name} ${placeholder} ${label}`.toLowerCase();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "JOBGRAPH_AUTOFILL") return;
  const profile = message.profile;
  document.querySelectorAll("input, textarea, select").forEach((input) => {
    if (input.type === "file" || input.type === "hidden" || input.disabled || input.readOnly) return;
    const label = labelFor(input);
    for (const [key, terms] of Object.entries(fieldMap)) {
      if (profile[key] && terms.some((term) => label.includes(term))) {
        input.focus();
        input.value = profile[key];
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  });
});
