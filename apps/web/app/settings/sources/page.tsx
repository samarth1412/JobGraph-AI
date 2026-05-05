"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRedirectToUploadOnReload } from "../../lib/useRedirectToUploadOnReload";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8022";

type AtsSourcesResponse = {
  catalog_path: string;
  last_refresh: string | null;
  counts: Record<string, number>;
  by_ats: Record<string, Array<{ company: string; board?: string; url?: string }>>;
};

export default function AtsSourcesSettingsPage() {
  useRedirectToUploadOnReload();
  const [data, setData] = useState<AtsSourcesResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${API}/settings/ats-sources`, { cache: "no-store" });
        if (!response.ok) throw new Error(await response.text());
        const payload = (await response.json()) as AtsSourcesResponse;
        if (!cancelled) setData(payload);
      } catch (caught) {
        if (!cancelled) setError(String(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#0f0f10] px-4 py-10 text-white sm:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[#b58cf4]">Settings</p>
            <h1 className="text-3xl font-bold tracking-tight">ATS job sources</h1>
            <p className="mt-2 text-zinc-400">
              Companies in <code className="rounded bg-white/10 px-1.5 py-0.5 text-sm text-zinc-200">companies.json</code> used
              when ingesting jobs (Ashby, Greenhouse, Lever, Workday).
            </p>
          </div>
          <Link href="/workspace" className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/5">
            Back to workspace
          </Link>
        </div>

        {error && <p className="mb-6 rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}

        {!data && !error && <p className="text-zinc-400">Loading catalog…</p>}

        {data && (
          <div className="space-y-6">
            <section className="rounded-2xl border border-white/10 bg-[#171717] p-6">
              <p className="text-sm text-zinc-500">Catalog file</p>
              <p className="mt-1 font-mono text-sm text-zinc-300">{data.catalog_path}</p>
              <p className="mt-4 text-sm text-zinc-500">Last job ingestion finished</p>
              <p className="mt-1 text-lg font-semibold text-white">{data.last_refresh || "— (run a search from workspace first)"}</p>
            </section>

            {(["ashby", "greenhouse", "lever", "workday"] as const).map((ats) => (
              <section key={ats} className="rounded-2xl border border-white/10 bg-[#171717] p-6">
                <h2 className="text-xl font-bold capitalize">{ats}</h2>
                <p className="mt-1 text-3xl font-black text-[#b58cf4]">{data.counts[ats] ?? 0}</p>
                <p className="mt-2 text-sm text-zinc-500">companies in catalog</p>
                <ul className="mt-4 max-h-48 overflow-y-auto text-sm text-zinc-300">
                  {(data.by_ats[ats] || []).map((row) => (
                    <li key={`${ats}-${row.company}`} className="border-b border-white/5 py-2 last:border-0">
                      <span className="font-medium text-white">{row.company}</span>
                      {row.board && <span className="ml-2 text-zinc-500">· {row.board}</span>}
                      {row.url && (
                        <span className="mt-1 block truncate text-xs text-zinc-500" title={row.url}>
                          {row.url}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
