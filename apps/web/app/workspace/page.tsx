"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { JobBoardView } from "./JobBoardView";
import { ArrowRight, CheckCircle2, Sparkles, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRedirectToUploadOnReload } from "../lib/useRedirectToUploadOnReload";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8022";
const SHOW_DEBUG = process.env.NEXT_PUBLIC_SHOW_DEBUG === "true";

type Job = {
  job_id: string;
  source: string;
  title: string;
  company: string;
  company_logo_url?: string;
  location: string;
  work_model: string;
  description: string;
  apply_url: string;
  salary_min?: number | null;
  salary_max?: number | null;
  posted_at?: string | null;
  required_skills: string[];
};

type Candidate = {
  candidate_id: string;
  name: string;
  email: string;
  phone?: string;
  summary?: string;
  skills: string[];
  projects?: string[];
  experience?: Array<Record<string, unknown>>;
  education?: Array<Record<string, unknown>>;
  target_roles: string[];
  location_preferences: string[];
};

type Match = {
  job: Job;
  score: number;
  matched_skills: string[];
  missing_skills: string[];
  explanation: string;
  graph_paths?: string[];
  score_breakdown?: Record<string, number>;
  why_fit?: string[];
  why_may_not_fit?: string[];
  model_source: string;
  gnn_score: number;
  semantic_score: number;
  skill_overlap_score: number;
  location_experience_fit_score?: number;
};

