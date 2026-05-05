"use client";

import { CompanyLogo } from "../../components/CompanyLogo";
import {
  Bot,
  Building2,
  ChevronDown,
  MapPin,
  ExternalLink,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Upload,
} from "lucide-react";
import type { ReactNode } from "react";

export type JobBoardJob = {
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
};

export type JobBoardMatch = {
  job: JobBoardJob;
  score: number;
  matched_skills: string[];
  missing_skills: string[];
  explanation: string;
  graph_paths?: string[];
  score_breakdown?: Record<string, number>;
  why_fit?: string[];
  why_may_not_fit?: string[];
  gnn_score?: number;
  semantic_score?: number;
  skill_overlap_score?: number;
  location_experience_fit_score?: number;
};

type ResumePerson = {
  name?: string;
  email?: string;
  summary?: string;
  target_roles?: string[];
  skills?: string[];
  projects?: string[];
  experience_years?: number;
};

type Props = {
  candidate: ResumePerson | null;
  parsedResume: ResumePerson | null;
  workAuthorization: string;
  sponsorshipRequired: string;
  matches: JobBoardMatch[];
  selectedId: string;
  onSelectJob: (jobId: string) => void;
  latestStatus: (jobId: string) => string | undefined;
  boardSearch: string;
  onBoardSearchChange: (v: string) => void;
  headerLocation: string;
  onHeaderLocationChange: (v: string) => void;
  onSearchSubmit: () => void;
  filterRemote: "any" | "remote" | "onsite";
  onFilterRemote: (v: "any" | "remote" | "onsite") => void;
  filterMinScore: number;
  onFilterMinScore: (n: number) => void;
  filterAts: string;
  onFilterAts: (v: string) => void;
  showAdvancedFilters: boolean;
  onToggleAdvancedFilters: () => void;
  sortBy: "score" | "recent";
  onSortBy: (v: "score" | "recent") => void;
  loading: boolean;
  uploading: boolean;
  pipelineMessage: string | null;
  error: string;
  onRefetch: () => void;
  onUpload: (file: File | null) => void;
  onSaveJob: (jobId: string) => void;
  onOpenAutofill: (match: JobBoardMatch) => void;
  onCompleteProfile: () => void;
  showIntakeBanner: boolean;
  selectedMatch: JobBoardMatch | null;
  selectedStatus?: string;
  applyRun: {
    status: string;
    ats: string;
    metadata?: {
      agent_status?: string;
      steps?: Array<{ label: string; status: string; details?: string }>;
    };
    page_summary?: string;
    error?: string;
    filled_fields?: unknown[];
    blockers?: { label: string; reason: string }[];
    file_fields?: unknown[];
  } | null;
};

function formatSalary(job: JobBoardJob): string {
  const lo = job.salary_min;
  const hi = job.salary_max;
  if (lo != null && hi != null && hi > lo) return `${Math.round(lo / 1000)}–${Math.round(hi / 1000)}K`;
  if (lo != null) return `${Math.round(lo / 1000)}K+`;
  if (hi != null) return `Up to ${Math.round(hi / 1000)}K`;
  return "—";
}

function formatPosted(posted?: string | null): string {
  if (!posted) return "—";
  const t = Date.parse(posted);
  if (Number.isNaN(t)) return posted;
  const diff = Date.now() - t;
  const h = Math.floor(diff / 36e5);
  if (h < 1) return "Just now";
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

function statusLabel(status?: string) {
  if (!status) return "New";
  return status.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function previewText(value: string, length = 320) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "No full description for this listing yet.";
  return cleaned.length > length ? `${cleaned.slice(0, length).trim()}…` : cleaned;
}

function cleanProject(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/^(project|projects)\s*[:|-]\s*/i, "")
    .trim()
    .slice(0, 220);
}

function atsLabel(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "ATS";
}

