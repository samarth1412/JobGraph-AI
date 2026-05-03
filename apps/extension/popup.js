const statusEl = document.getElementById("status");
const apiEl = document.getElementById("api");
const candidateEl = document.getElementById("candidate");
const autoEl = document.getElementById("auto");

function setStatus(message) {
  statusEl.textContent = message;
}

chrome.storage.local.get(["jobgraphApi", "jobgraphCandidate", "jobgraphAutoFill"], (settings) => {
  if (settings.jobgraphApi) apiEl.value = settings.jobgraphApi;
  if (settings.jobgraphCandidate) candidateEl.value = settings.jobgraphCandidate;
  autoEl.checked = Boolean(settings.jobgraphAutoFill);
});

autoEl.addEventListener("change", async () => {
  await chrome.storage.local.set({
    jobgraphApi: apiEl.value.replace(/\/$/, ""),
    jobgraphCandidate: candidateEl.value || "default",
    jobgraphAutoFill: autoEl.checked,
  });
  setStatus(autoEl.checked ? "Auto-fill enabled for application pages." : "Auto-fill disabled.");
});

document.getElementById("fill").addEventListener("click", async () => {
  const api = apiEl.value.replace(/\/$/, "");
  const candidate = candidateEl.value || "default";
  await chrome.storage.local.set({ jobgraphApi: api, jobgraphCandidate: candidate, jobgraphAutoFill: autoEl.checked });
  setStatus("Fetching autofill profile...");

  try {
    const response = await fetch(`${api}/autofill/${encodeURIComponent(candidate)}`);
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const profile = await response.json();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: "JOBGRAPH_AUTOFILL", profile });
    setStatus("Filled matching fields. Review everything before submitting.");
  } catch (error) {
    setStatus(`Autofill failed: ${error.message}. Make sure FastAPI is running and reload the application page.`);
  }
});
