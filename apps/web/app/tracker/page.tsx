"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, ExternalLink } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8022";

type ApplicationSummary = {
  job_id: string;
  latest_status: string;
  latest_note: string;
  applied_at?: string | null;
  reminder_at?: string | null;
  last_updated: string;
  history_count: number;
  job_title: string;
  company: string;
};

const STATUS_ORDER = ["saved", "applied", "interview", "offer", "rejected", "skipped", "applying", "failed"];

function statusRank(s: string) {
  const i = STATUS_ORDER.indexOf(s.toLowerCase());
  return i >= 0 ? i : 0;
}

export default function TrackerPage() {
  const [rows, setRows] = useState<ApplicationSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/applications/default/summary`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setRows(data);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const sorted = [...rows].sort((a, b) => {
    const rd = statusRank(b.latest_status) - statusRank(a.latest_status);
    if (rd !== 0) return rd;
    return new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime();
  });

  return (
    <main className="min-h-screen bg-[#0f0f10] px-4 py-8 text-white">
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← Home
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-light">Application tracker</h1>
            <p className="mt-2 max-w-xl text-zinc-400">
              Pipeline: Saved → Applied → Interview → Offer or Rejected. Each update appends history; summary shows the latest state per job. Set{" "}
              <code className="rounded bg-white/10 px-1">reminder_at</code> via the API when posting events.
            </p>
          </div>
          <Link href="/workspace" className="inline-flex items-center gap-2 text-sm font-semibold text-[#b58cf4] hover:underline">
            Workspace
            <ExternalLink size={14} />
          </Link>
        </div>

        <section className="mt-8 rounded-2xl border border-white/10 bg-[#171717] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-400">
            <Bell size={16} />
            By job (latest status)
          </div>
          {loading ? (
            <p className="text-zinc-500">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-zinc-500">
                    <th className="py-2 pr-4 font-medium">Role</th>
                    <th className="py-2 pr-4 font-medium">Company</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Applied</th>
                    <th className="py-2 pr-4 font-medium">Reminder</th>
                    <th className="py-2 pr-4 font-medium">History</th>
                    <th className="py-2 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.job_id} className="border-b border-white/5 text-zinc-200 last:border-0">
                      <td className="py-3 pr-4">
                        <Link href={`/tracker/job/${encodeURIComponent(r.job_id)}`} className="font-medium text-[#b58cf4] hover:underline">
                          {r.job_title || r.job_id.slice(0, 18) + "…"}
                        </Link>
                      </td>
                      <td className="py-3 pr-4 text-zinc-400">{r.company || "—"}</td>
                      <td className="py-3 pr-4 capitalize">{r.latest_status.replaceAll("_", " ")}</td>
                      <td className="py-3 pr-4 text-xs text-zinc-500">{r.applied_at ? new Date(r.applied_at).toLocaleDateString() : "—"}</td>
                      <td className="py-3 pr-4 text-xs text-zinc-500">{r.reminder_at ? new Date(r.reminder_at).toLocaleDateString() : "—"}</td>
                      <td className="py-3 pr-4 text-zinc-400">{r.history_count}</td>
                      <td className="py-3 text-xs text-zinc-500">{new Date(r.last_updated).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!sorted.length && <p className="py-8 text-center text-zinc-500">No applications yet. Save or apply from the workspace.</p>}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