type ApplicationEvent = {
  candidate_id: string;
  job_id: string;
  status: string;
  note: string;
  timestamp: string;
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
  metadata?: {
    agent_status?: string;
    steps?: Array<{ label: string; status: string; details?: string }>;
    [key: string]: unknown;
  };
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
  projects?: string[];
  experience?: Array<Record<string, unknown>>;
  education?: Array<Record<string, unknown>>;
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

export default function WorkspacePage() {
  const router = useRouter();
  useRedirectToUploadOnReload();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [applications, setApplications] = useState<ApplicationEvent[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [showJobs, setShowJobs] = useState(false);
  const [boardSearch, setBoardSearch] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterRemote, setFilterRemote] = useState<"any" | "remote" | "onsite">("any");
  const [filterAts, setFilterAts] = useState("");
  const [filterMinScore, setFilterMinScore] = useState(0);
  const [sortBy, setSortBy] = useState<"score" | "recent">("score");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [workAuthorization, setWorkAuthorization] = useState("");
  const [sponsorshipRequired, setSponsorshipRequired] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** User-facing pipeline step (resume → ATS fetch → matches). */
  const [pipelineMessage, setPipelineMessage] = useState<string | null>(null);
  const [applyRun, setApplyRun] = useState<ApplyAgentRun | null>(null);
  const [gnnDiagnostics, setGnnDiagnostics] = useState<ResumeRecommendations["gnn_diagnostics"] | null>(null);
  const [parsedResume, setParsedResume] = useState<ParsedResume | null>(null);
  const [recommendationRun, setRecommendationRun] = useState<ResumeRecommendations["recommendation_run"] | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [error, setError] = useState("");

  const latestApplications = useMemo(() => latestEventsByJob(applications), [applications]);
  const filteredMatches = useMemo(() => {
    return matches.filter((m) => {
      if (filterMinScore > 0 && Math.round(m.score) < filterMinScore) return false;
      if (filterAts && m.job.source.toLowerCase() !== filterAts.toLowerCase()) return false;
      const title = (m.job.title || "").toLowerCase();
      const loc = (m.job.location || "").toLowerCase();
      const company = (m.job.company || "").toLowerCase();
      const desc = `${title} ${loc} ${(m.job.work_model || "").toLowerCase()}`;
      if (boardSearch.trim()) {
        const q = boardSearch.trim().toLowerCase();
        if (!`${title} ${company} ${loc}`.includes(q)) return false;
      }
      if (filterLocation && !loc.includes(filterLocation.toLowerCase())) return false;
      if (filterRemote === "remote") {
        const w = (m.job.work_model || "").toLowerCase();
        if (!w.includes("remote") && !desc.includes("remote")) return false;
      }
      if (filterRemote === "onsite") {
        const w = (m.job.work_model || "").toLowerCase();
        if (w.includes("remote") || desc.includes("remote")) return false;
      }
      return true;
    });
  }, [matches, boardSearch, filterLocation, filterRemote, filterAts, filterMinScore]);

  const sortedMatches = useMemo(() => {
    const arr = [...filteredMatches];
    if (sortBy === "recent") {
      arr.sort((a, b) => {
        const ta = Date.parse(String(a.job.posted_at || "")) || 0;
        const tb = Date.parse(String(b.job.posted_at || "")) || 0;
        return tb - ta;
      });
    } else {
      arr.sort((a, b) => b.score - a.score);
    }
    return arr;
  }, [filteredMatches, sortBy]);

  const selectedMatch =
    sortedMatches.find((match) => match.job.job_id === selectedId) || sortedMatches[0] || null;
  const selectedStatus = selectedMatch ? latestApplications.get(selectedMatch.job.job_id)?.status : undefined;

  useEffect(() => {
    const hasResume = window.localStorage.getItem("jobgraph_resume_uploaded") === "true";
    if (hasResume) {
      loadIntakeProfile();
    } else {
      router.replace("/upload");
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
      setWorkAuthorization(autofill.work_authorization || "");
      setSponsorshipRequired(autofill.sponsorship_required || "");
      // Resume was uploaded before — go straight to the job board (not the legacy intake layout).
      setShowJobs(true);
      setPipelineMessage("Loading ranked jobs...");
      try {
        await searchJobsFromProfile(profile, { manageLoading: false });
      } catch (searchErr) {
        setError(String(searchErr));
      }
    } catch (caught) {
      setError(String(caught));
    } finally {
      setLoading(false);
      setPipelineMessage(null);
    }
  }

  async function uploadResume(file: File | null) {
    if (!file) return;
    setError("");
    setPipelineMessage("Analyzing resume…");
    setUploading(true);
    let parsedProfile: Candidate | null = null;
    try {
      const form = new FormData();
      form.append("file", file);
      const params = new URLSearchParams({
        candidate_id: "default",
        k: "35",
        ingest: "false",
      });
      const response = await fetch(`${API}/recommendations/resume?${params.toString()}`, { method: "POST", body: form });
      if (!response.ok) throw new Error((await response.text()) || "Resume recommendation failed");
      const payload: ResumeRecommendations = await response.json();
      parsedProfile = payload.candidate;
      const [autofill, applicationData] = await Promise.all([
        apiGet<AutofillProfile>("/autofill/default"),
        apiGet<ApplicationEvent[]>("/applications/default"),
      ]);
      window.localStorage.setItem("jobgraph_resume_uploaded", "true");
      setCandidate(parsedProfile);
      setMatches(payload.matches || []);
      setApplications(applicationData || []);
      setSelectedId(payload.matches?.[0]?.job.job_id || "");
      setGnnDiagnostics(payload.gnn_diagnostics || null);
      setParsedResume(payload.parsed_resume || null);
      setRecommendationRun(payload.recommendation_run || null);
      setWorkAuthorization(autofill.work_authorization || "");
      setSponsorshipRequired(autofill.sponsorship_required || "");
      if (payload.ingestion?.status === "failed") {
        setError(`Live job ingestion failed, showing stored jobs ranked by GNN: ${payload.ingestion.error}`);
      }
    } catch (caught) {
      setError(String(caught));
      setPipelineMessage(null);
      setUploading(false);
      return;
    } finally {
      setUploading(false);
    }

    if (!parsedProfile) {
      setPipelineMessage(null);
      return;
    }

    setShowJobs(true);
    setPipelineMessage(null);
  }

  async function searchJobsFromProfile(_profile: Candidate, opts?: { manageLoading?: boolean }) {
    const manageLoading = opts?.manageLoading !== false;
    if (manageLoading) {
      setLoading(true);
      setError("");
    }
    try {
      const [matchData, applicationData] = await Promise.all([
        apiGet<{ matches: Match[] }>("/matches/default?k=35"),
        apiGet<ApplicationEvent[]>("/applications/default"),
      ]);
      setMatches(matchData.matches || []);
      setApplications(applicationData || []);
      setSelectedId(matchData.matches?.[0]?.job.job_id || "");
    } catch (caught) {
      setError(String(caught));
    } finally {
      if (manageLoading) setLoading(false);
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
    setError("");
    setPipelineMessage("Loading ranked jobs...");
    setLoading(true);
    try {
      await saveIntakeAnswers();
      setShowJobs(true);
      await searchJobsFromProfile(candidate, { manageLoading: false });
    } catch (caught) {
      setShowJobs(false);
      setError(String(caught));
    } finally {
      setLoading(false);
      setPipelineMessage(null);
    }
  }

  async function refetchMatches() {
    if (!candidate) return;
    setError("");
    setPipelineMessage("Loading ranked jobs...");
    setLoading(true);
    try {
      await saveIntakeAnswers();
      await searchJobsFromProfile(candidate, { manageLoading: false });
    } catch (caught) {
      setError(String(caught));
    } finally {
      setLoading(false);
      setPipelineMessage(null);
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
    if (SHOW_DEBUG) setEvaluation(response.evaluation || null);
  }

  async function applyWithAgent(match: Match) {
    setSelectedId(match.job.job_id);
    setError("");
    setApplyRun(null);
    try {
      const run = await apiPost<ApplyAgentRun>("/apply-agent/runs", {
        candidate_id: "default",
        job_id: match.job.job_id,
        headless: false,
      });
      setApplyRun(run);
      try {
        await recordApplication(match.job.job_id, run.apply_url ? "applying" : "failed", "Apply agent started.");
      } catch (trackingError) {
        setError(`Agent started, but tracker update failed: ${String(trackingError)}`);
      }
    } catch (caught) {
      setError(`Could not start the autofill agent: ${String(caught)}`);
    }
  }

  if (!showJobs) {
    const intakeComplete = Boolean(candidate && workAuthorization && sponsorshipRequired);
    const pipelineBusy = Boolean(pipelineMessage || uploading || loading);
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
                Upload → ranked jobs → open & autofill (you submit).
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
                  After upload we parse your resume, pull jobs from your ATS catalog, and rank matches. Answer the two questions for better autofill—you can still view jobs first.
                </p>

                <label
                  className={`mt-8 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-white/15 bg-white/5 p-6 text-center transition hover:bg-white/10 ${pipelineBusy ? "pointer-events-none opacity-60" : ""}`}
                >
                  <span className="grid h-14 w-14 place-items-center rounded-full bg-white text-black">
                    <Upload size={22} />
                  </span>
                  <span className="mt-4 text-lg font-bold">
                    {pipelineMessage || (uploading ? "Analyzing resume…" : candidate ? "Replace resume" : "Upload resume")}
                  </span>
                  <span className="mt-2 text-sm text-zinc-400">PDF, DOCX, or TXT. We save your resume for autofill on apply forms.</span>
                  <input type="file" accept=".pdf,.txt,.docx" className="hidden" disabled={pipelineBusy} onChange={(event) => uploadResume(event.target.files?.[0] || null)} />
                </label>

                {pipelineMessage && pipelineMessage !== "Analyzing resume…" && (
                  <p className="mt-4 text-center text-sm font-medium text-[#c4e9ff]">{pipelineMessage}</p>
                )}

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
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Application autofill (recommended)</p>
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
                  disabled={!candidate || pipelineBusy}
                  className="mt-8 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white/10 px-5 text-base font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ArrowRight size={19} />
                  {loading ? "Fetching jobs…" : "Refetch ranked jobs"}
                </button>
                <p className="mt-2 text-center text-xs text-zinc-500">Uses your profile role and location. Upload above runs this automatically.</p>
                {!intakeComplete && candidate && (
                  <p className="mt-3 text-center text-sm text-amber-200/90">Answer both questions above so autofill can answer common ATS screens.</p>
                )}
                <p className="mt-6 text-center text-sm text-zinc-500">
                  <Link href="/settings/sources" className="text-[#b58cf4] underline-offset-2 hover:underline">
                    ATS companies catalog
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <>
      {SHOW_DEBUG && (recommendationRun || evaluation) && (
        <div className="fixed bottom-3 right-3 z-[70] max-w-xs rounded-xl border border-amber-500/30 bg-[#1a1a1c] p-3 text-xs text-amber-100 shadow-xl">
          <p className="font-semibold text-amber-200">Debug</p>
          <p className="mt-1 text-zinc-400">
            MRR {Math.round((evaluation?.mrr ?? 0) * 100)}% · NDCG {Math.round((evaluation?.ndcg_at_k ?? 0) * 100)}%
          </p>
        </div>
      )}
      <JobBoardView
        candidate={candidate}
        parsedResume={parsedResume}
        workAuthorization={workAuthorization}
        sponsorshipRequired={sponsorshipRequired}
        matches={sortedMatches}
        selectedId={selectedId}
        onSelectJob={setSelectedId}
        latestStatus={(jobId) => latestApplications.get(jobId)?.status}
        boardSearch={boardSearch}
        onBoardSearchChange={setBoardSearch}
        headerLocation={filterLocation}
        onHeaderLocationChange={setFilterLocation}
        onSearchSubmit={() => {
          document.getElementById("job-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
        filterRemote={filterRemote}
        onFilterRemote={setFilterRemote}
        filterMinScore={filterMinScore}
        onFilterMinScore={setFilterMinScore}
        filterAts={filterAts}
        onFilterAts={setFilterAts}
        showAdvancedFilters={showAdvancedFilters}
        onToggleAdvancedFilters={() => setShowAdvancedFilters((v) => !v)}
        sortBy={sortBy}
        onSortBy={setSortBy}
        loading={loading}
        uploading={uploading}
        pipelineMessage={pipelineMessage}
        error={error}
        onRefetch={refetchMatches}
        onUpload={uploadResume}
        onSaveJob={(jobId) => recordApplication(jobId, "saved", "Saved from job board.")}
        onOpenAutofill={applyWithAgent}
        onCompleteProfile={() => setShowJobs(false)}
        showIntakeBanner={Boolean(candidate && (!workAuthorization || !sponsorshipRequired))}
        selectedMatch={selectedMatch}
        selectedStatus={selectedStatus}
        applyRun={applyRun}
      />
    </>
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
