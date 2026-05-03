import Link from "next/link";
import { ArrowRight, LayoutGrid, ListChecks, Sparkles } from "lucide-react";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#0f0f10] px-4 py-16 text-white sm:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-black">
          <Sparkles size={28} />
        </div>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#b58cf4]">ATS-only MVP</p>
        <h1 className="mt-4 text-4xl font-light tracking-tight sm:text-5xl">JobGraph AI</h1>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-zinc-400">
          Upload your resume, ingest jobs from Ashby, Greenhouse, Lever, and Workday, then explore ranked matches with a simple tracker and apply assistant.
        </p>
        <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/workspace"
            className="inline-flex items-center gap-2 rounded-full bg-[#b58cf4] px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:bg-[#a879ee]"
          >
            Open workspace
            <ArrowRight size={18} />
          </Link>
          <Link
            href="/jobs"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-8 py-3.5 text-base font-semibold text-zinc-100 transition hover:bg-white/10"
          >
            <LayoutGrid size={18} />
            Job results
          </Link>
          <Link
            href="/tracker"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-8 py-3.5 text-base font-semibold text-zinc-100 transition hover:bg-white/10"
          >
            <ListChecks size={18} />
            Tracker
          </Link>
        </div>
      </div>
    </main>
  );
}
