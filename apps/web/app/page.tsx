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
    <div className="app">
      <div className="workspace">
        <header className="topnav">
          <div className="brand">
            <div className="brand-mark">JG</div>
            <div>
              <h1>JobGraph AI</h1>
              <span>AI job search copilot</span>
            </div>
          </div>
          <nav className="nav-links">
            <a href="#discover">Discover</a>
            <a href="#matches">Matches</a>
            <a href="#copilot">Copilot</a>
            <a href="#tracker">Tracker</a>
            <a href="#settings">Settings</a>
          </nav>
          <button className="button secondary" onClick={() => refresh()}>
            {loading ? "Refreshing" : "Refresh"}
          </button>
        </header>

        <section id="discover" className="hero">
          <div className="hero-panel">
            <div className="eyebrow">Personalized AI job matches</div>
            <h2>Find roles that match your resume, then tailor and track every application.</h2>
            <p className="hero-copy">
              Search live sources, rank jobs against your profile, prepare tailored materials, and keep applications organized from one clean workspace.
            </p>

            <div className="search-box">
              <label className="field">
                Job title or keyword
                <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} />
              </label>
              <label className="field">
                Location
                <input className="input" value={location} onChange={(event) => setLocation(event.target.value)} />
              </label>
              <button className="button" onClick={ingestJobs} disabled={ingesting}>
                {ingesting ? "Searching" : "Find jobs"}
              </button>
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
          </div>

          <div className="hero-panel">
            <div className="stat-grid">
              <div className="stat"><span>Total jobs</span><strong>{metrics?.jobs_total ?? "-"}</strong></div>
              <div className="stat"><span>Applications</span><strong>{metrics?.applications_total ?? "-"}</strong></div>
              <div className="stat"><span>Ingestion runs</span><strong>{metrics?.ingestion_runs_total ?? "-"}</strong></div>
              <div className="stat"><span>Candidates</span><strong>{metrics?.candidates_total ?? "-"}</strong></div>
              <div className="stat wide"><span>Ranking model</span><strong>{metrics?.model ?? "offline"}</strong></div>
            </div>
          </div>
        </section>

        <section id="matches" className="content-grid">
          <div className="panel">
            <h3>Best matches</h3>
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
                    {match.matched_skills.slice(0, 4).map((skill) => <span className="tag" key={skill}>{skill}</span>)}
                    {match.missing_skills.slice(0, 2).map((skill) => <span className="tag missing" key={skill}>{skill}</span>)}
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
                  <span className="score">{selected.score}%</span>
                </div>
                <p className="detail-copy">{selected.explanation}</p>
                <div className="split">
                  <div>
                    <h4>Strengths</h4>
                    <div className="tags">{selected.matched_skills.map((skill) => <span className="tag" key={skill}>{skill}</span>)}</div>
                  </div>
                  <div>
                    <h4>Gaps</h4>
                    <div className="tags">{selected.missing_skills.map((skill) => <span className="tag missing" key={skill}>{skill}</span>)}</div>
                  </div>
                </div>
                <div className="actions">
                  <button className="button" onClick={() => runAgent(`tailor resume for ${selected.job.job_id}`)}>Tailor resume</button>
                  <button className="button secondary" onClick={() => runAgent(`cover letter for ${selected.job.job_id}`)}>Cover letter</button>
                  <button className="button ghost" onClick={() => track("saved")}>Save</button>
                  <button className="button ghost" onClick={() => track("applied")}>Applied</button>
                </div>
              </>
            ) : (
              <p className="muted">No matches loaded.</p>
            )}
          </div>

          <div className="side-stack">
            <div id="copilot" className="panel">
              <h3>Orion-style copilot</h3>
              <textarea className="textarea" value={agentPrompt} onChange={(event) => setAgentPrompt(event.target.value)} />
              <div className="actions">
                <button className="button" onClick={() => runAgent()}>Ask</button>
                {selected && <button className="button secondary" onClick={() => runAgent(`explain ${selected.job.job_id}`)}>Explain job</button>}
              </div>
              <pre className="output">{agentOutput ? JSON.stringify(agentOutput, null, 2) : "Copilot output appears here."}</pre>
            </div>

            <div id="tracker" className="panel">
              <h3>Tracker</h3>
              <div className="tracker-list">
                {applications.length === 0 && <p className="job-meta">No applications tracked yet.</p>}
                {applications.slice(0, 6).map((item, index) => (
                  <div className="tracker-item" key={`${item.job_id}-${item.timestamp}-${index}`}>
                    <strong>{item.status.toUpperCase()}</strong>
                    <div className="job-meta">{item.note || item.job_id}</div>
                    <div className="job-meta">{new Date(item.timestamp).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="settings" className="hero">
          <div className="panel">
            <h3>Job source settings</h3>
            <div className="form-grid">
              <input className="input" placeholder="Adzuna app id" value={settings.adzuna_app_id} onChange={(e) => setSettings({ ...settings, adzuna_app_id: e.target.value })} />
              <input className="input" placeholder="Adzuna app key" type="password" value={settings.adzuna_app_key} onChange={(e) => setSettings({ ...settings, adzuna_app_key: e.target.value })} />
              <input className="input" placeholder="USAJOBS user agent email" value={settings.usajobs_user_agent} onChange={(e) => setSettings({ ...settings, usajobs_user_agent: e.target.value })} />
              <input className="input" placeholder="USAJOBS API key" type="password" value={settings.usajobs_api_key} onChange={(e) => setSettings({ ...settings, usajobs_api_key: e.target.value })} />
              <input className="input full" placeholder="JSearch RapidAPI key" type="password" value={settings.jsearch_api_key} onChange={(e) => setSettings({ ...settings, jsearch_api_key: e.target.value })} />
            </div>
            <div className="actions">
              <button className="button" onClick={saveSettings}>Save keys locally</button>
              <button className="button secondary" onClick={() => runAgent("prepare autofill")}>Prepare autofill</button>
            </div>
          </div>

          <div className="panel">
            <h3>Ingestion history</h3>
            <div className="tracker-list">
              {runs.length === 0 && <p className="job-meta">No ingestion runs yet.</p>}
              {runs.map((run) => (
                <div className="tracker-item" key={run.id}>
                  <strong>{run.status.toUpperCase()} | {run.jobs_saved} saved</strong>
                  <div className="job-meta">{run.query} | {run.location} | {run.sources.join(", ")}</div>
                  {run.error && <div className="error-line">{run.error}</div>}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="autofill" className="panel">
          <h3>Autofill extension</h3>
          <p className="detail-copy">
            Load <strong>apps/extension</strong>, point it at <strong>{API}</strong>, and review all filled fields before submitting.
          </p>
        </section>
      </div>
    </div>
  );
}
