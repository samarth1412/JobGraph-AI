from __future__ import annotations

from typing import List, Optional

from backend.app.db import repository
from backend.app.db.session import session_scope
from backend.app.schemas import (
    AgentStep,
    ApplicationEvent,
    ApplicationJobSummary,
    ApplyAgentRun,
    ApplySession,
    AutofillProfile,
    CandidateProfile,
    IngestionRun,
    IntegrationSettings,
    IntegrationStatus,
    Job,
    MatchResult,
    RecommendationRun,
)


def upsert_jobs(jobs: List[Job]) -> List[Job]:
    with session_scope() as session:
        return repository.save_jobs(session, jobs)


def list_jobs() -> List[Job]:
    with session_scope() as session:
        return repository.list_jobs(session)


def delete_jobs_by_sources(sources: List[str]) -> int:
    with session_scope() as session:
        return repository.delete_jobs_by_sources(session, sources)


def delete_jobs_not_in_sources(allowed_sources: List[str]) -> int:
    with session_scope() as session:
        return repository.delete_jobs_not_in_sources(session, allowed_sources)


def get_job(job_id: str) -> Job:
    with session_scope() as session:
        return repository.get_job(session, job_id)


def save_candidate(profile: CandidateProfile) -> CandidateProfile:
    with session_scope() as session:
        return repository.save_candidate(session, profile)


def save_resume_record(candidate_id: str, file_path: str, parsed_text_preview: str, parsed_profile: dict) -> None:
    with session_scope() as session:
        repository.save_resume_record(session, candidate_id, file_path, parsed_text_preview, parsed_profile)


def latest_resume_path(candidate_id: str) -> str:
    with session_scope() as session:
        return repository.latest_resume_path(session, candidate_id)


def get_candidate(candidate_id: str = "default") -> CandidateProfile:
    with session_scope() as session:
        return repository.get_candidate(session, candidate_id)


def save_application(event: ApplicationEvent) -> ApplicationEvent:
    with session_scope() as session:
        return repository.save_application(session, event)


def list_applications(candidate_id: str) -> List[ApplicationEvent]:
    with session_scope() as session:
        return repository.list_applications(session, candidate_id)


def list_application_summaries(candidate_id: str) -> List[ApplicationJobSummary]:
    with session_scope() as session:
        summaries = repository.list_application_summaries(session, candidate_id)
        enriched: List[ApplicationJobSummary] = []
        for item in summaries:
            title, company = "", ""
            try:
                job = repository.get_job(session, item.job_id)
                title, company = job.title, job.company
            except KeyError:
                pass
            enriched.append(item.model_copy(update={"job_title": title, "company": company}))
        return enriched


def list_application_history(candidate_id: str, job_id: str) -> List[ApplicationEvent]:
    with session_scope() as session:
        return repository.list_application_history_for_job(session, candidate_id, job_id)


def save_autofill(profile: AutofillProfile) -> AutofillProfile:
    with session_scope() as session:
        return repository.save_autofill(session, profile)


def get_autofill(candidate_id: str) -> AutofillProfile:
    with session_scope() as session:
        return repository.get_autofill(session, candidate_id)


def save_apply_session(apply_session: ApplySession) -> ApplySession:
    with session_scope() as session:
        return repository.save_apply_session(session, apply_session)


def latest_apply_session(candidate_id: str) -> Optional[ApplySession]:
    with session_scope() as session:
        return repository.latest_apply_session(session, candidate_id)


def update_apply_session_status(session_id: int, status: str) -> ApplySession:
    with session_scope() as session:
        return repository.update_apply_session_status(session, session_id, status)


def save_apply_agent_run(run: ApplyAgentRun) -> ApplyAgentRun:
    with session_scope() as session:
        return repository.save_apply_agent_run(session, run)


def get_apply_agent_run(run_id: int) -> ApplyAgentRun:
    with session_scope() as session:
        return repository.get_apply_agent_run(session, run_id)


def list_apply_agent_runs(candidate_id: str, limit: int = 10) -> List[ApplyAgentRun]:
    with session_scope() as session:
        return repository.list_apply_agent_runs(session, candidate_id, limit=limit)


def save_agent_step(step: AgentStep) -> AgentStep:
    with session_scope() as session:
        return repository.save_agent_step(session, step)


def list_agent_steps(run_id: int) -> List[AgentStep]:
    with session_scope() as session:
        return repository.list_agent_steps(session, run_id)


def metrics_counts() -> dict:
    with session_scope() as session:
        return repository.counts(session)


def save_integration_settings(settings: IntegrationSettings) -> IntegrationStatus:
    with session_scope() as session:
        return repository.save_integration_settings(session, settings)


def get_integration_settings() -> IntegrationSettings:
    with session_scope() as session:
        return repository.get_integration_settings(session)


def get_integration_status() -> IntegrationStatus:
    with session_scope() as session:
        return repository.get_integration_status(session)


def save_ingestion_run(run: IngestionRun) -> IngestionRun:
    with session_scope() as session:
        return repository.save_ingestion_run(session, run)


def list_ingestion_runs(limit: int = 10) -> List[IngestionRun]:
    with session_scope() as session:
        return repository.list_ingestion_runs(session, limit=limit)


def save_recommendation_run(run: RecommendationRun) -> RecommendationRun:
    with session_scope() as session:
        return repository.save_recommendation_run(session, run)


def save_recommendations(candidate_id: str, matches: List[MatchResult], run_id: int | None = None) -> None:
    with session_scope() as session:
        repository.save_recommendations(session, candidate_id, matches, run_id=run_id)


def list_recommendation_runs(candidate_id: str, limit: int = 10) -> List[RecommendationRun]:
    with session_scope() as session:
        return repository.list_recommendation_runs(session, candidate_id, limit=limit)
