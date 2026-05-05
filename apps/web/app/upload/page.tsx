"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Sparkles, Upload } from "lucide-react";
import { useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8022";

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
  candidate_resume_path?: string;
  education?: Record<string, string>;
  custom_answers?: Record<string, string>;
};

const sponsorshipOptions = ["No", "Yes", "Prefer not to answer"];
const genderOptions = ["Female", "Male", "Non-binary", "Prefer not to answer"];
const ethnicityOptions = [
  "Hispanic or Latino",
  "White",
  "Black or African American",
  "Asian",
  "American Indian or Alaska Native",
  "Native Hawaiian or Pacific Islander",
  "Two or more races",
  "Prefer not to answer",
];
const veteranOptions = ["I am a protected veteran", "I am not a protected veteran", "Prefer not to answer"];
const workAuthOptions = ["Yes", "No", "Prefer not to answer"];

export default function ResumeUploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sponsorship, setSponsorship] = useState("");
  const [gender, setGender] = useState("");
  const [ethnicity, setEthnicity] = useState("");
  const [veteran, setVeteran] = useState("");
  const [workAuth, setWorkAuth] = useState("");

  const canSubmit = useMemo(
    () => Boolean(file && sponsorship && gender && ethnicity && veteran && workAuth && !busy),
    [file, sponsorship, gender, ethnicity, veteran, workAuth, busy],
  );

  async function apiGet<T>(path: string): Promise<T> {
    const response = await fetch(`${API}${path}`, { cache: "no-store" });
    if (!response.ok) throw new Error((await response.text()) || `GET ${path} failed`);
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

  async function submitIntake() {
    if (!file || !canSubmit) return;
    setBusy(true);
    setError("");
    setMessage("Parsing resume and building your candidate profile...");
    try {
      const form = new FormData();
      form.append("file", file);
      // Keep upload snappy: parse + rank from existing job cache first.
      // Live ATS ingestion can take a long time; we kick it off in the background below.
      const params = new URLSearchParams({ candidate_id: "default", k: "35", ingest: "false" });
      const response = await fetch(`${API}/recommendations/resume?${params.toString()}`, { method: "POST", body: form });
      if (!response.ok) throw new Error((await response.text()) || "Resume upload failed");
      const recommendations = await response.json();

      // Fire-and-forget live ingestion so the UI doesn't block on external ATS latency.
      try {
        const query =
          recommendations?.recommendation_run?.query ||
          recommendations?.parsed_resume?.inferred_search_query ||
          "software engineer";
        const location =
          recommendations?.recommendation_run?.location ||
          recommendations?.parsed_resume?.inferred_search_location ||
          "United States";
        void fetch(`${API}/jobs/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            location,
            results_per_page: 35,
            sources: ["ashby", "greenhouse", "lever", "workday"],
          }),
        });
      } catch {
        // ignore background ingestion errors
      }

      setMessage("Saving application answers for autofill...");
      const current = await apiGet<AutofillProfile>("/autofill/default");
      await apiPut<AutofillProfile>("/autofill/default", {
        ...current,
        candidate_id: "default",
        work_authorization: workAuth,
        sponsorship_required: sponsorship,
        custom_answers: {
          ...(current.custom_answers || {}),
          gender,
          ethnicity,
          "race/ethnicity": ethnicity,
          "veteran status": veteran,
          veteran,
          sponsorship,
          "visa sponsorship": sponsorship,
          "work authorization": workAuth,
        },
      });

      window.localStorage.setItem("jobgraph_resume_uploaded", "true");
      if (recommendations.ingestion?.status === "failed") {
        window.localStorage.setItem("jobgraph_last_ingestion_error", recommendations.ingestion.error || "Live ATS fetch failed.");
      } else {
        window.localStorage.removeItem("jobgraph_last_ingestion_error");
      }
      setMessage("Resume parsed. Opening recommendations...");
      router.push("/workspace");
    } catch (caught) {
      setError(String(caught));
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0f0f10] px-4 py-8 text-white sm:px-6 lg:px-8">
      <header className="mx-auto mb-10 flex w-full max-w-6xl flex-col gap-4 border-b border-white/10 pb-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-black shadow-lg shadow-black/40">
            <Sparkles size={22} strokeWidth={2.25} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#b58cf4]">Resume intake</p>
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">JobGraph AI</h1>
            <p className="text-sm text-zinc-500">Resume → graph-ranked roles → guided apply</p>
          </div>
        </div>
      </header>

      <section className="mx-auto grid min-h-[calc(100vh-12rem)] w-full max-w-6xl gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
        <div>
          <h2 className="text-4xl font-light tracking-tight sm:text-5xl">Start with your resume.</h2>
          <p className="mt-4 max-w-xl text-base leading-7 text-zinc-400">
            Upload your resume, answer a few application basics, then we pull live listings from Greenhouse, Lever, Workday, and Ashby and rank them with our hybrid graph + semantic matcher.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#171717] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.35)] sm:p-6">
          <label className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/[0.04] p-6 text-center transition hover:bg-white/[0.08] ${busy ? "pointer-events-none opacity-60" : ""}`}>
            <span className="grid h-14 w-14 place-items-center rounded-full bg-white text-black">
              <Upload size={22} />
            </span>
            <span className="mt-4 text-lg font-semibold">{file ? file.name : "Choose resume file"}</span>
            <span className="mt-1 text-sm text-zinc-500">PDF, DOCX, TXT, or MD</span>
            <input type="file" accept=".pdf,.txt,.docx,.md" className="hidden" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] || null)} />
          </label>

          <div className="mt-6 grid gap-5">
            <ChoiceGroup label="Are you authorized to work in your target country?" value={workAuth} onChange={setWorkAuth} options={workAuthOptions} />
            <ChoiceGroup label="Will you now or in the future require visa sponsorship?" value={sponsorship} onChange={setSponsorship} options={sponsorshipOptions} />
            <ChoiceGroup label="Gender" value={gender} onChange={setGender} options={genderOptions} />
            <ChoiceGroup label="Race / ethnicity" value={ethnicity} onChange={setEthnicity} options={ethnicityOptions} />
            <ChoiceGroup label="Veteran status" value={veteran} onChange={setVeteran} options={veteranOptions} />
          </div>

          <button
            type="button"
            onClick={submitIntake}
            disabled={!canSubmit}
            className="mt-7 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={18} />}
            {busy ? "Working..." : "Find matched jobs"}
          </button>

          {message && <p className="mt-4 text-center text-sm text-[#c4e9ff]">{message}</p>}
          {error && <p className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}
        </div>
      </section>
    </main>
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
      <p className="mb-2 text-sm font-medium text-zinc-300">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`rounded-lg border px-3 py-2 text-sm transition ${
              value === option ? "border-white bg-white text-black" : "border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
