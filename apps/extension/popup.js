const statusEl = document.getElementById("status");

function setStatus(message) {
  statusEl.textContent = message;
}

document.getElementById("fill").addEventListener("click", async () => {
  const api = document.getElementById("api").value.replace(/\/$/, "");
  const candidate = document.getElementById("candidate").value || "default";
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
