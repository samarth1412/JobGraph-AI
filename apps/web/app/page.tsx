"use client";

import { useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8022";

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
  applications_total: number;
  ingestion_runs_total: number;
  jobs_by_source: Record<string, number>;
  model: string;
};

type GnnSnapshot = {
  diagnostics: {
    nodes: number;
    edges: number;
    model: string;
  };
};

type AgentOutput = {
  agent?: string;
  intent?: string;
  plan?: Array<{ tool: string; status: string; reason?: string }>;
  result?: {
    explanation?: string;
    matched_skills?: string[];
    missing_skills?: string[];
    score?: number;
    job?: Job;
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
  return source === "demo" ? "Demo" : source.toUpperCase();
}

export default function Home() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [gnn, setGnn] = useState<GnnSnapshot | null>(null);
  const [query, setQuery] = useState("machine learning engineer new grad");
  const [location, setLocation] = useState("United States");
  const [department, setDepartment] = useState("All");
  const [searching, setSearching] = useState(false);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [resumeLoaded, setResumeLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [agentOutput, setAgentOutput] = useState<AgentOutput | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const [matchData, metricData, gnnData] = await Promise.all([
        apiGet<{ matches: Match[] }>("/matches/default?k=50"),
        apiGet<Metrics>("/mlops/metrics"),
        apiGet<GnnSnapshot>("/gnn/default?k=5"),
      ]);
      setMatches(matchData.matches || []);
      setSelectedMatch((current) => current || matchData.matches?.[0] || null);
      setMetrics(metricData);
      setGnn(gnnData);
    } catch (error) {
      setAgentOutput({ error: `${String(error)} API: ${API}` });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
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

  async function searchJobs() {
    setSearching(true);
    try {
      await apiPost("/jobs/ingest", {
        query,
        location,
        page: 1,
        results_per_page: 25,
        sources: ["adzuna", "usajobs", "jsearch"],
      });
      await refresh();
    } finally {
      setSearching(false);
    }
  }

  async function askAgent(match: Match) {
    setSelectedMatch(match);
    const output = await apiPost<AgentOutput>("/agent", {
      candidate_id: "default",
      message: `explain ${match.job.job_id}`,
    });
    setAgentOutput(output);
  }

  async function askKeywordGaps(match: Match) {
    setSelectedMatch(match);
    const output = await apiPost<AgentOutput>("/agent", {
      candidate_id: "default",
      message: `what keywords am I missing for ${match.job.job_id}`,
    });
    setAgentOutput(output);
  }

  async function prepareApply(match: Match) {
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

  async function uploadResume(file: File | null) {
    if (!file) return;
    setResumeUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${API}/resume/upload?candidate_id=default`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) throw new Error((await response.text()) || "Resume upload failed");
      const profile = await response.json();
      setResumeLoaded(true);
      setAgentOutput({
        intent: "resume_uploaded",
        result: {
          explanation: `Resume parsed for ${profile.name || "candidate"}. Extracted ${profile.skills?.length || 0} skills; job rankings now use this profile.`,
          matched_skills: profile.skills || [],
          missing_skills: [],
        },
      });
      await refresh();
    } catch (error) {
      setAgentOutput({ error: String(error) });
    } finally {
      setResumeUploading(false);
    }
  }

  async function apply(match: Match) {
    if (!match.job.apply_url) {
      setAgentOutput({
        intent: "apply",
        result: { explanation: "This posting does not include a real apply URL. Run a live search with configured providers." },
      });
      return;
    }
    await prepareApply(match);
  }

  return (
    <main className="page">
      <header className="siteHeader">
        <a className="wordmark" href="#">
          JobGraph AI
        </a>
        <nav>
          <a href="#openings">Open roles</a>
          <a href="#agent">Agent</a>
          <a href="#graph">Graph model</a>
        </nav>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">Real-time AI job search</p>
          <h1>Open roles matched to your profile.</h1>
          <p>
            Search live job sources, rank openings with GraphSAGE-style matching, and apply through the original company or provider portal.
          </p>
        </div>
        <div className="heroAside">
          <span>Active agent</span>
          <strong>{agentOutput?.agent || "jobgraph_react_tool_agent_v2"}</strong>
          <p>{gnn?.diagnostics.model || "local_graphsage_message_passing_v1"}</p>
        </div>
      </section>

      <section className="workflow">
        <div>
          <span>1</span>
          <strong>Upload resume</strong>
          <p>Parse your resume into skills and autofill fields.</p>
        </div>
        <div>
          <span>2</span>
          <strong>Filter live jobs</strong>
          <p>Rank openings with semantic and GraphSAGE signals.</p>
        </div>
        <div>
          <span>3</span>
          <strong>Ask agent</strong>
          <p>Find missing keywords, tailor your resume, and prepare apply.</p>
        </div>
        <label className="uploadButton">
          {resumeUploading ? "Uploading..." : resumeLoaded ? "Resume uploaded" : "Upload resume"}
          <input type="file" accept=".pdf,.txt" onChange={(event) => uploadResume(event.target.files?.[0] || null)} />
        </label>
      </section>

      <section className="controls" aria-label="Job search controls">
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
            {departments.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <button onClick={searchJobs} disabled={searching}>
          {searching ? "Searching..." : "Search jobs"}
        </button>
      </section>

      <section className="summary" id="graph">
        <div>
          <span>Openings</span>
          <strong>{loading ? "-" : filteredMatches.length}</strong>
        </div>
        <div>
          <span>Sources</span>
          <strong>{Object.keys(metrics?.jobs_by_source || {}).join(", ") || "-"}</strong>
        </div>
        <div>
          <span>Graph</span>
          <strong>{gnn ? `${gnn.diagnostics.nodes} nodes / ${gnn.diagnostics.edges} edges` : "-"}</strong>
        </div>
      </section>

      <section className="contentGrid">
        <section className="jobs" id="openings">
          <div className="sectionTitle">
            <h2>Current openings</h2>
            <span>{metrics?.model || "GraphSAGE ranker"}</span>
          </div>

          <div className="jobList">
            {filteredMatches.map((match) => {
              const pay = formatPay(match.job);
              return (
                <article className={`jobRow ${selectedMatch?.job.job_id === match.job.job_id ? "selected" : ""}`} key={match.job.job_id}>
                  <div className="jobCopy">
                    <div className="metaLine">
                      <span>{sourceName(match.job.source)}</span>
                      {match.job.work_model && <span>{match.job.work_model}</span>}
                      {pay && <span>{pay}</span>}
                    </div>
                    <h3>{match.job.title}</h3>
                    <p>{match.job.company} · {match.job.location || "United States"}</p>
                    <p className="description">{match.job.description}</p>
                    <div className="skills">
                      {match.matched_skills.slice(0, 5).map((skill) => (
                        <span key={skill}>{skill}</span>
                      ))}
                    </div>
                  </div>
                  <aside className="jobActions">
                    <div className="score">{Math.round(match.score)}%</div>
                    <button onClick={() => setSelectedMatch(match)}>Details</button>
                    <button onClick={() => askAgent(match)}>Explain</button>
                    <button onClick={() => askKeywordGaps(match)}>Keywords</button>
                    <button className="apply" onClick={() => apply(match)} disabled={!match.job.apply_url}>
                      {match.job.apply_url ? "Prepare apply" : "No apply link"}
                    </button>
                  </aside>
                </article>
              );
            })}
            {!filteredMatches.length && (
              <div className="empty">
                <strong>{loading ? "Loading openings..." : "No openings found"}</strong>
                <span>Run a live search or adjust filters.</span>
              </div>
            )}
          </div>
        </section>

        <aside className="agentPanel" id="agent">
          <div className="agentHeader">
            <span>Agent workspace</span>
            <h2>{selectedMatch?.job.title || "Select a role"}</h2>
            {selectedMatch && <p>{selectedMatch.job.company} · {selectedMatch.job.location}</p>}
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
              { tool: "explain_match", status: "waiting", reason: "Run Ask agent to generate an evidence-backed explanation." },
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
            <p>{agentOutput?.result?.explanation || selectedMatch?.explanation || "Ask the agent to explain fit, gaps, and next actions."}</p>
          </div>

          {agentOutput?.result?.resume_strategy && (
            <div className="agentResult">
              <h3>Resume targeting</h3>
              <ul>
                {agentOutput.result.resume_strategy.resume_strategy?.slice(0, 4).map((item: string) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="skillColumns">
            <div>
              <h3>Strengths</h3>
              {(agentOutput?.result?.matched_skills || selectedMatch?.matched_skills || []).slice(0, 5).map((skill) => (
                <span key={skill}>{skill}</span>
              ))}
            </div>
            <div>
              <h3>Gaps</h3>
              {(agentOutput?.result?.missing_skills || selectedMatch?.missing_skills || []).slice(0, 5).map((skill) => (
                <span key={skill}>{skill}</span>
              ))}
            </div>
          </div>

          <div className="modelNote">
            <strong>{gnn?.diagnostics.model || "local_graphsage_message_passing_v1"}</strong>
            <span>{gnn ? `${gnn.diagnostics.nodes} nodes and ${gnn.diagnostics.edges} graph edges scored for this feed.` : "Hybrid semantic + GraphSAGE recommendation scoring."}</span>
          </div>
        </aside>
      </section>
    </main>
  );
}
