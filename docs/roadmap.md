# Roadmap

## Phase 1
- API-backed job ingestion from Adzuna and USAJOBS.
- Resume upload and skill extraction.
- Skill graph ranker and explanations.
- Application tracker and autofill profile.
- Chrome extension human-reviewed autofill.

## Phase 2
- SQLAlchemy persistence with SQLite locally and PostgreSQL through Docker Compose.
- Hybrid semantic job/resume retrieval with TF-IDF now, pgvector embeddings next.
- PyTorch Geometric heterogeneous GNN link prediction.
- LangGraph planner around the existing tool layer.
- MLflow experiment tracking.

## Phase 3
- Browser-extension ATS adapters for Greenhouse, Lever, Ashby, and Workday.
- Referral graph from user-provided contacts.
- Alerts, scheduled ingestion, and drift monitoring.
