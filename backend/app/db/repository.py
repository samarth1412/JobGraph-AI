from __future__ import annotations

from typing import List

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.db.models import (
    ApplicationRecord,
    AutofillRecord,
    CandidateRecord,
    IngestionRunRecord,
    IntegrationSettingsRecord,
    JobRecord,
)
from backend.app.schemas import (
    ApplicationEvent,
    AutofillProfile,
    CandidateProfile,
    IngestionRun,
    IntegrationSettings,
    IntegrationStatus,
    Job,
)


def job_to_record(job: Job) -> JobRecord:
    return JobRecord(**job.model_dump())


def record_to_job(record: JobRecord) -> Job:
    return Job(
        job_id=record.job_id,
        source=record.source,
        title=record.title,
        company=record.company,
        location=record.location,
        work_model=record.work_model,
        description=record.description,
        apply_url=record.apply_url,
        posted_at=record.posted_at,
        salary_min=record.salary_min,
        salary_max=record.salary_max,
        required_skills=list(record.required_skills or []),
        raw=dict(record.raw or {}),
    )


def candidate_to_record(profile: CandidateProfile) -> CandidateRecord:
    return CandidateRecord(**profile.model_dump())


def record_to_candidate(record: CandidateRecord) -> CandidateProfile:
    return CandidateProfile(
        candidate_id=record.candidate_id,
        name=record.name,
        email=record.email,
        phone=record.phone,
        location_preferences=list(record.location_preferences or []),
        target_roles=list(record.target_roles or []),
        skills=list(record.skills or []),
        projects=list(record.projects or []),
        experience_years=record.experience_years,
        links=dict(record.links or {}),
    )


def autofill_from_candidate(profile: CandidateProfile) -> AutofillProfile:
    return AutofillProfile(
        candidate_id=profile.candidate_id,
        legal_name=profile.name,
        email=profile.email,
        phone=profile.phone,
        linkedin=profile.links.get("linkedin", ""),
        github=profile.links.get("github", ""),
        portfolio=profile.links.get("portfolio", ""),
    )


def record_to_autofill(record: AutofillRecord) -> AutofillProfile:
    return AutofillProfile(
        candidate_id=record.candidate_id,
        legal_name=record.legal_name,
        email=record.email,
        phone=record.phone,
        linkedin=record.linkedin,
        github=record.github,
        portfolio=record.portfolio,
        work_authorization=record.work_authorization,
        sponsorship_required=record.sponsorship_required,
        education=dict(record.education or {}),
        custom_answers=dict(record.custom_answers or {}),
    )


def save_jobs(session: Session, jobs: List[Job]) -> List[Job]:
    for job in jobs:
        existing = session.get(JobRecord, job.job_id)
        payload = job.model_dump()
        if existing:
            for key, value in payload.items():
                setattr(existing, key, value)
        else:
            session.add(job_to_record(job))
    return jobs


def list_jobs(session: Session) -> List[Job]:
    return [record_to_job(row) for row in session.scalars(select(JobRecord).order_by(JobRecord.title)).all()]


def get_job(session: Session, job_id: str) -> Job:
    record = session.get(JobRecord, job_id)
    if not record:
        raise KeyError(job_id)
    return record_to_job(record)


def save_candidate(session: Session, profile: CandidateProfile) -> CandidateProfile:
    existing = session.get(CandidateRecord, profile.candidate_id)
    payload = profile.model_dump()
    if existing:
        for key, value in payload.items():
            setattr(existing, key, value)
    else:
        session.add(candidate_to_record(profile))

    autofill = session.get(AutofillRecord, profile.candidate_id)
    candidate_autofill = autofill_from_candidate(profile)
    if not autofill:
        session.add(AutofillRecord(**candidate_autofill.model_dump()))
    else:
        for key in ("legal_name", "email", "phone", "linkedin", "github", "portfolio"):
            current = getattr(autofill, key)
            incoming = getattr(candidate_autofill, key)
            if incoming and not current:
                setattr(autofill, key, incoming)
    return profile


def get_candidate(session: Session, candidate_id: str) -> CandidateProfile:
    record = session.get(CandidateRecord, candidate_id)
    if not record:
        profile = CandidateProfile(candidate_id=candidate_id)
        save_candidate(session, profile)
        return profile
    return record_to_candidate(record)


def save_application(session: Session, event: ApplicationEvent) -> ApplicationEvent:
    session.add(ApplicationRecord(**event.model_dump()))
    return event


