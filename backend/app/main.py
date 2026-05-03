from __future__ import annotations

from datetime import datetime
import importlib.util
from pathlib import Path
import sys
from tempfile import NamedTemporaryFile
from typing import Any, Dict, List

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from backend.app.agents.copilot import run_copilot
from backend.app.db.session import init_db
from backend.app.ingestion.clients import JobIngestionClient
from backend.app.ingestion.sources import LEGACY_SOURCES, scraper_jobs
from backend.app.matching.graph import build_graph_snapshot
from backend.app.matching.graphsage import graphsage_affinity_scores
from backend.app.matching.ranker import rank_jobs
from backend.app.mlops.metrics import system_metrics
from backend.app.resume.parser import extract_text_from_pdf, parse_resume_text
from backend.app.schemas import (
    AgentRequest,
    ApplicationEvent,
    AutofillProfile,
    CandidateProfile,
    IngestionRun,
    IntegrationSettings,
    SearchRequest,
)
from backend.app.seed import seed
from backend.app.services import store

app = FastAPI(title="JobGraph AI", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
init_db()
seed()


@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "app": "JobGraph AI",
        "status": "ok",
        "web_app": "http://127.0.0.1:3020",
        "docs": "/docs",
        "health": "/health",
        "matches": "/matches/default?k=10",
        "ingest": "POST /jobs/ingest",
    }


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/jobs/ingest")
def ingest_jobs(request: SearchRequest) -> Dict[str, Any]:
    run = store.save_ingestion_run(
        IngestionRun(query=request.query, location=request.location, sources=request.sources, status="running")
    )
    try:
        jobs = JobIngestionClient(store.get_integration_settings()).search(request)
        store.upsert_jobs(jobs)
        run.jobs_found = len(jobs)
        run.jobs_saved = len(jobs)
        run.status = "success"
        run.finished_at = datetime.utcnow()
        store.save_ingestion_run(run)
        return {"ingested": len(jobs), "run": run.model_dump(), "jobs": [job.model_dump() for job in jobs]}
    except Exception as exc:
        run.status = "failed"
        run.error = str(exc)
        run.finished_at = datetime.utcnow()
        store.save_ingestion_run(run)
        raise


@app.get("/jobs/ingestion-runs")
def ingestion_runs(limit: int = 10) -> List[Dict[str, Any]]:
    return [run.model_dump() for run in store.list_ingestion_runs(limit=limit)]


@app.get("/jobs/scraper-status")
def scraper_status() -> Dict[str, Any]:
    from backend.app.core.config import get_settings

    settings = get_settings()
    return {
        "jobspy_available": importlib.util.find_spec("jobspy") is not None,
        "python_version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        "jobspy_requires": "Python 3.10+",
        "sources": ["jobspy", "ashby", "greenhouse", "lever", "workday"],
        "configured_ats": {
            "ashby": [board.strip() for board in settings.ashby_job_boards.split(",") if board.strip()],
            "greenhouse": [board.strip() for board in settings.greenhouse_boards.split(",") if board.strip()],
            "lever": [company.strip() for company in settings.lever_companies.split(",") if company.strip()],
            "workday": [board.strip() for board in settings.workday_boards.split(",") if board.strip()],
        },
    }


@app.get("/settings/integrations")
def integration_status() -> Dict[str, Any]:
    return store.get_integration_status().model_dump()


@app.put("/settings/integrations")
def save_integration_settings(settings: IntegrationSettings) -> Dict[str, Any]:
    return store.save_integration_settings(settings).model_dump()


@app.delete("/settings/integrations")
def clear_integration_settings() -> Dict[str, Any]:
    return store.save_integration_settings(IntegrationSettings()).model_dump()


@app.get("/jobs")
def list_jobs(include_legacy: bool = False) -> List[Dict[str, Any]]:
    jobs = store.list_jobs()
    if not include_legacy:
        jobs = scraper_jobs(jobs)
    return [job.model_dump() for job in jobs]


@app.delete("/jobs/legacy")
def delete_legacy_jobs() -> Dict[str, Any]:
    deleted = store.delete_jobs_by_sources(sorted(LEGACY_SOURCES))
    return {"deleted": deleted, "sources": sorted(LEGACY_SOURCES)}


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> Dict[str, Any]:
    return store.get_job(job_id).model_dump()


@app.post("/resume/upload")
async def upload_resume(candidate_id: str = "default", file: UploadFile = File(...)) -> Dict[str, Any]:
    suffix = Path(file.filename or "resume.pdf").suffix
    with NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)
    text = extract_text_from_pdf(tmp_path) if suffix.lower() == ".pdf" else tmp_path.read_text(encoding="utf-8", errors="ignore")
    profile = parse_resume_text(text, candidate_id=candidate_id)
    store.save_candidate(profile)
    return profile.model_dump()


@app.post("/candidate")
def save_candidate(profile: CandidateProfile) -> Dict[str, Any]:
    return store.save_candidate(profile).model_dump()


@app.get("/candidate/{candidate_id}")
def get_candidate(candidate_id: str = "default") -> Dict[str, Any]:
    return store.get_candidate(candidate_id).model_dump()


@app.get("/matches/{candidate_id}")
def get_matches(candidate_id: str = "default", k: int = 25) -> Dict[str, Any]:
    candidate = store.get_candidate(candidate_id)
    jobs = scraper_jobs(store.list_jobs())
    matches = rank_jobs(candidate, jobs, k=k)
    return {"candidate_id": candidate_id, "matches": [match.model_dump() for match in matches]}


@app.get("/graph/{candidate_id}")
def graph_snapshot(candidate_id: str = "default") -> Dict[str, Any]:
    candidate = store.get_candidate(candidate_id)
    return build_graph_snapshot(candidate, scraper_jobs(store.list_jobs()))


@app.get("/gnn/{candidate_id}")
def gnn_snapshot(candidate_id: str = "default", k: int = 10) -> Dict[str, Any]:
    candidate = store.get_candidate(candidate_id)
    jobs = scraper_jobs(store.list_jobs())
    scores, diagnostics = graphsage_affinity_scores(candidate, jobs)
    ranked = sorted(zip(jobs, scores), key=lambda item: item[1], reverse=True)[:k]
    return {
        "candidate_id": candidate_id,
        "diagnostics": diagnostics.__dict__,
        "scores": [{"job_id": job.job_id, "title": job.title, "source": job.source, "gnn_score": round(score * 100, 2)} for job, score in ranked],
    }


@app.post("/agent")
def agent(request: AgentRequest) -> Dict[str, Any]:
    return run_copilot(request.candidate_id, request.message)


@app.post("/applications")
def track_application(event: ApplicationEvent) -> Dict[str, Any]:
    store.save_application(event)
    return {"stored": True, "event": event.model_dump()}


@app.get("/applications/{candidate_id}")
def applications(candidate_id: str) -> List[Dict[str, Any]]:
    return [event.model_dump() for event in store.list_applications(candidate_id)]


@app.put("/autofill/{candidate_id}")
def save_autofill(candidate_id: str, profile: AutofillProfile) -> Dict[str, Any]:
    profile.candidate_id = candidate_id
    return store.save_autofill(profile).model_dump()


@app.get("/autofill/{candidate_id}")
def get_autofill(candidate_id: str) -> Dict[str, Any]:
    return store.get_autofill(candidate_id).model_dump()


@app.get("/mlops/metrics")
def mlops_metrics() -> Dict[str, Any]:
    return system_metrics()
