"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Bot, ExternalLink } from "lucide-react";
import { CompanyLogo } from "../../../components/CompanyLogo";
import { useRedirectToUploadOnReload } from "../../lib/useRedirectToUploadOnReload";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8022";

type Job = Record<string, unknown> & {
  job_id: string;
  source: string;
  title: string;
  company: string;
  location: string;
  description: string;
  apply_url: string;
  work_model: string;
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
  gnn_score?: number;
  semantic_score?: number;
  skill_overlap_score?: number;
  location_experience_fit_score?: number;
};

type ApplyAgentRun = {
  id?: number;
  status: string;
  ats: string;
  error?: string;
  metadata?: {
    agent_status?: string;
    steps?: Array<{ label: string; status: string; details?: string }>;
  };
};

export default function JobDetailPage() {
  useRedirectToUploadOnReload();
  const params = useParams();
  const jobId = decodeURIComponent(String(params.jobId || ""));
  const [match, setMatch] = useState<Match | null>(null);
  const [jobOnly, setJobOnly] = useState<Job | null>(null);
  const [applyRun, setApplyRun] = useState<ApplyAgentRun | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!jobId) return;
    (async () => {
      try {
        const res = await fetch(`${API}/matches/default?k=100`, { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const found = (data.matches as Match[] | undefined)?.find((m) => m.job.job_id === jobId);
        if (found) {
          setMatch(found);
          return;
        }
        const jr = await fetch(`${API}/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
        if (jr.ok) setJobOnly((await jr.json()) as Job);
        else setError("Job not found in matches or database.");
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [jobId]);

  useEffect(() => {
    if (!applyRun?.id || !["starting", "navigating", "filling"].includes(applyRun.status)) return;
    const timer = window.setInterval(async () => {
      const res = await fetch(`${API}/apply-agent/runs/${applyRun.id}`, { cache: "no-store" });
      if (res.ok) setApplyRun(await res.json());
    }, 1800);
    return () => window.clearInterval(timer);
  }, [applyRun?.id, applyRun?.status]);

  async function startAgent() {
    if (!job?.job_id) return;
    setError("");
    try {
      const res = await fetch(`${API}/apply-agent/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_id: "default", job_id: job.job_id, headless: false }),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const run = await res.json();
      setApplyRun(run);
    } catch (caught) {
      setError(`Could not start the autofill agent: ${String(caught)}`);
    }
  }

  const job = match?.job || jobOnly;

  return (
    <main className="min-h-screen bg-[#0f0f10] px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <Link href="/jobs" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← All jobs
        </Link>
        {error && <p className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}
        {!job && !error && <p className="mt-8 text-zinc-500">Loading…</p>}
        {job && (
          <article className="mt-6 space-y-6">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <CompanyLogo
                  name={String(job.company)}
                  logoUrl={typeof job.company_logo_url === "string" ? job.company_logo_url : undefined}
                  sizeClass="h-14 w-14"
                />
                <div>
                  <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase">{String(job.source)}</span>
                  {match && (
                    <span className="ml-2 rounded-full bg-[#b58cf4]/25 px-3 py-1 text-xs font-bold text-[#e8d4ff]">{Math.round(match.score)}% match</span>
                  )}
                </div>
              </div>
              <h1 className="mt-4 text-3xl font-light">{String(job.title)}</h1>
              <p className="mt-2 text-zinc-400">
                {String(job.company)} · {String(job.location || "—")} · {String(job.work_model || "")}
              </p>
            </div>
            {match && (
              <section className="rounded-2xl border border-white/10 bg-[#171717] p-4">
                <h2 className="text-sm font-semibold uppercase text-zinc-500">Why it fits</h2>
                <ul className="mt-2 list-inside list-disc text-sm text-zinc-300">
                  {(match.why_fit?.length ? match.why_fit : [match.explanation]).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
                {!!match.matched_skills?.length && (
                  <p className="mt-3 text-sm">
                    <span className="font-semibold text-[#98f5aa]">Matched skills:</span> {match.matched_skills.join(", ")}
                  </p>
                )}
                {!!match.missing_skills?.length && (
                  <p className="mt-2 text-sm">
                    <span className="font-semibold text-amber-200/90">Missing signals:</span> {match.missing_skills.join(", ")}
                  </p>
                )}
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ["GNN / graph", match.gnn_score],
                    ["Skill", match.skill_overlap_score],
                    ["Semantic", match.semantic_score],
                    ["Location + exp", match.location_experience_fit_score],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-[10px] font-semibold uppercase text-zinc-500">{label}</p>
                      <p className="mt-1 text-sm font-semibold text-white">{Math.round(Number(value || 0))}%</p>
                    </div>
                  ))}
                </div>
                {!!match.graph_paths?.length && (
                  <div className="mt-4">
                    <h2 className="text-sm font-semibold uppercase text-zinc-500">Graph explanation</h2>
                    <ul className="mt-2 space-y-2 text-sm text-zinc-400">
                      {match.graph_paths.map((path) => (
                        <li key={path} className="rounded-xl bg-white/[0.04] px-3 py-2">
                          {path}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!!match.why_may_not_fit?.length && (
                  <>
                    <h2 className="mt-4 text-sm font-semibold uppercase text-zinc-500">Why it may not fit</h2>
                    <ul className="mt-2 list-inside list-disc text-sm text-zinc-400">
                      {match.why_may_not_fit.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )}
            <section>
              <h2 className="text-lg font-semibold">Description</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">{String(job.description || "")}</p>
            </section>
            {String(job.apply_url || "") && (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={startAgent}
                  className="inline-flex items-center gap-2 rounded-full bg-[#b58cf4] px-6 py-3 text-sm font-semibold text-white hover:bg-[#a879ee]"
                >
                  <Bot size={16} />
                  Apply with Agent
                </button>
                <a
                  href={String(job.apply_url)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10"
                >
                  Open apply page
                  <ExternalLink size={16} />
                </a>
              </div>
            )}
            {applyRun && (
              <section className="rounded-2xl border border-white/10 bg-[#171717] p-4">
                <h2 className="text-sm font-semibold uppercase text-zinc-500">Agent progress</h2>
                <p className="mt-2 text-sm text-zinc-300">
                  {applyRun.ats.toUpperCase()} - {applyRun.status.replaceAll("_", " ")}
                </p>
                {applyRun.metadata?.agent_status && <p className="mt-2 text-sm text-zinc-400">{applyRun.metadata.agent_status}</p>}
                {!!applyRun.metadata?.steps?.length && (
                  <ol className="mt-4 space-y-2">
                    {applyRun.metadata.steps.map((step, index) => (
                      <li key={`${step.label}-${index}`} className="rounded-xl bg-white/[0.04] px-3 py-2 text-sm">
                        <div className="flex justify-between gap-3">
                          <span className="font-medium text-white">{step.label}</span>
                          <span className="text-xs uppercase text-zinc-500">{step.status.replaceAll("_", " ")}</span>
                        </div>
                        {step.details && <p className="mt-1 text-xs text-zinc-500">{step.details}</p>}
                      </li>
                    ))}
                  </ol>
                )}
                {applyRun.error && <p className="mt-3 text-sm text-red-300">{applyRun.error}</p>}
                <p className="mt-3 text-xs text-zinc-500">Review before submit. The agent will not submit automatically.</p>
              </section>
            )}
          </article>
        )}
      </div>
    </main>
  );
}
