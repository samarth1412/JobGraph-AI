"use client";

import { useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8022";
const SCRAPER_SOURCES = ["jobspy", "ashby", "greenhouse", "lever", "workday"];

type Job = {
  job_id: string;
  source: string;
  title: string;
  company: string;
  location: string;
  work_model: string;
  description: string;
  apply_url: string;
  salary_min?: number | null;
  salary_max?: number | null;
  required_skills: string[];
};

type Candidate = {
  candidate_id: string;
  name: string;
  email: string;
  phone: string;
  target_roles: string[];
  skills: string[];
  links: Record<string, string>;
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
  jobs_total_all?: number;
  applications_total: number;
  ingestion_runs_total: number;
  jobs_by_source: Record<string, number>;
  jobs_by_source_all?: Record<string, number>;
  model: string;
};

type GnnSnapshot = {
  diagnostics: {
    nodes: number;
    edges: number;
    model: string;
  };
};

type ScraperStatus = {
  jobspy_available: boolean;
  python_version: string;
  sources: string[];
};

type AgentOutput = {
  agent?: string;
  intent?: string;
  plan?: Array<{ tool: string; status: string; reason?: string }>;
  result?: {
    explanation?: string;
    matched_skills?: string[];
    missing_skills?: string[];
    apply_url?: string;
    resume_strategy?: {
      resume_strategy?: string[];
      ats_keywords?: string[];
    };
  };
  error?: string;
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
  if (!response.ok) throw new Error((await response.text()) || `POST ${path} failed`);
  return response.json();
}

function formatPay(job: Job) {
  if (!job.salary_min && !job.salary_max) return "";
  if (job.salary_min && job.salary_max && job.salary_min !== job.salary_max) {
    return `$${Math.round(job.salary_min).toLocaleString()} - $${Math.round(job.salary_max).toLocaleString()}`;
  }
  return `$${Math.round(job.salary_min || job.salary_max || 0).toLocaleString()}`;
}

function sourceName(source: string) {
  if (source.startsWith("jobspy_")) return source.replace("jobspy_", "").replaceAll("_", " ").toUpperCase();
  return source.toUpperCase();
}

function uniqueSources(metrics: Metrics | null) {
  return Object.keys(metrics?.jobs_by_source || {});
}

export default function Home() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [gnn, setGnn] = useState<GnnSnapshot | null>(null);
  const [status, setStatus] = useState<ScraperStatus | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [query, setQuery] = useState("machine learning engineer new grad");
  const [location, setLocation] = useState("United States");
  const [department, setDepartment] = useState("All");
  const [searching, setSearching] = useState(false);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [resumeLoaded, setResumeLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [agentOutput, setAgentOutput] = useState<AgentOutput | null>(null);

  async function loadCandidate() {
    const profile = await apiGet<Candidate>("/candidate/default");
    if (profile.skills?.length || profile.email || profile.name) {
      setCandidate(profile);
      setQuery(profile.target_roles?.[0] || query);
    }
  }

  async function refreshJobs() {
    setLoading(true);
    try {
      const [matchData, metricData, gnnData, statusData] = await Promise.all([
        apiGet<{ matches: Match[] }>("/matches/default?k=50"),
        apiGet<Metrics>("/mlops/metrics"),
        apiGet<GnnSnapshot>("/gnn/default?k=5"),
        apiGet<ScraperStatus>("/jobs/scraper-status"),
      ]);
      setMatches(matchData.matches || []);
      setSelectedMatch((current) => current || matchData.matches?.[0] || null);
      setMetrics(metricData);
      setGnn(gnnData);
      setStatus(statusData);
    } catch (error) {
      setAgentOutput({ error: `${String(error)} API: ${API}` });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    apiGet<ScraperStatus>("/jobs/scraper-status").then(setStatus).catch(() => undefined);
    const hasResume = window.localStorage.getItem("jobgraph_resume_uploaded") === "true";
    setResumeLoaded(hasResume);
    if (hasResume) {
      loadCandidate().then(refreshJobs).catch((error) => setAgentOutput({ error: String(error) }));
    }
  }, []);

  const departments = useMemo(() => {
    const inferred = matches.map((match) => {
      const title = match.job.title.toLowerCase();
      if (title.includes("data")) return "Data";
      if (title.includes("machine learning") || title.includes("ai")) return "AI / ML";
      if (title.includes("engineer")) return "Engineering";
      return "Other";
    });
    return ["All", ...Array.from(new Set(inferred))];
  }, [matches]);

  const filteredMatches = useMemo(() => {
    return matches.filter((match) => {
      if (department === "All") return true;
      const title = match.job.title.toLowerCase();
      if (department === "AI / ML") return title.includes("machine learning") || title.includes("ai");
      if (department === "Engineering") return title.includes("engineer");
      if (department === "Data") return title.includes("data");
      return true;
    });
  }, [department, matches]);

  async function searchJobs(nextQuery = query) {
    setSearching(true);
    try {
      await apiPost("/jobs/ingest", {
        query: nextQuery,
        location,
        page: 1,
        results_per_page: 25,
        sources: SCRAPER_SOURCES,
      });
      await refreshJobs();
    } catch (error) {
      setAgentOutput({ error: String(error) });
    } finally {
      setSearching(false);
    }
  }

  async function uploadResume(file: File | null) {
    if (!file) return;
    setResumeUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${API}/resume/upload?candidate_id=default`, { method: "POST", body: form });
      if (!response.ok) throw new Error((await response.text()) || "Resume upload failed");
      const profile = await response.json();
      const nextQuery = profile.target_roles?.[0] || query;
      window.localStorage.setItem("jobgraph_resume_uploaded", "true");
      setCandidate(profile);
      setResumeLoaded(true);
      setQuery(nextQuery);
      setAgentOutput({
        intent: "resume_uploaded",
        result: {
          explanation: `Resume parsed for ${profile.name || "candidate"}. Extracted ${profile.skills?.length || 0} skills and started live scraper search.`,
          matched_skills: profile.skills || [],
          missing_skills: [],
        },
      });
      await searchJobs(nextQuery);
    } catch (error) {
      setAgentOutput({ error: String(error) });
    } finally {
      setResumeUploading(false);
    }
  }

  async function askAgent(match: Match, message: string) {
    setSelectedMatch(match);
    const output = await apiPost<AgentOutput>("/agent", { candidate_id: "default", message });
    setAgentOutput(output);
  }

  async function apply(match: Match) {
    setSelectedMatch(match);
    const output = await apiPost<AgentOutput>("/agent", {
      candidate_id: "default",
      message: `apply to ${match.job.job_id}`,
    });
    setAgentOutput(output);
    if (output.result?.apply_url) {
      window.open(output.result.apply_url, "_blank", "noopener,noreferrer");
    }
  }

  if (!resumeLoaded) {
    return (
      <main className="page">
        <header className="siteHeader">
          <a className="wordmark" href="#">JobGraph AI</a>
          <nav>
            <span>{status?.jobspy_available ? "JobSpy ready" : "Checking scraper"}</span>
            <span>Python {status?.python_version || "-"}</span>
          </nav>
        </header>

        <section className="uploadLanding">
          <div>
            <p className="eyebrow">Resume-first job search</p>
            <h1>Upload your resume. Get matched to real openings.</h1>
            <p>
              A quiet workspace for finding roles that fit. Upload once, then review live openings ranked against
              your resume with graph recommendations.
            </p>
            <label className="primaryUpload compactUpload">
              {resumeUploading ? "Parsing resume..." : "Upload PDF or TXT"}
              <input type="file" accept=".pdf,.txt" onChange={(event) => uploadResume(event.target.files?.[0] || null)} />
            </label>
            {agentOutput?.error && <p className="errorText">{agentOutput.error}</p>}
          </div>

          <aside className="processCard">
            <div>
              <span>1</span>
              <strong>Parse resume</strong>
              <p>Extract skills, links, role targets, and autofill fields.</p>
            </div>
            <div>
              <span>2</span>
              <strong>Scrape jobs</strong>
              <p>Use JobSpy plus Ashby, Greenhouse, Lever, and Workday boards.</p>
            </div>
            <div>
              <span>3</span>
              <strong>Apply with agent</strong>
              <p>Open the real portal and prepare browser autofill.</p>
            </div>
          </aside>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="siteHeader">
        <a className="wordmark" href="#">JobGraph AI</a>
        <nav>
          <a href="#openings">Jobs</a>
          <a href="#agent">Agent</a>
          <a href="#graph">GNN</a>
        </nav>
      </header>

      <section className="appTop">
        <div className="profileCard">
          <span>Resume profile</span>
          <h1>{candidate?.name || "Candidate"}</h1>
          <p>{candidate?.email || "Resume parsed"}{" · "}{(candidate?.skills || []).length} skills extracted</p>
          <div className="profileSkills">
            {(candidate?.skills || []).slice(0, 10).map((skill) => <span key={skill}>{skill}</span>)}
          </div>
        </div>

        <div className="searchCard">
          <div className="controls inlineControls" aria-label="Job search controls">
            <label>
              Search
              <input value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <label>
              Location
              <input value={location} onChange={(event) => setLocation(event.target.value)} />
            </label>
            <label>
              Team
              <select value={department} onChange={(event) => setDepartment(event.target.value)}>
                {departments.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <button onClick={() => searchJobs()} disabled={searching}>
              {searching ? "Searching..." : "Refresh jobs"}
            </button>
          </div>
          <div className="sourcePills">
            {(uniqueSources(metrics).length ? uniqueSources(metrics) : SCRAPER_SOURCES).map((source) => (
              <span key={source}>{sourceName(source)}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="summary" id="graph">
        <div>
          <span>Matched openings</span>
          <strong>{loading ? "-" : filteredMatches.length}</strong>
        </div>
        <div>
          <span>Scraper jobs</span>
          <strong>{metrics?.jobs_total ?? "-"}</strong>
        </div>
        <div>
          <span>Graph</span>
          <strong>{gnn ? `${gnn.diagnostics.nodes} nodes / ${gnn.diagnostics.edges} edges` : "-"}</strong>
        </div>
      </section>

      <section className="contentGrid">
        <section className="jobs" id="openings">
          <div className="sectionTitle">
            <h2>Recommended jobs</h2>
            <span>{metrics?.model || "GraphSAGE ranker"}</span>
          </div>

          <div className="jobList">
            {filteredMatches.map((match) => {
              const pay = formatPay(match.job);
              return (
                <article className={`jobRow ${selectedMatch?.job.job_id === match.job.job_id ? "selected" : ""}`} key={match.job.job_id}>
                  <button className="jobSelect" onClick={() => setSelectedMatch(match)}>
                    <div className="roleMeta">
                      <span>{sourceName(match.job.source)}</span>
                      <span>{match.job.work_model}</span>
                      {pay && <span>{pay}</span>}
                    </div>
                    <h3>{match.job.title}</h3>
                    <p>{match.job.company}{" · "}{match.job.location || "United States"}</p>
                  </button>

                  <div className="rowActions">
                    <span>{Math.round(match.score)}%</span>
                    <button onClick={() => askAgent(match, `explain ${match.job.job_id}`)}>Explain</button>
                    <button onClick={() => askAgent(match, `what keywords am I missing for ${match.job.job_id}`)}>Keywords</button>
                    <button className="apply" onClick={() => apply(match)} disabled={!match.job.apply_url}>Apply</button>
                  </div>
                </article>
              );
            })}
            {!filteredMatches.length && (
              <div className="empty">
                <strong>{loading || searching ? "Loading real openings..." : "No scraper jobs found"}</strong>
                <span>Refresh jobs or add ATS board names in `.env`.</span>
              </div>
            )}
          </div>
        </section>

        <aside className="agentPanel" id="agent">
          <div className="agentHeader">
            <span>Application agent</span>
            <h2>{selectedMatch?.job.title || "Select a job"}</h2>
            {selectedMatch && <p>{selectedMatch.job.company}{" · "}{selectedMatch.job.location}</p>}
          </div>

          {selectedMatch && (
            <div className="fitBlock">
              <div>
                <span>Match</span>
                <strong>{Math.round(selectedMatch.score)}%</strong>
              </div>
              <div>
                <span>Source</span>
                <strong>{sourceName(selectedMatch.job.source)}</strong>
              </div>
            </div>
          )}

          <div className="agentTrace">
            <h3>Plan</h3>
            {(agentOutput?.plan || [
              { tool: "select_job", status: selectedMatch ? "completed" : "waiting", reason: "Choose a role to inspect fit." },
              { tool: "prepare_application", status: "waiting", reason: "Apply opens the company portal and prepares autofill." },
            ]).map((step, index) => (
              <div className="traceStep" key={`${step.tool}-${index}`}>
                <span>{index + 1}</span>
                <div>
                  <strong>{step.tool.replaceAll("_", " ")}</strong>
                  <p>{step.reason || step.status}</p>
                </div>
                <em>{step.status}</em>
              </div>
            ))}
          </div>

          <div className="agentResult">
            <h3>Reasoning</h3>
            <p>{agentOutput?.error || agentOutput?.result?.explanation || selectedMatch?.explanation || "Ask the agent to explain fit, keyword gaps, or apply readiness."}</p>
          </div>

          {agentOutput?.result?.resume_strategy && (
            <div className="agentResult">
              <h3>Resume targeting</h3>
              <ul>
                {agentOutput.result.resume_strategy.resume_strategy?.slice(0, 4).map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}

          <div className="skillColumns">
            <div>
              <h3>Strengths</h3>
              {(agentOutput?.result?.matched_skills || selectedMatch?.matched_skills || []).slice(0, 5).map((skill) => <span key={skill}>{skill}</span>)}
            </div>
            <div>
              <h3>Gaps</h3>
              {(agentOutput?.result?.missing_skills || selectedMatch?.missing_skills || []).slice(0, 5).map((skill) => <span key={skill}>{skill}</span>)}
            </div>
          </div>

          <div className="modelNote">
            <strong>{gnn?.diagnostics.model || "local_graphsage_message_passing_v1"}</strong>
            <span>{status?.jobspy_available ? "JobSpy scraper is active." : "JobSpy is not available in the running Python environment."}</span>
          </div>
        </aside>
      </section>
    </main>
  );
}
