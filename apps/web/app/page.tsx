"use client";

import { useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8020";

type Job = {
  job_id: string;
  source: string;
  title: string;
  company: string;
  location: string;
  work_model: string;
  description: string;
  apply_url: string;
  required_skills: string[];
};

type Match = {
  job: Job;
  score: number;
  matched_skills: string[];
  missing_skills: string[];
  explanation: string;
  model_source: string;
};

type Metrics = {
  jobs_total: number;
  candidates_total: number;
  applications_total: number;
  ingestion_runs_total: number;
  jobs_by_source: Record<string, number>;
  model: string;
  next_model: string;
};

type ApplicationEvent = {
  candidate_id: string;
  job_id: string;
  status: string;
  note: string;
  timestamp: string;
};

type IntegrationStatus = {
  adzuna_configured: boolean;
  usajobs_configured: boolean;
  jsearch_configured: boolean;
  usajobs_user_agent: string;
};

type IngestionRun = {
  id: number;
  query: string;
  location: string;
  sources: string[];
  jobs_found: number;
  jobs_saved: number;
  status: string;
  error: string;
  started_at: string;
  finished_at?: string;
};

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`GET ${path} failed`);
  return response.json();
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`POST ${path} failed`);
  return response.json();
}

async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`PUT ${path} failed`);
  return response.json();
}

