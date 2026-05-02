from __future__ import annotations

from typing import List

from backend.app.db import repository
from backend.app.db.session import session_scope
from backend.app.schemas import ApplicationEvent, AutofillProfile, CandidateProfile, Job


def upsert_jobs(jobs: List[Job]) -> List[Job]:
    with session_scope() as session:
        return repository.save_jobs(session, jobs)


def list_jobs() -> List[Job]:
    with session_scope() as session:
        return repository.list_jobs(session)


def get_job(job_id: str) -> Job:
    with session_scope() as session:
        return repository.get_job(session, job_id)


def save_candidate(profile: CandidateProfile) -> CandidateProfile:
    with session_scope() as session:
        return repository.save_candidate(session, profile)


def get_candidate(candidate_id: str = "default") -> CandidateProfile:
    with session_scope() as session:
        return repository.get_candidate(session, candidate_id)


def save_application(event: ApplicationEvent) -> ApplicationEvent:
    with session_scope() as session:
        return repository.save_application(session, event)


def list_applications(candidate_id: str) -> List[ApplicationEvent]:
    with session_scope() as session:
        return repository.list_applications(session, candidate_id)


def save_autofill(profile: AutofillProfile) -> AutofillProfile:
    with session_scope() as session:
        return repository.save_autofill(session, profile)


def get_autofill(candidate_id: str) -> AutofillProfile:
    with session_scope() as session:
        return repository.get_autofill(session, candidate_id)


def metrics_counts() -> dict:
    with session_scope() as session:
        return repository.counts(session)
