document.getElementById("fill").addEventListener("click", async () => {
  const api = document.getElementById("api").value;
  const candidate = document.getElementById("candidate").value;
  const profile = await fetch(`${api}/autofill/${candidate}`).then(r => r.json());
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.tabs.sendMessage(tab.id, { type: "JOBGRAPH_AUTOFILL", profile });
  document.getElementById("status").textContent = "Filled fields where labels matched. Review before submitting.";
});
