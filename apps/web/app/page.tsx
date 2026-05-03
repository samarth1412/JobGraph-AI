"use client";

import {
  Bell,
  Bookmark,
  Bot,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleX,
  Filter,
  Grid3X3,
  MapPin,
  Search,
  Share2,
  Sparkles,
  Upload,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8022";
const SCRAPER_SOURCES = ["ashby", "greenhouse", "lever", "workday"];

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
  skills: string[];
  target_roles: string[];
  location_preferences: string[];
};

type Match = {
  job: Job;
  score: number;
  matched_skills: string[];
  missing_skills: string[];
  explanation: string;
  model_source: string;
  gnn_score: number;
  semantic_score: number;
  skill_overlap_score: number;
};

type ApplicationEvent = {
  candidate_id: string;
  job_id: string;
  status: string;
  note: string;
  timestamp: string;
};

type AgentOutput = {
  plan?: Array<{ tool: string; status: string }>;
  result?: { apply_url?: string };
};

type ApplyAgentRun = {
  id?: number;
  candidate_id: string;
  job_id: string;
  apply_url: string;
  status: string;
  ats: string;
  current_url?: string;
  filled_fields: Array<{ label: string; source?: string; confidence?: number }>;
  blockers: Array<{ label: string; reason: string }>;
  file_fields: Array<{ label: string; reason: string }>;
  page_summary?: string;
  error?: string;
};

type AutofillProfile = {
  candidate_id: string;
  legal_name?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  work_authorization?: string;
  sponsorship_required?: string;
  education?: Record<string, string>;
  custom_answers?: Record<string, string>;
};

type ParsedResume = {
  name?: string;
  email?: string;
  skills?: string[];
  target_roles?: string[];
  location_preferences?: string[];
  experience_years?: number;
  inferred_search_query?: string;
  inferred_search_location?: string;
};

type Evaluation = {
  evaluated?: boolean;
  reason?: string;
  labeled_jobs?: number;
  positive_jobs?: number;
  precision_at_k?: number;
  recall_at_k?: number;
  mrr?: number;
  ndcg_at_k?: number;
};

type ApplicationResponse = {
  event: ApplicationEvent;
  training?: { trained: boolean; reason?: string; examples?: number; model?: string };
  evaluation?: Evaluation;
};

type ResumeRecommendations = {
  candidate: Candidate;
  matches: Match[];
  gnn_diagnostics: {
    nodes: number;
    edges: number;
    layers: number;
    embedding_dim: number;
    model: string;
    job_pool_size?: number;
  };
  ingestion?: {
    requested: boolean;
    status?: string;
    jobs_ingested?: number;
    error?: string;
  };
  recommendation_run?: {
    id?: number;
    query?: string;
    location?: string;
    model_source?: string;
    job_pool_size?: number;
  };
  parsed_resume?: ParsedResume;
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

async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error((await response.text()) || `PUT ${path} failed`);
  return response.json();
}

function sourceName(source: string) {
  if (source.startsWith("jobspy_")) return source.replace("jobspy_", "").replaceAll("_", " ").toUpperCase();
  return source.toUpperCase();
}

function logoClass(index: number) {
  const classes = [
    "bg-black text-white",
    "bg-[#b58cf4] text-white",
    "bg-cyan-500 text-white",
    "bg-pink-500 text-white",
    "bg-indigo-600 text-white",
    "bg-zinc-100 text-black",
  ];
  return classes[index % classes.length];
}

function latestEventsByJob(events: ApplicationEvent[]) {
  const latest = new Map<string, ApplicationEvent>();
  for (const event of events) {
    const current = latest.get(event.job_id);
    if (!current || new Date(event.timestamp).getTime() > new Date(current.timestamp).getTime()) {
      latest.set(event.job_id, event);
    }
  }
  return latest;
}

function statusLabel(status?: string) {
  if (!status) return "New";
  return status.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function previewText(value: string, length = 260) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "This source did not return a full description yet. Open the original posting for complete details.";
  return cleaned.length > length ? `${cleaned.slice(0, length).trim()}...` : cleaned;
}

