"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Building2, MapPin, SlidersHorizontal } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8022";

type Job = {
  job_id: string;
  source: string;
  title: string;
  company: string;
  location: string;
  work_model: string;
  apply_url: string;
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

const ATS = ["ashby", "greenhouse", "lever", "workday"] as const;

export default function JobsPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [qRole, setQRole] = useState("");
  const [qLoc, setQLoc] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [atsFilter, setAtsFilter] = useState<string>("");
  const [minScore, setMinScore] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/matches/default?k=80`, { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setMatches(data.matches || []);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    return matches.filter((m) => {
      if (m.score < minScore) return false;
      if (atsFilter && m.job.source !== atsFilter) return false;
      if (remoteOnly && m.job.work_model !== "remote") return false;
      const blob = `${m.job.title} ${m.job.company}`.toLowerCase();
      if (qRole && !blob.includes(qRole.toLowerCase())) return false;
      if (qLoc && !m.job.location.toLowerCase().includes(qLoc.toLowerCase())) return false;
      return true;
    });
  }, [matches, minScore, atsFilter, remoteOnly, qRole, qLoc]);

  return (
    <main className="min-h-screen bg-[#0f0f10] px-4 py-8 text-white">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
              ← Home
            </Link>
            <h1 className="mt-2 text-3xl font-light">Matching ATS jobs</h1>
            <p className="mt-2 text-zinc-400">Ranked from your saved candidate profile. Ingest new jobs from the workspace.</p>
          </div>
          <Link href="/workspace" className="text-sm font-semibold text-[#b58cf4] hover:underline">
            Open workspace →
          </Link>
        </div>

        <section className="mb-8 rounded-2xl border border-white/10 bg-[#171717] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-400">
            <SlidersHorizontal size={16} />
            Filters
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <input
              className="rounded-xl border border-white/10 bg-[#252525] px-3 py-2 text-sm outline-none focus:border-[#b58cf4]"
              placeholder="Role keywords"
              value={qRole}
              onChange={(e) => setQRole(e.target.value)}
            />
            <input
              className="rounded-xl border border-white/10 bg-[#252525] px-3 py-2 text-sm outline-none focus:border-[#b58cf4]"
              placeholder="Location"
              value={qLoc}
              onChange={(e) => setQLoc(e.target.value)}
            />
            <select
              className="rounded-xl border border-white/10 bg-[#252525] px-3 py-2 text-sm outline-none"
              value={atsFilter}
              onChange={(e) => setAtsFilter(e.target.value)}
            >
              <option value="">All ATS</option>
              {ATS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input type="checkbox" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} />
              Remote only
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              Min score {minScore}
              <input type="range" min={0} max={90} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
            </label>
          </div>
        </section>

        {error && <p className="mb-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}
        {loading ? (
          <p className="text-zinc-500">Loading matches…</p>
        ) : (
          <ul className="space-y-3">
            {filtered.map((m) => (
              <li key={m.job.job_id}>
                <Link
                  href={`/jobs/${encodeURIComponent(m.job.job_id)}`}
                  className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-[#171717] p-4 transition hover:border-[#b58cf4]/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold uppercase text-zinc-300">{m.job.source}</span>
                      <span className="rounded-full bg-[#b58cf4]/20 px-2 py-0.5 text-xs font-bold text-[#e8d4ff]">{Math.round(m.score)}% match</span>
                    </div>
                    <h2 className="mt-1 truncate text-lg font-semibold">{m.job.title}</h2>
                    <p className="flex flex-wrap items-center gap-3 text-sm text-zinc-400">
                      <span className="inline-flex items-center gap-1">
                        <Building2 size={14} />
                        {m.job.company}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={14} />
                        {m.job.location || "—"}
                      </span>
                    </p>
                  </div>
                  <div className="text-right text-xs text-zinc-500">
                    {m.matched_skills.slice(0, 4).join(", ")}
                    {m.matched_skills.length > 4 ? "…" : ""}
                  </div>
                </Link>
              </li>
            ))}
            {!filtered.length && <li className="rounded-2xl border border-white/10 bg-[#171717] p-8 text-center text-zinc-500">No jobs match filters. Try workspace → Search to ingest ATS listings.</li>}
          </ul>
        )}
      </div>
    </main>
  );
}
