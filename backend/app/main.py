from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, Dict, List, Tuple
from urllib.parse import urlparse

from fastapi import BackgroundTasks, FastAPI, File, UploadFile
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware

from backend.app.agents.copilot import run_copilot
from backend.app.apply_agent.browser import cancel_apply_run, continue_apply_run, create_apply_run, execute_apply_run
from backend.app.db.session import init_db
from backend.app.ingestion.clients import JobIngestionClient
from backend.app.ingestion.companies_catalog import catalog_meta, load_company_entries, load_merged_board_lists, resolve_catalog_path
from backend.app.ingestion.sources import ATS_SOURCES, scraper_jobs
from backend.app.matching.graph import build_graph_snapshot
from backend.app.matching.graphsage import graphsage_affinity_scores
from backend.app.matching.evaluation import evaluate_ranker
from backend.app.matching.ranker import rank_jobs
from backend.app.matching.pytorch_gnn import load_pytorch_graphsage_metadata
from backend.app.matching.trained_gnn import load_trained_ranker, train_graph_ranker
from backend.app.mlops.metrics import system_metrics
from backend.app.resume.parser import (
    extract_pdf_hyperlink_uris,
    extract_text_from_docx,
    extract_text_from_pdf,
    parse_resume_text,
)
from backend.app.schemas import (
    AgentRequest,
    ApplyAgentRunRequest,
    ApplicationEvent,
    AutofillProfile,
    CandidateProfile,
    IngestionRun,
    IntegrationSettings,
    RecommendationRun,
    ResumeRecommendationResponse,
    SearchRequest,
)
from backend.app.seed import seed
from backend.app.services import store

