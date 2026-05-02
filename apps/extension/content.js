const fieldMap = { legal_name: ["name", "full name", "legal name"], email: ["email", "e-mail"], phone: ["phone", "mobile"], linkedin: ["linkedin"], github: ["github"], portfolio: ["portfolio", "website"], work_authorization: ["work authorization", "authorized to work"], sponsorship_required: ["sponsorship", "visa"] };
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
    const label = labelFor(input);
    for (const [key, terms] of Object.entries(fieldMap)) {
      if (profile[key] && terms.some(term => label.includes(term))) {
        input.focus(); input.value = profile[key];
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  });
});
