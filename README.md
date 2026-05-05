# JobGraph AI

**JobGraph AI** is a full-stack job intelligence platform: it ingests real ATS listings, parses resumes into structured profiles, **ranks roles with a hybrid graph + neural scoring stack**, and ships a **human-in-the-loop apply agent** that automates form filling in the browser while never submitting on your behalf.

> Built to present as a serious **ML + agentic systems** product—suitable for recruiter-facing walkthroughs and technical deep-dives alike.

---

## What ships

| Layer | What we ship |
|--------|----------------|
| **Data** | Live feeds from public ATS catalogues (Greenhouse, Lever, Workday, Ashby) with normalized job + company records. |
| **Graph + GNN signal** | We materialize a **bipartite candidate–job–skill graph** and score affinity with a **GraphSAGE-style** encoder (implemented as `graphsage_affinity_scores` in the backend)—combined with classical overlap features so rankings stay interpretable, not a black box. |
| **Hybrid ranker** | **Semantic similarity** (resume ↔ JD), **skill overlap**, **location / experience fit**, and graph-derived signals are fused into a single explainable score with per-factor breakdowns in the UI. |
| **Apply agent** | A **multi-step Playwright** pipeline that discovers visible controls, applies deterministic + LLM-classified answers from your profile, handles selects/comboboxes, and optionally invokes **Stagehand** over CDP for brittle UI recoveries—**review mode** fills forms but **never clicks final Submit**. |
| **UX** | Next.js workspace: resume intake → ranked board → job detail → **Apply with Agent** with live step telemetry. |

---

## Architecture (high level)

```mermaid
flowchart TB
  subgraph ingest [Ingestion and storage]
    ATS[ATS connectors]
    DB[(SQLite / Postgres)]
    ATS --> DB
  end

  subgraph profile [Candidate understanding]
    R[Resume upload]
    P[Parser + skill extraction]
    R --> P
    P --> C[Candidate profile]
  end

  subgraph rank [Hybrid ranking]
    G[Skill / role graph features]
    N[Graph neural affinity]
    S[Semantic resume ↔ job]
    H[Fusion + explainability]
    DB --> G
    C --> G
    G --> N
    C --> S
    DB --> S
    N --> H
    S --> H
  end

  subgraph ui [Web app]
    FE[Next.js workspace]
    H --> FE
  end

  subgraph agent [Apply agent]
    PW[Playwright multi-step loop]
    LLM[Field classifier optional]
    SH[Stagehand CDP fallback]
    FE --> PW
    PW --> LLM
    PW --> SH
  end
```

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

**Do not commit `.env` or any file containing secrets.** They are listed in `.gitignore`. Keep `OPENAI_API_KEY` only on your machine or in your deployment secret store—it is optional for running the app (ranking and forms still work with deterministic rules; LLM-assisted classification and parsing extras are skipped when unset).

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