app = FastAPI(title="JobGraph AI", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
init_db()
seed()

_MATCH_CACHE: Dict[Tuple[str, int, int, int], List[Dict[str, Any]]] = {}


def _cache_key(candidate_id: str, k: int, jobs_count: int, events_count: int) -> Tuple[str, int, int, int]:
    return candidate_id, k, jobs_count, events_count


def _clear_match_cache(candidate_id: str = "") -> None:
    if not candidate_id:
        _MATCH_CACHE.clear()
        return
    for key in list(_MATCH_CACHE):
        if key[0] == candidate_id:
            _MATCH_CACHE.pop(key, None)


def _active_jobs_count(counts: Dict[str, Any]) -> int:
    by_source = counts.get("jobs_by_source") or {}
    return sum(int(by_source.get(source, 0) or 0) for source in ATS_SOURCES)


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
        "application_summary": "GET /applications/{candidate_id}/summary",
        "application_history": "GET /applications/{candidate_id}/jobs/{job_id}/history",
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
        _clear_match_cache()
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


@app.get("/recommendations/{candidate_id}/runs")
def recommendation_runs(candidate_id: str = "default", limit: int = 10) -> List[Dict[str, Any]]:
    return [run.model_dump() for run in store.list_recommendation_runs(candidate_id, limit=limit)]


@app.get("/jobs/scraper-status")
def scraper_status() -> Dict[str, Any]:
    from backend.app.core.config import get_settings

    settings = get_settings()
    boards = load_merged_board_lists(settings)
    runs = store.list_ingestion_runs(limit=1)
    last_refresh = runs[0].finished_at.isoformat() if runs and runs[0].finished_at else None
    return {
        "sources": ["ashby", "greenhouse", "lever", "workday"],
        "companies_catalog": catalog_meta(settings),
        "configured_ats": boards,
        "last_ingestion_finished_at": last_refresh,
    }


@app.get("/settings/ats-sources")
def ats_sources_registry() -> Dict[str, Any]:
    path = resolve_catalog_path()
    entries = load_company_entries(path)
    by_ats: Dict[str, List[Dict[str, Any]]] = {"ashby": [], "greenhouse": [], "lever": [], "workday": []}
    for entry in entries:
        bucket = by_ats.get(entry.ats)
        if bucket is None:
            continue
        row: Dict[str, Any] = {"company": entry.company}
        if entry.board:
            row["board"] = entry.board
        if entry.url:
            row["url"] = entry.url
        bucket.append(row)
    runs = store.list_ingestion_runs(limit=1)
    last = runs[0].finished_at.isoformat() if runs and runs[0].finished_at else None
    return {
        "catalog_path": str(path),
        "last_refresh": last,
        "counts": {k: len(v) for k, v in by_ats.items()},
        "by_ats": by_ats,
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
def list_jobs() -> List[Dict[str, Any]]:
    jobs = scraper_jobs(store.list_jobs())
    return [job.model_dump() for job in jobs]


@app.delete("/jobs/legacy")
def delete_legacy_jobs() -> Dict[str, Any]:
    deleted = store.delete_jobs_not_in_sources(sorted(ATS_SOURCES))
    return {"deleted": deleted, "allowed_sources": sorted(ATS_SOURCES)}


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> Dict[str, Any]:
    return store.get_job(job_id).model_dump()


@app.post("/resume/upload")
async def upload_resume(candidate_id: str = "default", file: UploadFile = File(...)) -> Dict[str, Any]:
    profile = await _profile_from_upload(file, candidate_id)
    store.save_candidate(profile)
    _clear_match_cache(candidate_id)
    return profile.model_dump()


@app.post("/recommendations/resume")
async def recommend_from_resume(
    candidate_id: str = "default",
    k: int = 25,
    ingest: bool = False,
    query: str = "",
    location: str = "",
    file: UploadFile = File(...),
) -> Dict[str, Any]:
    profile = await _profile_from_upload(file, candidate_id)
    store.save_candidate(profile)
    _clear_match_cache(candidate_id)
    search_query, search_location = _search_plan(profile, query=query, location=location)
    ingestion = _ingest_for_profile(profile, query=search_query, location=search_location, k=k) if ingest else {"requested": False}
    jobs = scraper_jobs(store.list_jobs())
    events = store.list_applications(candidate_id)
    matches = rank_jobs(profile, jobs, k=k, application_events=events)
    _MATCH_CACHE[_cache_key(candidate_id, k, len(jobs), len(events))] = [match.model_dump() for match in matches]
    diagnostic_pool = [match.job for match in matches] or jobs[: min(len(jobs), 120)]
    _scores, diagnostics = graphsage_affinity_scores(profile, diagnostic_pool)
    model_source = matches[0].model_source if matches else "hybrid_skill_semantic_graphsage_ranker_v3"
    parsed_resume = _parsed_resume_summary(profile, search_query, search_location)
    gnn_diagnostics = {
        **diagnostics.__dict__,
        "candidate_nodes": len(profile.skills) + len(profile.target_roles) + len(profile.location_preferences),
        "job_pool_size": len(jobs),
    }
    run = store.save_recommendation_run(
        RecommendationRun(
            candidate_id=candidate_id,
            query=search_query,
            location=search_location,
            model_source=model_source,
            model_version=gnn_diagnostics["model"],
            job_pool_size=len(jobs),
            match_job_ids=[match.job.job_id for match in matches],
            parsed_resume=parsed_resume,
            diagnostics=gnn_diagnostics,
        )
    )
    store.save_recommendations(candidate_id, matches, run_id=run.id)
    response = ResumeRecommendationResponse(
        candidate_id=candidate_id,
        candidate=profile,
        matches=matches,
        gnn_diagnostics=gnn_diagnostics,
        ingestion=ingestion,
        recommendation_run=run.model_dump(),
        parsed_resume=parsed_resume,
    )
    return response.model_dump()


async def _profile_from_upload(file: UploadFile, candidate_id: str) -> CandidateProfile:
    raw = await file.read()
    suffix = Path(file.filename or "resume.pdf").suffix.lower()
    if suffix not in {".pdf", ".docx", ".txt", ".md"}:
        suffix = ".pdf"
    resume_dir = resolve_catalog_path().parent / "data" / "resumes"
    resume_dir.mkdir(parents=True, exist_ok=True)
    saved = resume_dir / f"{candidate_id}_resume{suffix}"
    saved.write_bytes(raw)

    with NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(raw)
        tmp_path = Path(tmp.name)
    try:
        try:
            if suffix == ".pdf":
                text = extract_text_from_pdf(tmp_path)
            elif suffix == ".docx":
                text = extract_text_from_docx(tmp_path)
            else:
                text = tmp_path.read_text(encoding="utf-8", errors="ignore")
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Resume parsing failed: {exc}") from exc
        pdf_uri_hints = ""
        if suffix == ".pdf":
            pdf_uri_hints = "\n".join(extract_pdf_hyperlink_uris(saved))
        blob = text if not pdf_uri_hints else f"{text}\n{pdf_uri_hints}"
        profile = parse_resume_text(blob, candidate_id=candidate_id)
        store.save_resume_record(candidate_id, str(saved.resolve()), text[:2000], profile.model_dump())
    finally:
        tmp_path.unlink(missing_ok=True)

    autofill = store.get_autofill(candidate_id)
    autofill.legal_name = autofill.legal_name or profile.name
    autofill.email = autofill.email or profile.email
    autofill.phone = autofill.phone or profile.phone
    autofill.linkedin = autofill.linkedin or profile.links.get("linkedin", "")
    autofill.github = autofill.github or profile.links.get("github", "")
    autofill.portfolio = autofill.portfolio or profile.links.get("portfolio", "")
    ca = dict(autofill.custom_answers or {})
    if profile.summary and len(profile.summary.strip()) > 40:
        ca.setdefault("resume summary", profile.summary.strip()[:12000])
    autofill.custom_answers = ca
    autofill.education = {**_education_autofill(profile), **(autofill.education or {})}
    autofill.candidate_resume_path = str(saved.resolve())
    store.save_autofill(autofill)
    return profile


def _education_autofill(profile: CandidateProfile) -> Dict[str, str]:
    if not profile.education:
        return {}
    first = profile.education[0] or {}
    return {
        key: str(first.get(source) or "").strip()
        for key, source in {
            "school": "school",
            "degree": "degree",
            "major": "field",
            "start": "start",
            "end": "end",
        }.items()
        if str(first.get(source) or "").strip()
    }


def _ingest_for_profile(profile: CandidateProfile, query: str = "", location: str = "", k: int = 25) -> Dict[str, Any]:
    search_query, search_location = _search_plan(profile, query=query, location=location)
    request = SearchRequest(query=search_query, location=search_location, results_per_page=max(k, 10))
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
        return {"requested": True, "status": "success", "jobs_ingested": len(jobs), "run": run.model_dump()}
    except Exception as exc:
        run.status = "failed"
        run.error = str(exc)
        run.finished_at = datetime.utcnow()
        store.save_ingestion_run(run)
        return {"requested": True, "status": "failed", "error": str(exc), "run": run.model_dump()}


def _search_plan(profile: CandidateProfile, query: str = "", location: str = "") -> Tuple[str, str]:
    search_query = query or (profile.target_roles[0] if profile.target_roles else "")
    if not search_query and profile.skills:
        search_query = f"{profile.skills[0]} engineer"
    search_location = location or (profile.location_preferences[0] if profile.location_preferences else "United States")
    return search_query or "software engineer", search_location


def _parsed_resume_summary(profile: CandidateProfile, query: str, location: str) -> Dict[str, Any]:
    return {
        "name": profile.name,
        "email": profile.email,
        "skills": profile.skills[:18],
        "projects": profile.projects[:5],
        "experience": profile.experience[:3],
        "education": profile.education[:2],
        "target_roles": profile.target_roles[:8],
        "location_preferences": profile.location_preferences[:8],
        "experience_years": profile.experience_years,
        "inferred_search_query": query,
        "inferred_search_location": location,
    }


@app.post("/candidate")
def save_candidate(profile: CandidateProfile) -> Dict[str, Any]:
    saved = store.save_candidate(profile)
    _clear_match_cache(profile.candidate_id)
    return saved.model_dump()


@app.get("/candidate/{candidate_id}")
def get_candidate(candidate_id: str = "default") -> Dict[str, Any]:
    return store.get_candidate(candidate_id).model_dump()


@app.get("/matches/{candidate_id}")
def get_matches(candidate_id: str = "default", k: int = 25) -> Dict[str, Any]:
    counts = store.metrics_counts()
    events = store.list_applications(candidate_id)
    key = _cache_key(candidate_id, k, _active_jobs_count(counts), len(events))
    cached = _MATCH_CACHE.get(key)
    if cached is not None:
        return {"candidate_id": candidate_id, "matches": cached, "cached": True}
    candidate = store.get_candidate(candidate_id)
    jobs = scraper_jobs(store.list_jobs())
    matches = rank_jobs(candidate, jobs, k=k, application_events=events)
    _MATCH_CACHE[key] = [match.model_dump() for match in matches]
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
        "trained_model": load_trained_ranker().__dict__ if load_trained_ranker() else None,
        "pytorch_graphsage_model": load_pytorch_graphsage_metadata(),
        "scores": [{"job_id": job.job_id, "title": job.title, "source": job.source, "gnn_score": round(score * 100, 2)} for job, score in ranked],
    }


@app.post("/gnn/{candidate_id}/train")
def train_gnn(candidate_id: str = "default") -> Dict[str, Any]:
    candidate = store.get_candidate(candidate_id)
    jobs = scraper_jobs(store.list_jobs())
    events = store.list_applications(candidate_id)
    return train_graph_ranker(candidate, jobs, events)


@app.get("/gnn/{candidate_id}/evaluate")
def evaluate_gnn(candidate_id: str = "default", k: int = 10) -> Dict[str, Any]:
    candidate = store.get_candidate(candidate_id)
    jobs = scraper_jobs(store.list_jobs())
    events = store.list_applications(candidate_id)
    return evaluate_ranker(candidate, jobs, events, k=k)


@app.post("/agent")
def agent(request: AgentRequest) -> Dict[str, Any]:
    return run_copilot(request.candidate_id, request.message)


@app.post("/apply-agent/runs")
def start_apply_agent_run(request: ApplyAgentRunRequest, background_tasks: BackgroundTasks) -> Dict[str, Any]:
    run = create_apply_run(request.candidate_id, request.job_id, headless=request.headless)
    if run.id is not None and run.status == "starting":
        background_tasks.add_task(execute_apply_run, run.id)
    return run.model_dump()


@app.get("/apply-agent/runs/{run_id}")
def get_apply_agent_run(run_id: int) -> Dict[str, Any]:
    return store.get_apply_agent_run(run_id).model_dump()


@app.get("/apply-agent/runs/{run_id}/steps")
def get_apply_agent_steps(run_id: int) -> List[Dict[str, Any]]:
    return [step.model_dump() for step in store.list_agent_steps(run_id)]


@app.post("/apply-agent/runs/{run_id}/continue")
def continue_apply_agent_run(run_id: int) -> Dict[str, Any]:
    return continue_apply_run(run_id).model_dump()


@app.post("/apply-agent/runs/{run_id}/cancel")
def cancel_apply_agent_run(run_id: int) -> Dict[str, Any]:
    return cancel_apply_run(run_id).model_dump()


@app.post("/applications")
def track_application(event: ApplicationEvent) -> Dict[str, Any]:
    saved = store.save_application(event)
    _clear_match_cache(saved.candidate_id)
    candidate = store.get_candidate(saved.candidate_id)
    jobs = scraper_jobs(store.list_jobs())
    events = store.list_applications(saved.candidate_id)
    training = train_graph_ranker(candidate, jobs, events)
    evaluation = evaluate_ranker(candidate, jobs, events, k=10)
    return {"stored": True, "event": saved.model_dump(), "training": training, "evaluation": evaluation}


@app.get("/applications/{candidate_id}")
def applications(candidate_id: str) -> List[Dict[str, Any]]:
    return [event.model_dump() for event in store.list_applications(candidate_id)]


@app.get("/applications/{candidate_id}/summary")
def application_summaries(candidate_id: str) -> List[Dict[str, Any]]:
    return [row.model_dump() for row in store.list_application_summaries(candidate_id)]


@app.get("/applications/{candidate_id}/jobs/{job_id}/history")
def application_job_history(candidate_id: str, job_id: str) -> List[Dict[str, Any]]:
    return [event.model_dump() for event in store.list_application_history(candidate_id, job_id)]


@app.put("/autofill/{candidate_id}")
def save_autofill(candidate_id: str, profile: AutofillProfile) -> Dict[str, Any]:
    profile.candidate_id = candidate_id
    return store.save_autofill(profile).model_dump()


@app.get("/autofill/{candidate_id}")
def get_autofill(candidate_id: str) -> Dict[str, Any]:
    return store.get_autofill(candidate_id).model_dump()


@app.get("/apply-session/{candidate_id}/active")
def active_apply_session(candidate_id: str = "default", url: str = "") -> Dict[str, Any]:
    session = store.latest_apply_session(candidate_id)
    if not session:
        return {"active": False}
    if session.expires_at and session.expires_at < datetime.utcnow():
        store.update_apply_session_status(session.id or 0, "expired")
        return {"active": False}
    if url and not _urls_match(session.apply_url, url) and session.created_at < datetime.utcnow() - timedelta(minutes=3):
        return {"active": False}
    return {"active": True, "session": session.model_dump()}


@app.post("/apply-session/{session_id}/filled")
def mark_apply_session_filled(session_id: int) -> Dict[str, Any]:
    return store.update_apply_session_status(session_id, "filled").model_dump()


def _urls_match(expected: str, actual: str) -> bool:
    if not expected:
        return True
    expected_host = _strip_www(urlparse(expected).netloc.lower())
    actual_host = _strip_www(urlparse(actual).netloc.lower())
    if expected_host and actual_host and expected_host == actual_host:
        return True
    return actual.startswith(expected) or expected.startswith(actual)


def _strip_www(host: str) -> str:
    return host[4:] if host.startswith("www.") else host


@app.get("/mlops/metrics")
def mlops_metrics() -> Dict[str, Any]:
    return system_metrics()