export default function Home() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [applications, setApplications] = useState<ApplicationEvent[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);
  const [runs, setRuns] = useState<IngestionRun[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [agentPrompt, setAgentPrompt] = useState("Find my strongest ML new grad jobs and explain the top match.");
  const [agentOutput, setAgentOutput] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [query, setQuery] = useState("machine learning engineer new grad");
  const [location, setLocation] = useState("United States");
  const [sources, setSources] = useState<string[]>(["adzuna", "usajobs"]);
  const [settings, setSettings] = useState({
    adzuna_app_id: "",
    adzuna_app_key: "",
    usajobs_user_agent: "",
    usajobs_api_key: "",
    jsearch_api_key: "",
  });

  async function refresh() {
    setLoading(true);
    const [matchData, metricData, applicationData, integrationData, runData] = await Promise.all([
      apiGet<{ matches: Match[] }>("/matches/default?k=20"),
      apiGet<Metrics>("/mlops/metrics"),
      apiGet<ApplicationEvent[]>("/applications/default"),
      apiGet<IntegrationStatus>("/settings/integrations"),
      apiGet<IngestionRun[]>("/jobs/ingestion-runs?limit=8"),
    ]);
    setMatches(matchData.matches || []);
    setMetrics(metricData);
    setApplications(applicationData);
    setIntegrations(integrationData);
    setRuns(runData);
    setSelectedId((current) => current || matchData.matches?.[0]?.job.job_id || "");
    setLoading(false);
  }

  useEffect(() => {
    refresh().catch((error) => {
      setAgentOutput({ error: String(error), hint: `Check that FastAPI is running at ${API}` });
      setLoading(false);
    });
  }, []);

  const selected = useMemo(
    () => matches.find((item) => item.job.job_id === selectedId) || matches[0],
    [matches, selectedId]
  );

  function toggleSource(source: string) {
    setSources((current) =>
      current.includes(source) ? current.filter((item) => item !== source) : [...current, source]
    );
  }

  async function saveSettings() {
    const status = await apiPut<IntegrationStatus>("/settings/integrations", settings);
    setIntegrations(status);
    setAgentOutput({ intent: "save_integrations", result: status });
  }

  async function ingestJobs() {
    setIngesting(true);
    try {
      const output = await apiPost("/jobs/ingest", {
        query,
        location,
        page: 1,
        results_per_page: 25,
        sources,
      });
      setAgentOutput({ intent: "ingest_jobs", result: output });
      await refresh();
    } catch (error) {
      setAgentOutput({ intent: "ingest_jobs", error: String(error) });
    } finally {
      setIngesting(false);
    }
  }

  async function runAgent(message = agentPrompt) {
    const output = await apiPost("/agent", { candidate_id: "default", message });
    setAgentOutput(output);
  }

  async function track(status: string) {
    if (!selected) return;
    await apiPost("/applications", {
      candidate_id: "default",
      job_id: selected.job.job_id,
      status,
      note: `${selected.job.title} at ${selected.job.company}`,
    });
    await refresh();
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>JobGraph AI</h1>
          <p>Agentic job search OS for AI/ML roles.</p>
        </div>
        <nav className="nav">
          <a href="#ingestion">Ingestion</a>
          <a href="#matches">Matches</a>
          <a href="#copilot">Copilot</a>
          <a href="#tracker">Tracker</a>
          <a href="#autofill">Autofill</a>
        </nav>
        <p className="side-label">
          Hybrid ranker: skill graph overlap, semantic resume/job similarity, role intent, and location fit.
        </p>
      </aside>

      <main className="main">
        <section className="topbar">
          <div>
            <h2>Job Search Command Center</h2>
            <p>Live ingestion, matching, tailoring, tracking, and autofill prep in one workflow.</p>
          </div>
          <div className="actions">
            <button className="button secondary" onClick={() => refresh()}>{loading ? "Refreshing" : "Refresh"}</button>
            <button className="button" onClick={() => runAgent("prepare autofill")}>Prepare Autofill</button>
          </div>
        </section>

        <section className="metrics">
          <div className="metric"><span>Total jobs</span><strong>{metrics?.jobs_total ?? "-"}</strong></div>
          <div className="metric"><span>Applications</span><strong>{metrics?.applications_total ?? "-"}</strong></div>
          <div className="metric"><span>Ingestion runs</span><strong>{metrics?.ingestion_runs_total ?? "-"}</strong></div>
          <div className="metric"><span>Active model</span><strong style={{ fontSize: 15 }}>{metrics?.model ?? "offline"}</strong></div>
        </section>

        <section id="ingestion" className="grid">
          <div className="panel">
            <h3>Real-Time Job Ingestion</h3>
            <div className="form-grid">
              <label>Search query<input className="input" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
              <label>Location<input className="input" value={location} onChange={(event) => setLocation(event.target.value)} /></label>
            </div>
            <div className="source-row">
              {["adzuna", "usajobs", "jsearch"].map((source) => (
                <label className="check" key={source}>
                  <input type="checkbox" checked={sources.includes(source)} onChange={() => toggleSource(source)} />
                  {source}
                </label>
              ))}
            </div>
            <div className="status-row">
              <span className={integrations?.adzuna_configured ? "pill ok" : "pill"}>Adzuna</span>
              <span className={integrations?.usajobs_configured ? "pill ok" : "pill"}>USAJOBS</span>
              <span className={integrations?.jsearch_configured ? "pill ok" : "pill"}>JSearch</span>
            </div>
            <div className="actions">
              <button className="button" onClick={ingestJobs} disabled={ingesting}>{ingesting ? "Ingesting" : "Ingest Jobs"}</button>
              <button className="button secondary" onClick={() => refresh()}>Reload Runs</button>
            </div>
            <p className="job-meta">If no keys are configured, ingestion records a successful run with zero live jobs and keeps demo data available.</p>
          </div>

          <div className="panel">
            <h3>API Keys</h3>
            <div className="form-grid">
              <input className="input" placeholder="Adzuna app id" value={settings.adzuna_app_id} onChange={(e) => setSettings({ ...settings, adzuna_app_id: e.target.value })} />
              <input className="input" placeholder="Adzuna app key" type="password" value={settings.adzuna_app_key} onChange={(e) => setSettings({ ...settings, adzuna_app_key: e.target.value })} />
              <input className="input" placeholder="USAJOBS user agent email" value={settings.usajobs_user_agent} onChange={(e) => setSettings({ ...settings, usajobs_user_agent: e.target.value })} />
              <input className="input" placeholder="USAJOBS API key" type="password" value={settings.usajobs_api_key} onChange={(e) => setSettings({ ...settings, usajobs_api_key: e.target.value })} />
              <input className="input full" placeholder="JSearch RapidAPI key" type="password" value={settings.jsearch_api_key} onChange={(e) => setSettings({ ...settings, jsearch_api_key: e.target.value })} />
            </div>
            <div className="actions">
              <button className="button" onClick={saveSettings}>Save Keys Locally</button>
            </div>
            <p className="job-meta">Keys are stored in your local database for development. Do not commit `.env` or `jobgraph.db`.</p>
          </div>
        </section>

        <section className="panel">
          <h3>Ingestion History</h3>
          <div className="tracker-list">
            {runs.length === 0 && <p className="job-meta">No ingestion runs yet.</p>}
            {runs.map((run) => (
              <div className="tracker-item" key={run.id}>
                <strong>{run.status.toUpperCase()} | {run.jobs_saved} jobs saved</strong>
                <div className="job-meta">{run.query} | {run.location} | {run.sources.join(", ")}</div>
                {run.error && <div className="error-line">{run.error}</div>}
              </div>
            ))}
          </div>
        </section>

        <section id="matches" className="grid">
          <div className="panel">
            <h3>Ranked Job Feed</h3>
            <div className="feed">
              {matches.map((match) => (
                <button
                  key={match.job.job_id}
                  className={`job-card ${selected?.job.job_id === match.job.job_id ? "active" : ""}`}
                  onClick={() => setSelectedId(match.job.job_id)}
                >
                  <div className="detail-header">
                    <div>
                      <h4>{match.job.title}</h4>
                      <div className="job-meta">{match.job.company} | {match.job.location || "Unknown"} | {match.job.source}</div>
                    </div>
                    <span className="score">{match.score}%</span>
                  </div>
                  <div className="tags">
                    {match.matched_skills.slice(0, 5).map((skill) => <span className="tag" key={skill}>{skill}</span>)}
                    {match.missing_skills.slice(0, 3).map((skill) => <span className="tag missing" key={skill}>{skill}</span>)}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="detail-card">
            {selected ? (
              <>
                <div className="detail-header">
                  <div>
                    <h3>{selected.job.title}</h3>
                    <div className="job-meta">{selected.job.company} | {selected.job.location} | {selected.job.work_model}</div>
                  </div>
                  <span className="score">{selected.score}% match</span>
                </div>
                <p className="detail-copy">{selected.explanation}</p>
                <div className="split">
                  <div>
                    <h4>Matched Skills</h4>
                    <div className="tags">{selected.matched_skills.map((skill) => <span className="tag" key={skill}>{skill}</span>)}</div>
                  </div>
                  <div>
                    <h4>Skill Gaps</h4>
                    <div className="tags">{selected.missing_skills.map((skill) => <span className="tag missing" key={skill}>{skill}</span>)}</div>
                  </div>
                </div>
                <div className="actions">
                  <button className="button" onClick={() => runAgent(`tailor resume for ${selected.job.job_id}`)}>Tailor Resume</button>
                  <button className="button secondary" onClick={() => runAgent(`cover letter for ${selected.job.job_id}`)}>Cover Letter</button>
                  <button className="button secondary" onClick={() => track("saved")}>Save</button>
                  <button className="button secondary" onClick={() => track("applied")}>Mark Applied</button>
                </div>
              </>
            ) : (
              <p>No matches loaded.</p>
            )}
          </div>
        </section>

        <section className="grid">
          <div id="copilot" className="panel">
            <h3>Agentic Copilot</h3>
            <textarea className="textarea" value={agentPrompt} onChange={(event) => setAgentPrompt(event.target.value)} />
            <div className="actions" style={{ marginTop: 10 }}>
              <button className="button" onClick={() => runAgent()}>Run Agent</button>
              {selected && <button className="button secondary" onClick={() => runAgent(`explain ${selected.job.job_id}`)}>Explain Selected</button>}
            </div>
            <pre className="output">{agentOutput ? JSON.stringify(agentOutput, null, 2) : "Agent output will appear here."}</pre>
          </div>

          <div id="tracker" className="panel">
            <h3>Application Tracker</h3>
            <div className="tracker-list">
              {applications.length === 0 && <p className="job-meta">No applications tracked yet.</p>}
              {applications.slice(0, 8).map((item, index) => (
                <div className="tracker-item" key={`${item.job_id}-${item.timestamp}-${index}`}>
                  <strong>{item.status.toUpperCase()}</strong>
                  <div className="job-meta">{item.note || item.job_id}</div>
                  <div className="job-meta">{new Date(item.timestamp).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="autofill" className="panel">
          <h3>Human-Reviewed Autofill</h3>
          <p className="detail-copy">
            Load the Chrome extension from <strong>apps/extension</strong>, point it at <strong>{API}</strong>, and use it to fill detected ATS fields.
            The extension fills fields for review and does not submit applications.
          </p>
        </section>
      </main>
    </div>
  );
}