def list_applications(session: Session, candidate_id: str) -> List[ApplicationEvent]:
    rows = session.scalars(
        select(ApplicationRecord)
        .where(ApplicationRecord.candidate_id == candidate_id)
        .order_by(ApplicationRecord.timestamp.desc())
    ).all()
    return [
        ApplicationEvent(candidate_id=row.candidate_id, job_id=row.job_id, status=row.status, note=row.note, timestamp=row.timestamp)
        for row in rows
    ]


def save_autofill(session: Session, profile: AutofillProfile) -> AutofillProfile:
    existing = session.get(AutofillRecord, profile.candidate_id)
    payload = profile.model_dump()
    if existing:
        for key, value in payload.items():
            setattr(existing, key, value)
    else:
        session.add(AutofillRecord(**payload))
    return profile


def get_autofill(session: Session, candidate_id: str) -> AutofillProfile:
    record = session.get(AutofillRecord, candidate_id)
    if record:
        return record_to_autofill(record)
    profile = autofill_from_candidate(get_candidate(session, candidate_id))
    save_autofill(session, profile)
    return profile


def counts(session: Session) -> dict:
    source_rows = session.execute(select(JobRecord.source, func.count(JobRecord.job_id)).group_by(JobRecord.source)).all()
    return {
        "jobs_total": session.scalar(select(func.count(JobRecord.job_id))) or 0,
        "candidates_total": session.scalar(select(func.count(CandidateRecord.candidate_id))) or 0,
        "applications_total": session.scalar(select(func.count(ApplicationRecord.id))) or 0,
        "ingestion_runs_total": session.scalar(select(func.count(IngestionRunRecord.id))) or 0,
        "jobs_by_source": {source: count for source, count in source_rows},
    }


def save_integration_settings(session: Session, settings: IntegrationSettings) -> IntegrationStatus:
    record = session.get(IntegrationSettingsRecord, 1)
    payload = settings.model_dump()
    if record:
        for key, value in payload.items():
            setattr(record, key, value)
    else:
        session.add(IntegrationSettingsRecord(id=1, **payload))
    return integration_status_from_settings(settings)


def get_integration_settings(session: Session) -> IntegrationSettings:
    record = session.get(IntegrationSettingsRecord, 1)
    if not record:
        return IntegrationSettings()
    return IntegrationSettings(
        adzuna_app_id=record.adzuna_app_id,
        adzuna_app_key=record.adzuna_app_key,
        usajobs_user_agent=record.usajobs_user_agent,
        usajobs_api_key=record.usajobs_api_key,
        jsearch_api_key=record.jsearch_api_key,
    )


def integration_status_from_settings(settings: IntegrationSettings) -> IntegrationStatus:
    return IntegrationStatus(
        adzuna_configured=bool(settings.adzuna_app_id and settings.adzuna_app_key),
        usajobs_configured=bool(settings.usajobs_user_agent and settings.usajobs_api_key),
        jsearch_configured=bool(settings.jsearch_api_key),
        usajobs_user_agent=settings.usajobs_user_agent,
    )


def get_integration_status(session: Session) -> IntegrationStatus:
    return integration_status_from_settings(get_integration_settings(session))


def save_ingestion_run(session: Session, run: IngestionRun) -> IngestionRun:
    payload = run.model_dump(exclude={"id"})
    if run.id:
        record = session.get(IngestionRunRecord, run.id)
        if record:
            for key, value in payload.items():
                setattr(record, key, value)
            return record_to_ingestion_run(record)
    record = IngestionRunRecord(**payload)
    session.add(record)
    session.flush()
    return record_to_ingestion_run(record)


def record_to_ingestion_run(record: IngestionRunRecord) -> IngestionRun:
    return IngestionRun(
        id=record.id,
        query=record.query,
        location=record.location,
        sources=list(record.sources or []),
        jobs_found=record.jobs_found,
        jobs_saved=record.jobs_saved,
        status=record.status,
        error=record.error,
        started_at=record.started_at,
        finished_at=record.finished_at,
    )


def list_ingestion_runs(session: Session, limit: int = 10) -> List[IngestionRun]:
    rows = session.scalars(select(IngestionRunRecord).order_by(IngestionRunRecord.started_at.desc()).limit(limit)).all()
    return [record_to_ingestion_run(row) for row in rows]
