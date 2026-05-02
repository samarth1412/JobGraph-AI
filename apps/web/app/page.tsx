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
};

type ApplicationEvent = {
  candidate_id: string;
  job_id: string;
  status: string;
  note: string;
  timestamp: string;
};

type IngestionRun = {
  id: number;
  query: string;
  location: string;
  sources: string[];
  jobs_saved: number;
  status: string;
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

const tabs = ["Recommended", "Liked", "Applied", "External"];
const nav = ["Jobs", "Resume", "Profile", "Agent", "Coaching", "Interview"];
const filters = ["United States", "Machine Learning Engineer", "Intern/New Grad", "Full-time", "Remote", "Past week", "0-1 Years", "Industry"];

function sourceLabel(source: string) {
  return source === "demo" ? "Demo" : source.toUpperCase();
}

function scoreLabel(score: number) {
  if (score >= 75) return "STRONG MATCH";
  if (score >= 55) return "GOOD MATCH";
  return "FAIR MATCH";
}

function companyMark(company: string) {
  return company
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export default function Home() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [applications, setApplications] = useState<ApplicationEvent[]>([]);
  const [runs, setRuns] = useState<IngestionRun[]>([]);
  const [query, setQuery] = useState("machine learning engineer new grad");
  const [location, setLocation] = useState("United States");
  const [resumeUploading, setResumeUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [agentOutput, setAgentOutput] = useState<unknown>(null);

  async function loadDashboard() {
    const [matchData, metricData, applicationData, runData] = await Promise.all([
      apiGet<{ matches: Match[] }>("/matches/default?k=30"),
      apiGet<Metrics>("/mlops/metrics"),
      apiGet<ApplicationEvent[]>("/applications/default"),
      apiGet<IngestionRun[]>("/jobs/ingestion-runs?limit=6"),
    ]);
    return { matchData, metricData, applicationData, runData };
  }

  async function refresh() {
    setLoading(true);
    try {
      let data = await loadDashboard();
      if (!data.matchData.matches?.length) {
        await apiPost("/jobs/ingest", {
          query,
          location,
          page: 1,
          results_per_page: 25,
          sources: [],
        });
        data = await loadDashboard();
      }
      setMatches(data.matchData.matches || []);
      setMetrics(data.metricData);
      setApplications(data.applicationData);
      setRuns(data.runData);
    } catch (error) {
      setAgentOutput({ error: String(error), api: API });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const appliedIds = useMemo(() => new Set(applications.map((item) => item.job_id)), [applications]);
  const sourceSummary = useMemo(() => Object.entries(metrics?.jobs_by_source || {}), [metrics]);

  async function searchJobs() {
    setSearching(true);
    try {
      const result = await apiPost("/jobs/ingest", {
        query,
        location,
        page: 1,
        results_per_page: 25,
        sources: ["adzuna", "usajobs", "jsearch"],
      });
      setAgentOutput({ intent: "search_jobs", result });
      await refresh();
    } finally {
      setSearching(false);
    }
  }

  async function runAgent(match: Match) {
    const output = await apiPost("/agent", {
      candidate_id: "default",
      message: `explain ${match.job.job_id}`,
    });
    setAgentOutput(output);
  }

  async function track(match: Match, status: string) {
    await apiPost("/applications", {
      candidate_id: "default",
      job_id: match.job.job_id,
      status,
      note: `${match.job.title} at ${match.job.company}`,
    });
    await refresh();
  }

  async function applyWithAutofill(match: Match) {
    if (match.job.apply_url) {
      await track(match, "applied");
      window.open(match.job.apply_url, "_blank", "noopener,noreferrer");
    } else {
      setAgentOutput({
        intent: "apply_with_autofill",
        result: "This is a demo or provider result without an external apply URL. Add valid job API keys and run Search jobs for real company portal links.",
      });
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
      setAgentOutput({ intent: "resume_upload", result: profile });
      await refresh();
    } catch (error) {
      setAgentOutput({ intent: "resume_upload", error: String(error) });
    } finally {
      setResumeUploading(false);
    }
  }

  return (
    <main className="appShell">
      <aside className="leftNav">
        <div className="brand">
          <div className="brandIcon">JG</div>
          <strong>JobGraph</strong>
        </div>

        <nav>
          {nav.map((item) => (
            <a className={item === "Jobs" ? "active" : ""} href="#" key={item}>
              <span>{item === "Jobs" ? "▣" : "○"}</span>
              {item}
              {item === "Interview" && <em>NEW</em>}
            </a>
          ))}
        </nav>

        <div className="referBox">
          <strong>Resume Autofill</strong>
          <span>Upload your resume so the extension can fill job portals with your profile.</span>
          <label className="resumeUpload">
            {resumeUploading ? "Uploading..." : "Upload resume"}
            <input type="file" accept=".pdf,.txt" onChange={(event) => uploadResume(event.target.files?.[0] || null)} />
          </label>
        </div>

        <div className="navBottom">
          <a href="#messages">Messages</a>
          <a href="#feedback">Feedback</a>
          <a href="#settings">Settings</a>
        </div>
      </aside>

      <section className="feedShell">
        <header className="feedTop">
          <div className="titleRow">
            <h1>JOBS</h1>
            <span>›</span>
            <nav className="tabs">
              {tabs.map((tab) => (
                <button className={tab === "Recommended" ? "selected" : ""} key={tab}>
                  {tab}
                  {tab !== "Recommended" && <b>{tab === "Applied" ? applications.length : 0}</b>}
                </button>
              ))}
            </nav>
          </div>
          <label className="topSearch">
            <span>⌕</span>
            <input placeholder="Search by title or company" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
        </header>

        <section className="filterBar">
          <div className="chips">
            {filters.map((filter, index) => (
              <button className={index < 6 ? "chip activeChip" : "chip"} key={filter}>
                {filter}
                {index === 1 && <b>+20</b>}
                {index === 2 && <b>+1</b>}
                <span>⌄</span>
              </button>
            ))}
            <button className="hiddenChip">▣ Hidden Jobs</button>
            <button className="allFilters">••• All Filters</button>
          </div>
          <div className="rightSort">
            <button>?</button>
            <button>Recommended ⌄</button>
          </div>
        </section>

        <section className="quickSearch">
          <input value={location} onChange={(event) => setLocation(event.target.value)} />
          <button onClick={searchJobs} disabled={searching}>{searching ? "Searching" : "Search jobs"}</button>
          <span>{loading ? "Loading jobs..." : `${matches.length} recommended jobs. Demo jobs are clearly labeled.`}</span>
        </section>

        <section className="jobFeed">
          {matches.map((match, index) => (
            <article className="jobCard" key={match.job.job_id}>
              <div className="jobMain">
                <div className="companyLogo">{companyMark(match.job.company)}</div>
                <div className="jobInfo">
                  <div className="jobBadges">
                    <span>{index < 2 ? "4 hours ago" : "9 minutes ago"}</span>
                    {index === 0 && <span>Be an early applicant</span>}
                  </div>
                  <h2>{match.job.title}</h2>
                  <p>
                    <strong>{match.job.company}</strong>
                    <span>/ {sourceLabel(match.job.source)} {match.job.apply_url ? "/ Live opening" : "/ Demo or no apply URL"}</span>
                  </p>
                  <div className="facts">
                    <span>⌖ {match.job.location || "United States"}</span>
                    <span>◴ Full-time</span>
                    <span>⌂ {match.job.work_model || "Remote"}</span>
                    <span>♔ New Grad</span>
                    <span>$ {match.job.salary_min ? `${match.job.salary_min}/hr` : "Competitive"}</span>
                  </div>
                  <div className="cardFoot">
                    <span>{index === 0 ? "Less than 25 applicants" : `${72 + index * 11} applicants`}</span>
                    <div className="cardActions">
                      <button aria-label="Hide job">⊘</button>
                      <button aria-label="Like job">♡</button>
                      <button className="orion" onClick={() => runAgent(match)}>✦ ASK ORION</button>
                      <button className="apply" onClick={() => applyWithAutofill(match)}>
                        {match.job.apply_url ? (appliedIds.has(match.job.job_id) ? "APPLIED" : "APPLY WITH AUTOFILL") : "NO REAL APPLY LINK"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <aside className="scorePanel">
                <button aria-label="More">•••</button>
                <div className="scoreCircle">{Math.round(match.score)}%</div>
                <strong>{scoreLabel(match.score)}</strong>
                <div className="scoreReasons">
                  {match.matched_skills.slice(0, 3).map((skill) => (
                    <span key={skill}>✓ {skill}</span>
                  ))}
                  {!match.matched_skills.length && <span>✓ Profile overlap</span>}
                </div>
              </aside>
            </article>
          ))}

          {!matches.length && (
            <div className="emptyState">
              <strong>{loading ? "Loading recommendations..." : "No recommendations loaded"}</strong>
              <span>API: {API}</span>
              <button onClick={searchJobs}>Create demo recommendations</button>
            </div>
          )}
        </section>

        <aside className="orionDrawer">
          <div>
            <strong>Orion output</strong>
            <span>{metrics?.jobs_total ?? 0} jobs / {metrics?.ingestion_runs_total ?? 0} searches</span>
          </div>
          <pre>{agentOutput ? JSON.stringify(agentOutput, null, 2) : "Ask Orion from any job card."}</pre>
          <div className="sourceCounts">
            {sourceSummary.map(([source, count]) => (
              <span key={source}>{source}: {count}</span>
            ))}
          </div>
          <div className="recentRuns">
            {runs.slice(0, 2).map((run) => (
              <span key={run.id}>{run.status}: {run.jobs_saved} saved</span>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