export default function Home() {
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [applications, setApplications] = useState<ApplicationEvent[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("AI Engineer");
  const [location, setLocation] = useState("Remote");
  const [experience, setExperience] = useState("0 - 2 Years");
  const [jobType, setJobType] = useState("Full Time");
  const [showJobs, setShowJobs] = useState(false);
  const [workAuthorization, setWorkAuthorization] = useState("");
  const [sponsorshipRequired, setSponsorshipRequired] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [agentOutput, setAgentOutput] = useState<AgentOutput | null>(null);
  const [applyRun, setApplyRun] = useState<ApplyAgentRun | null>(null);
  const [gnnDiagnostics, setGnnDiagnostics] = useState<ResumeRecommendations["gnn_diagnostics"] | null>(null);
  const [parsedResume, setParsedResume] = useState<ParsedResume | null>(null);
  const [recommendationRun, setRecommendationRun] = useState<ResumeRecommendations["recommendation_run"] | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [error, setError] = useState("");

  const latestApplications = useMemo(() => latestEventsByJob(applications), [applications]);
  const selectedMatch = matches.find((match) => match.job.job_id === selectedId) || matches[0] || null;
  const selectedStatus = selectedMatch ? latestApplications.get(selectedMatch.job.job_id)?.status : undefined;

  useEffect(() => {
    const hasResume = window.localStorage.getItem("jobgraph_resume_uploaded") === "true";
    if (hasResume) {
      loadIntakeProfile();
    }
  }, []);

  useEffect(() => {
    if (!applyRun?.id || !["starting", "navigating", "filling"].includes(applyRun.status)) return;
    const timer = window.setInterval(async () => {
      try {
        setApplyRun(await apiGet<ApplyAgentRun>(`/apply-agent/runs/${applyRun.id}`));
      } catch (caught) {
        setError(String(caught));
      }
    }, 1800);
    return () => window.clearInterval(timer);
  }, [applyRun?.id, applyRun?.status]);

  async function loadIntakeProfile() {
    setLoading(true);
    setError("");
    try {
      const [profile, autofill] = await Promise.all([
        apiGet<Candidate>("/candidate/default"),
        apiGet<AutofillProfile>("/autofill/default"),
      ]);
      setCandidate(profile);
      if (profile.target_roles?.[0]) setQuery(profile.target_roles[0]);
      if (profile.location_preferences?.[0]) setLocation(profile.location_preferences[0]);
      setWorkAuthorization(autofill.work_authorization || "");
      setSponsorshipRequired(autofill.sponsorship_required || "");
    } catch (caught) {
      setError(String(caught));
    } finally {
      setLoading(false);
    }
  }

  async function loadWorkspace() {
    setLoading(true);
    setError("");
    try {
      const [profile, matchData, applicationData] = await Promise.all([
        apiGet<Candidate>("/candidate/default"),
        apiGet<{ matches: Match[] }>("/matches/default?k=50"),
        apiGet<ApplicationEvent[]>("/applications/default"),
      ]);
      setCandidate(profile);
      setMatches(matchData.matches || []);
      setApplications(applicationData || []);
      if (!selectedId && matchData.matches?.[0]) setSelectedId(matchData.matches[0].job.job_id);
      if (profile.target_roles?.[0]) setQuery(profile.target_roles[0]);
      if (profile.location_preferences?.[0]) setLocation(profile.location_preferences[0]);
    } catch (caught) {
      setError(String(caught));
    } finally {
      setLoading(false);
    }
  }

  async function uploadResume(file: File | null) {
    if (!file) return;
    setUploading(true);
    setLoading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const params = new URLSearchParams({
        candidate_id: "default",
        k: "50",
        ingest: "false",
      });
      const response = await fetch(`${API}/recommendations/resume?${params.toString()}`, { method: "POST", body: form });
      if (!response.ok) throw new Error((await response.text()) || "Resume recommendation failed");
      const payload: ResumeRecommendations = await response.json();
      const profile = payload.candidate;
      const autofill = await apiGet<AutofillProfile>("/autofill/default");
      window.localStorage.setItem("jobgraph_resume_uploaded", "true");
      setCandidate(profile);
      setMatches([]);
      setApplications([]);
      setSelectedId("");
      setShowJobs(false);
      setGnnDiagnostics(payload.gnn_diagnostics || null);
      setParsedResume(payload.parsed_resume || null);
      setRecommendationRun(payload.recommendation_run || null);
      setQuery(profile.target_roles?.[0] || query);
      setLocation(profile.location_preferences?.[0] || location);
      setWorkAuthorization(autofill.work_authorization || "");
      setSponsorshipRequired(autofill.sponsorship_required || "");
      if (payload.ingestion?.status === "failed") {
        setError(`Live job ingestion failed, showing stored jobs ranked by GNN: ${payload.ingestion.error}`);
      }
    } catch (caught) {
      setError(String(caught));
    } finally {
      setUploading(false);
      setLoading(false);
    }
  }

  async function searchJobs(nextQuery = query, nextLocation = location) {
    setLoading(true);
    setError("");
    try {
      await apiPost("/jobs/ingest", {
        query: nextQuery,
        location: nextLocation,
        page: 1,
        results_per_page: 25,
        sources: SCRAPER_SOURCES,
      });
      const [matchData, applicationData] = await Promise.all([
        apiGet<{ matches: Match[] }>("/matches/default?k=50"),
        apiGet<ApplicationEvent[]>("/applications/default"),
      ]);
      setMatches(matchData.matches || []);
      setApplications(applicationData || []);
      setSelectedId(matchData.matches?.[0]?.job.job_id || "");
    } catch (caught) {
      setError(String(caught));
    } finally {
      setLoading(false);
    }
  }

  async function saveIntakeAnswers() {
    const current = await apiGet<AutofillProfile>("/autofill/default");
    await apiPut<AutofillProfile>("/autofill/default", {
      ...current,
      candidate_id: "default",
      work_authorization: workAuthorization,
      sponsorship_required: sponsorshipRequired,
    });
  }

  async function seeJobs() {
    if (!candidate) {
      setError("Upload and parse your resume before viewing matched jobs.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await saveIntakeAnswers();
      setShowJobs(true);
      await searchJobs(query, location);
    } catch (caught) {
      setShowJobs(false);
      setError(String(caught));
    } finally {
      setLoading(false);
    }
  }

  async function recordApplication(jobId: string, status: string, note = "") {
    const response = await apiPost<ApplicationResponse>("/applications", {
      candidate_id: "default",
      job_id: jobId,
      status,
      note,
    });
    setApplications((current) => [response.event, ...current]);
    setEvaluation(response.evaluation || null);
  }

  async function applyWithAgent(match: Match) {
    setSelectedId(match.job.job_id);
    setError("");
    setApplyRun(null);
    const output = await apiPost<AgentOutput>("/agent", {
      candidate_id: "default",
      message: `apply to ${match.job.job_id}`,
    });
    setAgentOutput(output);
    const run = await apiPost<ApplyAgentRun>("/apply-agent/runs", {
      candidate_id: "default",
      job_id: match.job.job_id,
      headless: false,
    });
    setApplyRun(run);
    await recordApplication(match.job.job_id, run.apply_url ? "applying" : "failed", "Autonomous Apply Agent started.");
  }

  const agentSteps = [
    ["Match analyzed", Boolean(selectedMatch)],
    ["Resume tailored", Boolean(agentOutput?.plan?.some((step) => step.tool === "tailor_resume"))],
    ["Browser run started", Boolean(applyRun?.id)],
    ["Fields filled", Boolean(applyRun?.filled_fields?.length)],
    ["Waiting for user approval", ["blocked", "needs_review"].includes(applyRun?.status || "")],
  ] as const;

  if (!showJobs) {
    const intakeComplete = Boolean(candidate && workAuthorization && sponsorshipRequired);
    return (
      <main className="min-h-screen bg-[#0f0f10] px-4 py-6 text-white sm:px-6 lg:px-8">
        <section className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-5xl items-center">
          <div className="w-full rounded-[2rem] border border-white/10 bg-[#171717] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.35)] sm:p-8 lg:p-10">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3 text-2xl font-black">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-black">
                  <Sparkles size={21} />
                </div>
                JobGraph AI
              </div>
              <span className="w-fit rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300">
                Resume first. Jobs second. Agent applies after review.
              </span>
            </div>

            <div className="mt-12 grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
              <div>
                <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#b58cf4]">
                  <Upload size={16} />
                  {candidate ? "Resume parsed" : "Start by uploading your resume"}
                </p>
                <h1 className="text-4xl font-light tracking-tight md:text-6xl">Find jobs that fit your resume.</h1>
                <p className="mt-5 max-w-2xl text-lg leading-8 text-zinc-400">
                  Upload your resume, confirm a few application details, then see roles ranked by your skills and profile.
                </p>

                <label className="mt-8 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-white/15 bg-white/5 p-6 text-center transition hover:bg-white/10">
                  <span className="grid h-14 w-14 place-items-center rounded-full bg-white text-black">
                    <Upload size={22} />
                  </span>
                  <span className="mt-4 text-lg font-bold">{uploading ? "Parsing resume..." : candidate ? "Replace resume" : "Upload resume"}</span>
                  <span className="mt-2 text-sm text-zinc-400">PDF or TXT. We use this to create your profile and autofill applications.</span>
                  <input type="file" accept=".pdf,.txt" className="hidden" onChange={(event) => uploadResume(event.target.files?.[0] || null)} />
                </label>

                {error && <p className="mt-4 rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}
              </div>

              <div className="rounded-[1.7rem] border border-white/10 bg-[#252525] p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase text-zinc-500">Candidate Profile</p>
                    <h2 className="mt-1 text-2xl font-bold">{candidate?.name || "Waiting for resume"}</h2>
                    <p className="mt-1 text-sm text-zinc-400">{candidate?.email || "Your parsed contact details will appear here."}</p>
                  </div>
                  {candidate && <CheckCircle2 className="text-[#98f5aa]" size={24} />}
                </div>

                {Boolean((parsedResume?.skills || candidate?.skills || []).length) && (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {(parsedResume?.skills || candidate?.skills || []).slice(0, 8).map((skill) => (
                      <span key={skill} className="rounded-full bg-[#b58cf4]/20 px-3 py-2 text-sm text-zinc-100">
                        {skill}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-7 space-y-5">
                  <ChoiceGroup
                    label="Are you authorized to work in your target location?"
                    value={workAuthorization}
                    onChange={setWorkAuthorization}
                    options={["Yes", "No"]}
                  />
                  <ChoiceGroup
                    label="Will you now or in the future require visa sponsorship?"
                    value={sponsorshipRequired}
                    onChange={setSponsorshipRequired}
                    options={["No", "Yes"]}
                  />
                </div>

                <button
                  onClick={() => seeJobs()}
                  disabled={!intakeComplete || loading || uploading}
                  className="mt-8 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#b58cf4] px-5 text-base font-semibold text-white shadow-lg shadow-purple-500/15 transition hover:bg-[#a879ee] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Search size={19} />
                  {loading ? "Finding jobs..." : "See Jobs"}
                </button>
                {!intakeComplete && (
                  <p className="mt-3 text-center text-sm text-zinc-500">Upload a resume and answer both questions to continue.</p>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#0f0f10] px-4 py-6 text-white sm:px-6 lg:px-8">
      <section className="mx-auto mb-6 flex w-full max-w-[1400px] flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="w-fit rounded-full border border-white/15 bg-white/5 px-6 py-2 text-xl font-semibold text-white">JobGraph AI</div>
        <div className="max-w-2xl">
          <h1 className="text-2xl font-black tracking-tight text-white md:text-3xl">AI-Powered Job Matching Workspace</h1>
          <div className="mt-2 h-1.5 w-full rounded-full bg-[#b58cf4]" />
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1400px] rounded-[2rem] border border-white/10 bg-[#171717] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.35)] sm:p-6 lg:p-8">
        <header className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3 text-3xl font-black">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-black">
              <Sparkles size={21} />
            </div>
            JobGraph AI
          </div>

          <nav className="flex w-full flex-wrap items-center gap-1.5 rounded-full bg-white p-1.5 text-sm font-semibold text-black xl:w-auto">
            <button className="grid h-10 w-10 place-items-center rounded-full bg-[#171717] text-white">
              <Grid3X3 size={18} />
            </button>
            {["Overview", "Explore Jobs", "Applications", "Inbox", "Support"].map((item) => (
              <button
                key={item}
                className={`rounded-full px-4 py-2.5 transition hover:bg-[#efe3ff] ${item === "Explore Jobs" ? "bg-[#b58cf4] text-white shadow-lg shadow-purple-500/25" : ""}`}
              >
                {item}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <button className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/5 transition hover:bg-white/10">
              <Search size={18} />
            </button>
            <button className="relative grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/5 transition hover:bg-white/10">
              <Bell size={18} />
              <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-[#b58cf4]" />
            </button>
            <div className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-[#b58cf4] to-zinc-200 text-base font-black text-black">
              {(candidate?.name || "M").slice(0, 1)}
            </div>
          </div>
        </header>

        <section className="mt-12 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#b58cf4]">
              <Upload size={16} />
              {candidate ? `${candidate.skills?.length || 0} resume signals - GNN recommendations active` : "Upload resume to activate matching"}
            </p>
            <h2 className="text-4xl font-light tracking-tight text-white md:text-6xl">Explore Matched Jobs</h2>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-zinc-400">
              AI-ranked openings based on your resume, skills, preferences, and candidate-skill-job graph affinity.
            </p>
            {gnnDiagnostics && (
              <p className="mt-3 text-sm text-zinc-500">
                {gnnDiagnostics.model.replaceAll("_", " ")} - {gnnDiagnostics.nodes} nodes, {gnnDiagnostics.edges} edges, {gnnDiagnostics.layers} message-passing layers
              </p>
            )}
            {error && <p className="mt-4 max-w-2xl rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}
          </div>

          <label className="flex w-fit cursor-pointer items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/10">
            {uploading ? "Parsing..." : candidate ? "Replace Resume" : "Upload Resume"}
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white text-black">
              <Upload size={17} />
            </span>
            <input type="file" accept=".pdf,.txt" className="hidden" onChange={(event) => uploadResume(event.target.files?.[0] || null)} />
          </label>
        </section>

        <section className="mt-8 rounded-[1.6rem] border border-white/10 bg-[#252525] p-4">
          <div className="grid items-end gap-3 lg:grid-cols-[1fr_0.75fr_0.75fr_1fr_150px]">
            <Field label="Job Title" value={query} onChange={setQuery} icon={<BriefcaseBusiness size={20} />} />
            <Field label="Experience" value={experience} onChange={setExperience} icon={<ChevronDown size={20} />} />
            <Field label="Job Type" value={jobType} onChange={setJobType} icon={<ChevronDown size={20} />} />
            <Field label="Location" value={location} onChange={setLocation} icon={<MapPin size={20} />} />
            <button
              onClick={() => searchJobs()}
              disabled={loading}
              className="flex h-12 items-center justify-center gap-2 rounded-full bg-[#b58cf4] px-5 text-sm font-semibold text-white shadow-lg shadow-purple-500/15 transition hover:bg-[#a879ee] disabled:opacity-60"
            >
              <Search size={18} />
              {loading ? "Searching" : "Search"}
            </button>
          </div>
        </section>

        {(parsedResume || recommendationRun || evaluation) && (
          <section className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase text-zinc-500">Parsed Resume</p>
                  <h3 className="mt-1 text-lg font-bold text-white">{parsedResume?.name || candidate?.name || "Current candidate"}</h3>
                </div>
                <span className="rounded-full bg-white/10 px-3 py-2 text-sm text-zinc-300">
                  {parsedResume?.inferred_search_query || recommendationRun?.query || query}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {(parsedResume?.skills || candidate?.skills || []).slice(0, 10).map((skill) => (
                  <span key={skill} className="rounded-full bg-[#b58cf4]/20 px-3 py-2 text-sm text-zinc-100">
                    {skill}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase text-zinc-500">Recommendation Run</p>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Signal label="Jobs" value={recommendationRun?.job_pool_size || gnnDiagnostics?.job_pool_size || matches.length} suffix="" />
                <Signal label="MRR" value={(evaluation?.mrr || 0) * 100} />
                <Signal label="NDCG" value={(evaluation?.ndcg_at_k || 0) * 100} />
              </div>
              <p className="mt-3 text-sm text-zinc-500">
                {evaluation?.evaluated ? `${evaluation.labeled_jobs} labeled jobs from feedback.` : evaluation?.reason || "Save or skip jobs to train and evaluate the ranker."}
              </p>
            </div>
          </section>
        )}

        <section className="mt-8 grid gap-8 xl:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-[2rem] bg-white p-5 text-black md:p-7">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-3xl font-semibold tracking-tight">Recommended Jobs</h3>
              <button className="grid h-10 w-10 place-items-center rounded-full bg-zinc-100 transition hover:bg-[#efe3ff]">
                <Filter size={19} />
              </button>
            </div>

            <div className="space-y-2">
              {matches.map((match, index) => {
                const selected = selectedMatch?.job.job_id === match.job.job_id;
                const status = latestApplications.get(match.job.job_id)?.status;
                return (
                  <article
                    key={match.job.job_id}
                    className={`grid gap-4 rounded-full px-4 py-3 transition md:grid-cols-[minmax(0,1.55fr)_0.5fr_0.55fr_0.5fr_auto_auto_auto] md:items-center ${
                      selected ? "bg-black text-white shadow-2xl" : "bg-white hover:bg-zinc-50"
                    }`}
                  >
                    <button className="flex min-w-0 items-center gap-4 text-left" onClick={() => setSelectedId(match.job.job_id)}>
                      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-base font-black ${logoClass(index)}`}>
                        {match.job.company.slice(0, 1) || "J"}
                      </div>
                      <div className="min-w-0">
                        <h4 className="truncate text-lg font-bold">{match.job.title}</h4>
                        <p className={`truncate text-sm ${selected ? "text-zinc-400" : "text-zinc-500"}`}>
                          {match.job.company} - {match.job.location || "United States"}
                        </p>
                      </div>
                    </button>
                    <span className={`w-fit rounded-full px-4 py-2 text-xs font-semibold ${selected ? "bg-white/10 text-zinc-300" : "bg-zinc-100 text-zinc-500"}`}>
                      {match.job.work_model || jobType}
                    </span>
                    <div>
                      <p className={`text-xs ${selected ? "text-zinc-500" : "text-zinc-400"}`}>Match</p>
                      <strong>{Math.round(match.score)}%</strong>
                      <p className={`text-xs ${selected ? "text-zinc-500" : "text-zinc-400"}`}>GNN {Math.round(match.gnn_score || 0)}%</p>
                    </div>
                    <span className={selected ? "text-zinc-400" : "text-zinc-500"}>{statusLabel(status)}</span>
                    <button
                      onClick={() => setSelectedId(match.job.job_id)}
                      className={`rounded-full px-8 py-3 font-semibold transition ${selected ? "bg-[#b58cf4] text-white" : "bg-[#f1e8ff] text-black hover:bg-[#e5d3ff]"}`}
                    >
                      View
                    </button>
                    <button
                      onClick={() => recordApplication(match.job.job_id, "saved", "Saved from dashboard.")}
                      className={`grid h-10 w-10 place-items-center rounded-full border transition ${selected ? "border-white/20 hover:bg-white/10" : "border-zinc-200 hover:bg-zinc-50"}`}
                    >
                      <Bookmark size={19} />
                    </button>
                    <button
                      onClick={() => recordApplication(match.job.job_id, "skipped", "Skipped from dashboard.")}
                      className={`grid h-10 w-10 place-items-center rounded-full border transition ${selected ? "border-white/20 hover:bg-white/10" : "border-zinc-200 hover:bg-zinc-50"}`}
                      title="Skip and train ranker"
                    >
                      <CircleX size={19} />
                    </button>
                  </article>
                );
              })}
              {!matches.length && (
                <div className="rounded-[2rem] bg-zinc-50 p-8 text-center text-zinc-500">
                  {loading ? "Loading matched jobs..." : "Upload a resume or run Search to load matched jobs."}
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-5">
            <section className="rounded-[2rem] border border-white/10 bg-[#292929] p-5">
              <div className="h-36 rounded-[1.4rem] bg-[linear-gradient(135deg,#dff8ff,#d7d7ff_45%,#2f2f2f)]" />
              <div className="-mt-10 flex items-end justify-between px-1">
                <div className="grid h-20 w-20 place-items-center rounded-full border-8 border-[#292929] bg-[#b58cf4] text-3xl font-black">
                  {selectedMatch?.job.company.slice(0, 1) || "J"}
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => selectedMatch && recordApplication(selectedMatch.job.job_id, "saved", "Saved from detail panel.")}
                    className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/5 transition hover:bg-white/10"
                  >
                    <Bookmark size={21} />
                  </button>
                  <button
                    onClick={() => selectedMatch && recordApplication(selectedMatch.job.job_id, "skipped", "Skipped from detail panel.")}
                    className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/5 transition hover:bg-white/10"
                    title="Skip and train ranker"
                  >
                    <CircleX size={21} />
                  </button>
                  <a
                    href={selectedMatch?.job.apply_url || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/5 transition hover:bg-white/10"
                  >
                    <Share2 size={21} />
                  </a>
                </div>
              </div>

              <div className="mt-5">
                <h3 className="text-2xl font-bold">{selectedMatch?.job.title || "Select a matched job"}</h3>
                <p className="mt-1 text-zinc-400">{selectedMatch?.job.company || "JobGraph AI"}</p>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-4">
                <Detail icon={<MapPin size={18} />} label="Location" value={selectedMatch?.job.location || "Remote"} />
                <Detail icon={<Building2 size={18} />} label="Work Mode" value={selectedMatch?.job.work_model || "Flexible"} />
                <Detail icon={<BriefcaseBusiness size={18} />} label="Job Type" value={jobType} />
                <Detail icon={<Users size={18} />} label="Experience" value={experience} />
              </div>

              {selectedMatch && (
                <div className="mt-6 grid grid-cols-3 gap-3 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
                  <Signal label="GNN" value={selectedMatch.gnn_score} />
                  <Signal label="Semantic" value={selectedMatch.semantic_score} />
                  <Signal label="Skills" value={selectedMatch.skill_overlap_score} />
                </div>
              )}

              <div className="mt-6">
                <h4 className="text-lg font-bold">Description</h4>
                <p className="mt-2 leading-7 text-zinc-400">{previewText(selectedMatch?.job.description || "")}</p>
              </div>

              <div className="mt-6">
                <h4 className="text-lg font-bold">Matched Skills</h4>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(selectedMatch?.matched_skills.length ? selectedMatch.matched_skills : candidate?.skills || []).slice(0, 8).map((skill) => (
                    <span key={skill} className="rounded-full bg-white/10 px-3 py-2 text-sm text-zinc-200">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>

              <button
                onClick={() => selectedMatch && applyWithAgent(selectedMatch)}
                disabled={!selectedMatch}
                className="mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#b58cf4] text-base font-semibold text-white shadow-lg shadow-purple-500/15 transition hover:bg-[#a879ee] disabled:opacity-50"
              >
                <Bot size={22} />
                Apply with Agent
              </button>
            </section>

            <section className="rounded-[2rem] border border-white/10 bg-[#292929] p-5">
              <div className="mb-4 flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-white text-black">
                  <Bot size={21} />
                </div>
                <div>
                  <h3 className="font-bold">AI Agent</h3>
                  <p className="text-sm text-zinc-400">{selectedStatus ? statusLabel(selectedStatus) : "Application progress"}</p>
                </div>
              </div>
              <div className="space-y-3">
                {agentSteps.map(([label, done]) => (
                  <div key={label} className="flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3">
                    {done ? <CheckCircle2 className="text-[#98f5aa]" size={20} /> : <Circle className="text-[#b58cf4]" size={20} />}
                    <span className={done ? "text-zinc-100" : "text-zinc-400"}>{label}</span>
                  </div>
                ))}
              </div>
              {applyRun && (
                <div className="mt-4 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold uppercase text-zinc-500">Autonomous Run</p>
                      <h4 className="mt-1 font-bold">{statusLabel(applyRun.status)}</h4>
                    </div>
                    <span className="rounded-full bg-[#b58cf4]/20 px-3 py-1.5 text-xs font-semibold text-[#d8c0ff]">{applyRun.ats}</span>
                  </div>
                  {applyRun.page_summary && <p className="mt-3 text-sm text-zinc-400">{applyRun.page_summary}</p>}
                  {applyRun.error && <p className="mt-3 rounded-2xl bg-red-500/10 px-3 py-2 text-sm text-red-200">{applyRun.error}</p>}
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    <Signal label="Filled" value={applyRun.filled_fields?.length || 0} suffix="" />
                    <Signal label="Blockers" value={applyRun.blockers?.length || 0} suffix="" />
                    <Signal label="Files" value={applyRun.file_fields?.length || 0} suffix="" />
                  </div>
                  {!!applyRun.blockers?.length && (
                    <div className="mt-4 space-y-2">
                      {applyRun.blockers.slice(0, 4).map((blocker, index) => (
                        <p key={`${blocker.label}-${index}`} className="rounded-2xl bg-white/5 px-3 py-2 text-sm text-zinc-300">
                          <span className="font-semibold text-white">{blocker.label}</span>: {blocker.reason}
                        </p>
                      ))}
                    </div>
                  )}
                  {!!applyRun.file_fields?.length && (
                    <p className="mt-3 text-sm text-zinc-400">Resume file upload fields are detected but still require manual file selection.</p>
                  )}
                  {["blocked", "needs_review"].includes(applyRun.status) && (
                    <p className="mt-4 text-sm font-semibold text-[#98f5aa]">Review the opened browser. The agent will not submit the final application.</p>
                  )}
                </div>
              )}
            </section>
          </aside>
        </section>
      </section>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  icon,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  icon: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-3 block text-sm font-medium text-zinc-400">{label}</span>
      <div className="flex h-12 items-center justify-between rounded-full border border-white/10 bg-[#303030] px-4 text-sm">
        <input className="min-w-0 flex-1 bg-transparent text-white outline-none" value={value} onChange={(event) => onChange(event.target.value)} />
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-zinc-200">{icon}</span>
      </div>
    </label>
  );
}

function ChoiceGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <div>
      <p className="mb-3 text-sm font-medium text-zinc-400">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <button
            key={option}
            onClick={() => onChange(option)}
            className={`h-11 rounded-full border text-sm font-semibold transition ${
              value === option ? "border-[#b58cf4] bg-[#b58cf4] text-white" : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
            }`}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function Signal({ label, value, suffix = "%" }: { label: string; value: number; suffix?: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-black text-white">
        {Math.round(value || 0)}
        {suffix}
      </p>
    </div>
  );
}

function Detail({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-zinc-200">{icon}</span>
        <div>
          <h4 className="font-bold">{label}</h4>
          <p className="mt-1 text-zinc-400">{value}</p>
        </div>
      </div>
    </div>
  );
}