export function JobBoardView(props: Props) {
  const {
    candidate,
    parsedResume,
    matches,
    selectedId,
    onSelectJob,
    latestStatus,
    boardSearch,
    onBoardSearchChange,
    headerLocation,
    onHeaderLocationChange,
    onSearchSubmit,
    filterRemote,
    onFilterRemote,
    filterMinScore,
    onFilterMinScore,
    filterAts,
    onFilterAts,
    showAdvancedFilters,
    onToggleAdvancedFilters,
    sortBy,
    onSortBy,
    loading,
    uploading,
    pipelineMessage,
    error,
    onRefetch,
    onUpload,
    onSaveJob,
    onOpenAutofill,
    onCompleteProfile,
    showIntakeBanner,
    selectedMatch,
    selectedStatus,
    applyRun,
  } = props;

  const m = selectedMatch;

  return (
    <div className="flex min-h-screen flex-col bg-[#0c0c0d] text-zinc-100">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-white/[0.06] bg-[#0c0c0d] px-5 py-5 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-black">
                <Sparkles size={20} strokeWidth={2.25} />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold tracking-tight text-white sm:text-xl">JobGraph AI</h1>
                <p className="text-xs text-zinc-500">Graph-ranked matches from your resume</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="cursor-pointer rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.08]">
                {uploading ? "…" : "Upload resume"}
                <input type="file" accept=".pdf,.txt,.docx" className="hidden" disabled={loading || uploading} onChange={(e) => onUpload(e.target.files?.[0] || null)} />
              </label>
              <button
                type="button"
                onClick={onRefetch}
                disabled={!candidate || loading || uploading}
                className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-white/[0.08] disabled:opacity-40"
              >
                Refresh matches
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-[#141416] p-1.5 sm:flex-row sm:items-stretch">
            <div className="flex min-w-0 flex-1 items-center gap-2 border-b border-white/[0.06] px-3 sm:border-b-0 sm:border-r sm:border-white/[0.06]">
              <Search className="h-4 w-4 shrink-0 text-zinc-500" />
              <input
                className="h-11 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
                placeholder="Filter by title, company, or keyword…"
                value={boardSearch}
                onChange={(e) => onBoardSearchChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSearchSubmit()}
              />
            </div>
            <div className="flex items-center gap-2 px-3 sm:max-w-[220px] sm:border-r sm:border-white/[0.06]">
              <MapPin className="h-4 w-4 shrink-0 text-zinc-500" />
              <input
                className="h-11 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
                placeholder="Location"
                value={headerLocation}
                onChange={(e) => onHeaderLocationChange(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={onSearchSubmit}
              className="mx-1 flex h-11 shrink-0 items-center justify-center rounded-lg bg-white px-6 text-sm font-semibold text-black hover:bg-zinc-200"
            >
              Search
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onFilterRemote(filterRemote === "remote" ? "any" : "remote")}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                filterRemote === "remote" ? "border-white bg-white text-black" : "border-white/15 bg-white/[0.04] text-zinc-300 hover:border-white/25"
              }`}
            >
              Remote-friendly
            </button>
            <button
              type="button"
              onClick={() => onFilterMinScore(filterMinScore > 0 ? 0 : 50)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                filterMinScore >= 50 ? "border-white bg-white text-black" : "border-white/15 bg-white/[0.04] text-zinc-300 hover:border-white/25"
              }`}
            >
              Strong match (50%+)
            </button>
            <button
              type="button"
              onClick={onToggleAdvancedFilters}
              className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-white/25"
            >
              <SlidersHorizontal size={14} />
              All filters
            </button>
          </div>

          {(pipelineMessage || loading) && (
            <p className="mt-3 flex items-center gap-2 text-xs text-zinc-400" role="status">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
              {pipelineMessage || "Updating…"}
            </p>
          )}
          {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
        </header>

        {showIntakeBanner && (
          <div className="border-b border-amber-500/20 bg-amber-500/[0.07] px-5 py-3 text-sm text-amber-100/95 lg:px-8">
            <span className="font-medium text-white">Profile:</span> add work authorization & sponsorship for better autofill.{" "}
            <button type="button" className="font-semibold text-white underline-offset-2 hover:underline" onClick={onCompleteProfile}>
              Complete
            </button>
          </div>
        )}

        {/* Main + detail */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="min-h-0 min-w-0 flex-1 overflow-auto px-4 py-5 lg:px-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-zinc-400">
                <span className="font-semibold text-white">{matches.length}</span> jobs in view
              </p>
              <div className="relative">
                <select
                  className="h-9 cursor-pointer appearance-none rounded-lg border border-white/10 bg-[#141416] pl-3 pr-9 text-xs font-medium text-zinc-200"
                  value={sortBy}
                  onChange={(e) => onSortBy(e.target.value as "score" | "recent")}
                >
                  <option value="score">Most relevant</option>
                  <option value="recent">Newest posted</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              </div>
            </div>

            {showAdvancedFilters && (
              <div className="mb-4 grid gap-3 rounded-xl border border-white/[0.08] bg-[#141416] p-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-xs text-zinc-500">
                  ATS
                  <select
                    className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-[#0c0c0d] px-2 text-sm text-white"
                    value={filterAts}
                    onChange={(e) => onFilterAts(e.target.value)}
                  >
                    <option value="">All</option>
                    <option value="ashby">ASHBY</option>
                    <option value="greenhouse">GREENHOUSE</option>
                    <option value="lever">LEVER</option>
                    <option value="workday">WORKDAY</option>
                  </select>
                </label>
                <label className="text-xs text-zinc-500">
                  Work model
                  <select
                    className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-[#0c0c0d] px-2 text-sm text-white"
                    value={filterRemote}
                    onChange={(e) => onFilterRemote(e.target.value as "any" | "remote" | "onsite")}
                  >
                    <option value="any">Any</option>
                    <option value="remote">Remote-friendly</option>
                    <option value="onsite">On-site / hybrid focus</option>
                  </select>
                </label>
                <label className="text-xs text-zinc-500">
                  Min match %
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-[#0c0c0d] px-2 text-sm text-white"
                    value={filterMinScore || ""}
                    placeholder="0"
                    onChange={(e) => onFilterMinScore(Number(e.target.value) || 0)}
                  />
                </label>
              </div>
            )}

            {/* Table — filters apply as you type; Search scrolls here */}
            <div id="job-results" className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#111113]">
              <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1.55fr)_0.75fr_0.85fr_0.7fr_0.75fr_52px] gap-3 border-b border-white/[0.06] px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 max-md:hidden">
                <span>Team</span>
                <span>Position</span>
                <span>Match</span>
                <span>Source</span>
                <span>Salary</span>
                <span>Posted</span>
                <span className="text-center">Save</span>
              </div>
              <div className="divide-y divide-white/[0.05]">
                {matches.map((match, index) => {
                  const sel = selectedId === match.job.job_id;
                  const st = latestStatus(match.job.job_id);
                  return (
                    <div
                      key={match.job.job_id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectJob(match.job.job_id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectJob(match.job.job_id);
                        }
                      }}
                      className={`relative grid w-full max-md:grid-cols-1 max-md:gap-2 max-md:py-4 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1.55fr)_0.75fr_0.85fr_0.7fr_0.75fr_52px] md:items-center md:gap-3 md:px-4 md:py-3.5 md:text-left ${
                        sel ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
                      }`}
                    >
                      <div className="flex items-center gap-3 max-md:px-4">
                        <CompanyLogo name={match.job.company} logoUrl={match.job.company_logo_url} index={index} />
                        <span className="truncate text-left text-sm font-medium text-white">{match.job.company}</span>
                      </div>
                      <div className="max-md:px-4 md:text-left">
                        <p className="truncate text-sm font-medium text-white">{match.job.title}</p>
                        <p className="truncate text-xs text-zinc-500">{match.job.location || "—"}</p>
                      </div>
                      <div className="max-md:flex max-md:items-center max-md:justify-between max-md:px-4 md:text-left">
                        <span className="text-xs text-zinc-500 md:hidden">Match</span>
                        <span className="text-sm font-semibold text-violet-300">{Math.round(match.score)}%</span>
                      </div>
                      <div className="max-md:flex max-md:items-center max-md:justify-between max-md:px-4 md:text-left">
                        <span className="text-xs text-zinc-500 md:hidden">Source</span>
                        <span className="rounded-md bg-white/[0.06] px-2 py-1 text-[11px] font-semibold uppercase text-zinc-300">
                          {atsLabel(match.job.source)}
                        </span>
                      </div>
                      <div className="max-md:flex max-md:items-center max-md:justify-between max-md:px-4 md:text-left">
                        <span className="text-xs text-zinc-500 md:hidden">Salary</span>
                        <span className="text-sm text-zinc-200">{formatSalary(match.job)}</span>
                      </div>
                      <div className="max-md:flex max-md:items-center max-md:justify-between max-md:px-4 md:text-left">
                        <span className="text-xs text-zinc-500 md:hidden">Posted</span>
                        <span className="text-xs text-zinc-400">{formatPosted(match.job.posted_at)}</span>
                      </div>
                      <div className="flex justify-center md:static" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          title="Save"
                          onClick={() => onSaveJob(match.job.job_id)}
                          className="grid h-9 w-9 place-items-center rounded-full text-zinc-400 hover:bg-white/[0.08] hover:text-amber-300"
                        >
                          <Star
                            size={18}
                            className={st === "saved" ? "fill-amber-400 text-amber-400" : "text-zinc-500"}
                            fill={st === "saved" ? "currentColor" : "none"}
                          />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {!matches.length && (
                <div className="px-6 py-16 text-center text-sm text-zinc-500">
                  {loading ? "Loading jobs…" : "No jobs match your search. Try widening filters or refresh."}
                </div>
              )}
            </div>

            {(parsedResume || candidate) && (
              <div className="mt-6 rounded-xl border border-white/[0.08] bg-[#141416] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Your profile</p>
                <p className="mt-1 text-sm font-medium text-white">{parsedResume?.name || candidate?.name}</p>
                {(parsedResume?.summary || candidate?.summary) && (
                  <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-zinc-400">{parsedResume?.summary || candidate?.summary}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(parsedResume?.skills || candidate?.skills || []).slice(0, 10).map((s) => (
                    <span key={s} className="rounded-md bg-white/[0.06] px-2 py-1 text-xs text-zinc-300">
                      {s}
                    </span>
                  ))}
                </div>
                {Boolean((parsedResume?.projects || candidate?.projects || []).length) && (
                  <div className="mt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Resume projects</p>
                    <div className="mt-2 space-y-2">
                      {(parsedResume?.projects || candidate?.projects || []).slice(0, 3).map((project) => (
                        <p key={project} className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-xs leading-relaxed text-zinc-300">
                          {cleanProject(project)}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Detail panel */}
          <aside className="w-full shrink-0 border-t border-white/[0.08] bg-[#0e0e10] lg:w-[min(100%,420px)] lg:border-l lg:border-t-0 lg:border-white/[0.06]">
            <div className="sticky top-0 max-h-[calc(100vh-0px)] overflow-y-auto lg:max-h-screen">
              <div className="border-b border-white/[0.06] px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Job details</p>
                {m ? (
                  <div className="mt-3 flex gap-3">
                    <CompanyLogo name={m.job.company} logoUrl={m.job.company_logo_url} sizeClass="h-12 w-12" index={0} />
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold leading-snug text-white">{m.job.title}</h2>
                      <p className="text-sm text-zinc-400">
                        {m.job.company} · {m.job.location || "—"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-zinc-500">Select a job from the list.</p>
                )}
              </div>

              {m && (
                <>
                  <div className="grid grid-cols-3 gap-px border-b border-white/[0.06] bg-white/[0.06]">
                    <div className="bg-[#0e0e10] px-3 py-3 text-center">
                      <p className="text-[10px] font-semibold uppercase text-zinc-500">Match</p>
                      <p className="mt-1 text-sm font-semibold text-violet-300">{Math.round(m.score)}%</p>
                    </div>
                    <div className="bg-[#0e0e10] px-3 py-3 text-center">
                      <p className="text-[10px] font-semibold uppercase text-zinc-500">Salary</p>
                      <p className="mt-1 text-xs font-medium text-zinc-200">{formatSalary(m.job)}</p>
                    </div>
                    <div className="bg-[#0e0e10] px-3 py-3 text-center">
                      <p className="text-[10px] font-semibold uppercase text-zinc-500">Posted</p>
                      <p className="mt-1 text-xs text-zinc-400">{formatPosted(m.job.posted_at)}</p>
                    </div>
                  </div>

                  <div className="space-y-5 px-5 py-5 text-sm">
                    <section>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">What&apos;s the role?</h3>
                      <p className="mt-2 leading-relaxed text-zinc-300">{previewText(m.job.description)}</p>
                    </section>
                    <section>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Score breakdown</h3>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {[
                          ["GNN / graph", m.gnn_score],
                          ["Skill match", m.skill_overlap_score],
                          ["Semantic", m.semantic_score],
                          ["Location + exp", m.location_experience_fit_score],
                        ].map(([label, value]) => (
                          <div key={String(label)} className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase text-zinc-500">{label}</p>
                            <p className="mt-1 text-sm font-semibold text-white">{Math.round(Number(value || 0))}%</p>
                          </div>
                        ))}
                      </div>
                    </section>
                    {!!m.matched_skills?.length && (
                      <section>
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Matching skills</h3>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {m.matched_skills.slice(0, 12).map((s) => (
                            <span key={s} className="rounded-md bg-emerald-500/15 px-2 py-1 text-xs text-emerald-200/90">
                              {s}
                            </span>
                          ))}
                        </div>
                      </section>
                    )}
                    {!!m.missing_skills?.length && (
                      <section>
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Missing signals</h3>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {m.missing_skills.slice(0, 8).map((s) => (
                            <span key={s} className="rounded-md bg-amber-500/15 px-2 py-1 text-xs text-amber-200/90">
                              {s}
                            </span>
                          ))}
                        </div>
                      </section>
                    )}
                    {(m.why_fit?.length || m.why_may_not_fit?.length) && (
                      <section className="space-y-3 text-zinc-300">
                        {!!m.why_fit?.length && (
                          <div>
                            <h3 className="text-xs font-semibold uppercase text-zinc-500">Why recommended</h3>
                            <ul className="mt-2 list-inside list-disc text-xs leading-relaxed">
                              {m.why_fit.map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </section>
                    )}
                    {!!m.graph_paths?.length && (
                      <section>
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Shared graph paths</h3>
                        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-400">
                          {m.graph_paths.map((path) => (
                            <li key={path} className="rounded-md bg-white/[0.04] px-2 py-1">
                              {path}
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                  </div>

                  <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-white/[0.08] bg-[#0e0e10] px-5 py-4">
                    <button
                      type="button"
                      onClick={() => onSaveJob(m.job.job_id)}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] py-2.5 text-sm font-medium text-white hover:bg-white/[0.1]"
                    >
                      <Star size={16} className={selectedStatus === "saved" ? "fill-amber-400 text-amber-400" : ""} />
                      Saved
                    </button>
                    <a
                      href={m.job.apply_url || "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/15 py-2.5 text-sm font-medium text-zinc-200 hover:bg-white/[0.06]"
                    >
                      <ExternalLink size={16} />
                      Open
                    </a>
                    <button
                      type="button"
                      onClick={() => onOpenAutofill(m)}
                      className="w-full rounded-lg bg-white py-3 text-sm font-semibold text-black hover:bg-zinc-200"
                    >
                      Apply with Agent
                    </button>
                    <p className="w-full text-center text-[11px] text-zinc-500">Opens one browser window, fills details, then waits for your submit.</p>
                  </div>
                </>
              )}

              {applyRun && (
                <div className="border-t border-white/[0.06] px-5 py-4">
                  <div className="flex items-center gap-2">
                    <Bot size={16} className="text-zinc-400" />
                    <p className="text-xs font-semibold uppercase text-zinc-500">Autofill</p>
                  </div>
                  <p className="mt-2 text-sm font-medium text-white">{statusLabel(applyRun.status)}</p>
                  {applyRun.metadata?.agent_status && (
                    <p className="mt-2 text-xs leading-relaxed text-zinc-400">{String(applyRun.metadata.agent_status)}</p>
                  )}
                  {!!applyRun.metadata?.steps?.length && (
                    <ol className="mt-3 space-y-2">
                      {applyRun.metadata.steps.slice(-8).map((step, index) => (
                        <li key={`${step.label}-${index}`} className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-zinc-200">{step.label}</span>
                            <span className="text-[10px] uppercase text-zinc-500">{step.status.replaceAll("_", " ")}</span>
                          </div>
                          {step.details && <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{step.details}</p>}
                        </li>
                      ))}
                    </ol>
                  )}
                  {applyRun.error && <p className="mt-2 text-xs text-red-300">{applyRun.error}</p>}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
