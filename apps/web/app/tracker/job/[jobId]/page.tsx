"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useRedirectToUploadOnReload } from "../../../lib/useRedirectToUploadOnReload";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8022";

type ApplicationEvent = {
  id?: number;
  candidate_id: string;
  job_id: string;
  status: string;
  note: string;
  timestamp: string;
  applied_at?: string | null;
  reminder_at?: string | null;
};

export default function JobApplicationHistoryPage() {
  useRedirectToUploadOnReload();
  const params = useParams();
  const jobId = decodeURIComponent(String(params.jobId || ""));
  const [events, setEvents] = useState<ApplicationEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!jobId) return;
    (async () => {
      try {
        const res = await fetch(`${API}/applications/default/jobs/${encodeURIComponent(jobId)}/history`, { cache: "no-store" });
        if (res.ok) setEvents(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, [jobId]);

  return (
    <main className="min-h-screen bg-[#0f0f10] px-4 py-8 text-white">
      <div className="mx-auto max-w-2xl">
        <Link href="/tracker" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← Tracker
        </Link>
        <h1 className="mt-4 text-2xl font-light">Application history</h1>
        <p className="mt-2 font-mono text-sm text-zinc-500">{jobId}</p>
        {loading ? (
          <p className="mt-8 text-zinc-500">Loading…</p>
        ) : (
          <ol className="mt-8 space-y-4 border-l border-white/10 pl-6">
            {events.map((e) => (
              <li key={`${e.id ?? e.timestamp}-${e.status}`} className="relative">
                <span className="absolute -left-[29px] top-1.5 h-3 w-3 rounded-full bg-[#b58cf4]" />
                <div className="rounded-xl border border-white/10 bg-[#171717] px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold capitalize text-zinc-100">{e.status.replaceAll("_", " ")}</span>
                    <span className="text-xs text-zinc-500">{new Date(e.timestamp).toLocaleString()}</span>
                  </div>
                  {e.note ? <p className="mt-2 text-sm text-zinc-400">{e.note}</p> : null}
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-500">
                    {e.applied_at && <span>Applied at: {new Date(e.applied_at).toLocaleString()}</span>}
                    {e.reminder_at && <span>Reminder: {new Date(e.reminder_at).toLocaleString()}</span>}
                  </div>
                </div>
              </li>
            ))}
            {!events.length && <li className="text-zinc-500">No events for this job yet.</li>}
          </ol>
        )}
      </div>
    </main>
  );
}
