"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

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
  why_fit?: string[];
  why_may_not_fit?: string[];
};

export default function JobDetailPage() {
  const params = useParams();
  const jobId = decodeURIComponent(String(params.jobId || ""));
  const [match, setMatch] = useState<Match | null>(null);
  const [jobOnly, setJobOnly] = useState<Job | null>(null);
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
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase">{String(job.source)}</span>
              {match && <span className="ml-2 rounded-full bg-[#b58cf4]/25 px-3 py-1 text-xs font-bold text-[#e8d4ff]">{Math.round(match.score)}% match</span>}
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
              <a
                href={String(job.apply_url)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-[#b58cf4] px-6 py-3 text-sm font-semibold text-white hover:bg-[#a879ee]"
              >
                Open apply page
                <ExternalLink size={16} />
              </a>
            )}
          </article>
        )}
      </div>
    </main>
  );
}
