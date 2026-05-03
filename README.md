# JobGraph AI

Agentic job-search copilot inspired by Jobright-style workflows, built as an industry-level MLE/AI portfolio project.

## Product Scope

JobGraph AI ingests real-time jobs, parses a candidate resume, builds a candidate-job-skill graph, ranks jobs with ML/GNN-ready features, explains fit, tailors application materials, tracks applications, and prepares human-reviewed browser autofill.

## Core Capabilities

- ApplyPilot-style job discovery from JobSpy job boards plus public ATS/company portals.
- Dashboard controls for saving local API credentials, selecting job sources, running ingestion, and reviewing ingestion history.
- Resume PDF/text parsing into a structured candidate profile.
- Skill extraction and normalized job schema.
- Candidate-job-skill graph construction.
- Hybrid match score using skill graph overlap, semantic resume/job similarity, role intent, location fit, missing skills, and explainability.
- Agentic copilot tools for search, compare, resume tailoring, cover letters, outreach, and tracker updates.
- Human-in-the-loop Chrome extension autofill profile.
- MLOps endpoints for ingestion, ranking, latency, and feedback metrics.
- Persistent storage for jobs, candidates, applications, and autofill profiles using SQLAlchemy.
- Next.js command-center dashboard for ranked jobs, job details, copilot output, tracker events, and autofill instructions.

## Quick Start

```bash
cd "C:/Users/mannv/OneDrive/Desktop/Projects/job-graph ai"
python -m venv .venv
.venv\Scripts\activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --port 8022
```

Use Python 3.10+ for the full scraper pipeline. `python-jobspy` does not install on Python 3.8.

Optional web app:

```bash
cd apps/web
npm install
npm run dev
```

## Environment Variables

Create `.env` from `.env.example`.

```text
ADZUNA_APP_ID=
ADZUNA_APP_KEY=
USAJOBS_USER_AGENT=your_email@example.com
USAJOBS_API_KEY=
JSEARCH_API_KEY=
OPENAI_API_KEY=
JOBSPY_SITES=indeed,linkedin,zip_recruiter,google
JOBSPY_HOURS_OLD=168
JOBSPY_COUNTRY=USA
ASHBY_JOB_BOARDS=Ashby
GREENHOUSE_BOARDS=
LEVER_COMPANIES=
WORKDAY_BOARDS=
DATABASE_URL=sqlite:///./jobgraph.db
```

The resume-first web flow no longer uses Adzuna or USAJOBS by default. It calls `jobspy`, `ashby`, `greenhouse`, `lever`, and `workday`.

ATS configuration examples:

```text
ASHBY_JOB_BOARDS=Ashby,OpenAI
GREENHOUSE_BOARDS=airbnb,stripe
LEVER_COMPANIES=netflix,figma
WORKDAY_BOARDS=company|External|https://company.wd1.myworkdayjobs.com
```

Demo jobs are now explicit-only via `sources=["demo"]`; failed live searches do not silently become fake jobs.

For PostgreSQL, set:

```text
DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/jobgraph
```
