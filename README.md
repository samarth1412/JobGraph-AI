# 🚀 JobGraph AI — Autonomous Job Application Agent

> Find the right jobs — and let an AI agent apply to them for you.

JobGraph AI combines **graph-based job recommendation (GNN + semantic matching)** with an **autonomous multi-step application agent** that navigates real ATS workflows (Greenhouse, Lever, Workday).

⚡ From resume → ranked jobs → fully filled applications in seconds.

---

## 💡 Why JobGraph AI Stands Out

- 🧠 **Graph + Semantic Intelligence**  
  Not keyword search — jobs are ranked using a hybrid of **embeddings + graph-based affinity scoring**.

- 🤖 **Autonomous Application Agent**  
  Goes beyond autofill — navigates **multi-step, real-world** job applications.

- 🔁 **Handles Messy ATS Flows**  
  Works with dynamic forms, dropdowns, comboboxes, and multi-page applications.

- 🛡️ **Human-in-the-loop Safe Mode**  
  Fills everything — **never submits** without your review.

---

## 🧩 Problem

Applying to jobs is repetitive, time-consuming, and inefficient:

- Same data entered across dozens of portals  
- Weak matching when search is plain keywords  
- Almost no automation that survives **real** ATS flows (not toy forms)

---

## ✅ Solution

JobGraph AI:

- **Recommends** relevant roles using hybrid graph + semantic signals  
- **Automates** application workflows end-to-end (with review mode)  
- **Keeps you in control** — you review before anything is submitted  

---

## 🧠 Ranking Engine (Core ML System)

JobGraph AI uses a **hybrid ranking pipeline**:

- **Semantic Matching**  
  Resume ↔ job description similarity using embedding-style signals and text overlap.

- **Graph-based Affinity (GNN-inspired)**  
  A **candidate–job–skill** graph scored via a **GraphSAGE-style** encoder (`graphsage_affinity_scores` in the backend), fused with classical graph features.

- **Structured Signals**  
  Skill overlap, role/experience fit, location alignment, and explainable factor breakdowns in the UI.

👉 **Final score** = interpretable fusion of these signals — **not a black box**.

---

## 🤖 Autonomous Application Agent

The apply agent is **not** a simple autofill script — it behaves like a **decision-making system**:

1. Detects **visible, enabled** fields dynamically across frames  
2. Classifies behavior (**text / select / radio / combobox / multi-step navigation**)  
3. Maps answers from your **candidate profile + intake answers**, with **LLM classification** when rules aren’t enough  
4. Drives the browser with **Playwright** (first-class)  
5. Clicks safe **Next / Continue / Save and continue** across pages  
6. Repeats until the flow is complete — **stops before final Submit** in review mode  

✔ Works against **live** ATS surfaces (Greenhouse, Lever, Workday, Ashby-family patterns)  
✔ Dropdowns, checkboxes, custom selects, combobox-style controls  
✔ Optional **Stagehand** CDP attach for harder UI recovery paths  

---

## 📈 Impact

- ⚡ Cuts **manual application effort** from long form sessions to **guided, automated fills** (you still review)  
- 🎯 **Stronger relevance** vs keyword-only search via hybrid ranking  
- 🤖 **Multi-step applications** automated across major ATS-style flows  
- 🧠 Built as a **scalable agentic pipeline** (deterministic rules + LLM + browser automation), not a brittle single-page script  

---


```bash
pip install pillow   # if needed
python scripts/record_demo_gif.py --install-browser   # once: downloads Chromium
python scripts/record_demo_gif.py
```

_Or swap in your own screen capture — keep the path above so the README preview works on GitHub._

---

## Architecture (high level)

**AI Job Application Agent** — system flow from resume intake through ranked jobs to browser automation.

![Architecture diagram](./diagram_.png)

_Legend (diagram): green — AI / agent; blue — loop / state; gray — service._

---

## Repository layout

| Path | Role |
|------|------|
| `backend/` | FastAPI API: ingestion, matching, GraphSAGE-style scoring, autofill, apply-agent orchestration, SQLite/Postgres persistence. |
| `apps/web/` | Next.js UI (resume flow, job board, apply status). |
| `agents/` | TypeScript Playwright + optional Stagehand hybrid agent (compiled for Node CLI). |
| `apps/extension/` | Browser extension hooks for profile-aware assistance (optional). |

---

## Quick start

**Backend** (Python 3.10+ recommended):

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --port 8022
```

**Frontend**:

```bash
cd apps/web
npm install
npm run dev
```

Open the app (default **http://localhost:3020**). The home route redirects to **`/upload`**.

Point the UI at your API (optional):

```text
NEXT_PUBLIC_API_URL=http://127.0.0.1:8022
```

**Apply agent (Node)** — build once after backend changes to agent sources:

```bash
cd agents
npm install
npm run build
```

---

## Environment variables

**Do not commit `.env` or any file containing secrets.** They are listed in `.gitignore`. Keep `OPENAI_API_KEY` only on your machine or in your deployment secret store—it is optional for running the app (ranking and deterministic fills still work; LLM-assisted classification and parsing extras are skipped when unset).

Copy `.env.example` to `.env` at the repo root when present. Common keys:

```text
DATABASE_URL=sqlite:///./jobgraph.db
OPENAI_API_KEY=           # LLM field classification + optional Stagehand / enrichments
NEXT_PUBLIC_API_URL=http://127.0.0.1:8022
```

ATS board configuration examples:

```text
ASHBY_JOB_BOARDS=YourOrg
GREENHOUSE_BOARDS=company-a,company-b
LEVER_COMPANIES=company-c
WORKDAY_BOARDS=company|External|https://company.wd1.myworkdayjobs.com
```

For PostgreSQL:

```text
DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/jobgraph
```

---

## License

See repository license file if present; otherwise treat as private / all rights reserved unless stated.
