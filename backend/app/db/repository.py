from __future__ import annotations

from typing import List, Optional

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from backend.app.db.models import (
    ApplicationRecord,
    ApplyAgentRunRecord,
    ApplySessionRecord,
    AutofillRecord,
    CandidateRecord,
    IngestionRunRecord,
    IntegrationSettingsRecord,
    JobRecord,
    RecommendationRunRecord,
)
from backend.app.schemas import (
    ApplicationEvent,
    ApplyAgentRun,
    ApplySession,
    AutofillProfile,
    CandidateProfile,
    IngestionRun,
    IntegrationSettings,
    IntegrationStatus,
    Job,
    RecommendationRun,
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
    return CandidateRecord(
        candidate_id=profile.candidate_id,
        name=profile.name,
        email=profile.email,
        phone=profile.phone,
        location_preferences=profile.location_preferences,
        target_roles=profile.target_roles,
        skills=profile.skills,
        projects=profile.projects,
        experience_years=profile.experience_years,
        links=_links_with_structured_profile(profile),
    )


def record_to_candidate(record: CandidateRecord) -> CandidateProfile:
    links = dict(record.links or {})
    structured = dict(links.pop("_structured_profile", {}) or {})
    return CandidateProfile(
        candidate_id=record.candidate_id,
        name=record.name,
        email=record.email,
        phone=record.phone,
        summary=structured.get("summary", ""),
        location_preferences=list(record.location_preferences or []),
        target_roles=list(record.target_roles or []),
        skills=list(record.skills or []),
        projects=list(record.projects or []),
        experience=list(structured.get("experience", []) or []),
        education=list(structured.get("education", []) or []),
        certifications=list(structured.get("certifications", []) or []),
        experience_years=record.experience_years,
        work_authorization=structured.get("work_authorization", ""),
        sponsorship_required=structured.get("sponsorship_required", ""),
        links=links,
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
        work_authorization=profile.work_authorization,
        sponsorship_required=profile.sponsorship_required,
        education=profile.education[0] if profile.education else {},
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


def delete_jobs_by_sources(session: Session, sources: List[str]) -> int:
    if not sources:
        return 0
    result = session.execute(delete(JobRecord).where(JobRecord.source.in_(sources)))
    return int(result.rowcount or 0)


def get_job(session: Session, job_id: str) -> Job:
    record = session.get(JobRecord, job_id)
    if not record:
        raise KeyError(job_id)
    return record_to_job(record)


def save_candidate(session: Session, profile: CandidateProfile) -> CandidateProfile:
    existing = session.get(CandidateRecord, profile.candidate_id)
    payload = candidate_to_record(profile).__dict__
    payload.pop("_sa_instance_state", None)
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
        for key in (
            "legal_name",
            "email",
            "phone",
            "linkedin",
            "github",
            "portfolio",
            "work_authorization",
            "sponsorship_required",
            "education",
        ):
            setattr(autofill, key, getattr(candidate_autofill, key))
    return profile


def _links_with_structured_profile(profile: CandidateProfile) -> dict:
    links = dict(profile.links or {})
    links["_structured_profile"] = {
        "summary": profile.summary,
        "experience": profile.experience,
        "education": profile.education,
        "certifications": profile.certifications,
        "work_authorization": profile.work_authorization,
        "sponsorship_required": profile.sponsorship_required,
    }
    return links


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


def save_apply_session(session: Session, apply_session: ApplySession) -> ApplySession:
    record = ApplySessionRecord(**apply_session.model_dump(exclude={"id"}))
    session.add(record)
    session.flush()
    return record_to_apply_session(record)


def record_to_apply_session(record: ApplySessionRecord) -> ApplySession:
    return ApplySession(
        id=record.id,
        candidate_id=record.candidate_id,
        job_id=record.job_id,
        apply_url=record.apply_url,
        status=record.status,
        autofill_profile=dict(record.autofill_profile or {}),
        created_at=record.created_at,
        expires_at=record.expires_at,
    )


def latest_apply_session(session: Session, candidate_id: str) -> Optional[ApplySession]:
    record = session.scalars(
        select(ApplySessionRecord)
        .where(ApplySessionRecord.candidate_id == candidate_id)
        .where(ApplySessionRecord.status == "pending")
        .order_by(ApplySessionRecord.created_at.desc())
        .limit(1)
    ).first()
    return record_to_apply_session(record) if record else None


def update_apply_session_status(session: Session, session_id: int, status: str) -> ApplySession:
    record = session.get(ApplySessionRecord, session_id)
    if not record:
        raise KeyError(session_id)
    record.status = status
    session.flush()
    return record_to_apply_session(record)


def save_apply_agent_run(session: Session, run: ApplyAgentRun) -> ApplyAgentRun:
    payload = run.model_dump(exclude={"id", "metadata"})
    payload["run_metadata"] = run.metadata
    if run.id:
        record = session.get(ApplyAgentRunRecord, run.id)
        if not record:
            raise KeyError(run.id)
        for key, value in payload.items():
            setattr(record, key, value)
    else:
        record = ApplyAgentRunRecord(**payload)
        session.add(record)
    session.flush()
    return record_to_apply_agent_run(record)


def get_apply_agent_run(session: Session, run_id: int) -> ApplyAgentRun:
    record = session.get(ApplyAgentRunRecord, run_id)
    if not record:
        raise KeyError(run_id)
    return record_to_apply_agent_run(record)


def list_apply_agent_runs(session: Session, candidate_id: str, limit: int = 10) -> List[ApplyAgentRun]:
    rows = session.scalars(
        select(ApplyAgentRunRecord)
        .where(ApplyAgentRunRecord.candidate_id == candidate_id)
        .order_by(ApplyAgentRunRecord.created_at.desc())
        .limit(limit)
    ).all()
    return [record_to_apply_agent_run(row) for row in rows]


def record_to_apply_agent_run(record: ApplyAgentRunRecord) -> ApplyAgentRun:
    return ApplyAgentRun(
        id=record.id,
        candidate_id=record.candidate_id,
        job_id=record.job_id,
        apply_url=record.apply_url,
        status=record.status,
        ats=record.ats,
        current_url=record.current_url,
        filled_fields=list(record.filled_fields or []),
        blockers=list(record.blockers or []),
        file_fields=list(record.file_fields or []),
        page_summary=record.page_summary,
        error=record.error,
        metadata=dict(record.run_metadata or {}),
        created_at=record.created_at,
        updated_at=record.updated_at,
        finished_at=record.finished_at,
    )


def counts(session: Session) -> dict:
    source_rows = session.execute(select(JobRecord.source, func.count(JobRecord.job_id)).group_by(JobRecord.source)).all()
    return {
        "jobs_total": session.scalar(select(func.count(JobRecord.job_id))) or 0,
        "candidates_total": session.scalar(select(func.count(CandidateRecord.candidate_id))) or 0,
        "applications_total": session.scalar(select(func.count(ApplicationRecord.id))) or 0,
        "apply_sessions_total": session.scalar(select(func.count(ApplySessionRecord.id))) or 0,
        "apply_agent_runs_total": session.scalar(select(func.count(ApplyAgentRunRecord.id))) or 0,
        "ingestion_runs_total": session.scalar(select(func.count(IngestionRunRecord.id))) or 0,
        "recommendation_runs_total": session.scalar(select(func.count(RecommendationRunRecord.id))) or 0,
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


def recommendation_run_to_record(run: RecommendationRun) -> RecommendationRunRecord:
    payload = run.model_dump(exclude={"id"})
    return RecommendationRunRecord(**payload)


def record_to_recommendation_run(record: RecommendationRunRecord) -> RecommendationRun:
    return RecommendationRun(
        id=record.id,
        candidate_id=record.candidate_id,
        query=record.query,
        location=record.location,
        model_source=record.model_source,
        model_version=record.model_version,
        job_pool_size=record.job_pool_size,
        match_job_ids=list(record.match_job_ids or []),
        parsed_resume=dict(record.parsed_resume or {}),
        diagnostics=dict(record.diagnostics or {}),
        created_at=record.created_at,
    )


def save_recommendation_run(session: Session, run: RecommendationRun) -> RecommendationRun:
    record = recommendation_run_to_record(run)
    session.add(record)
    session.flush()
    return record_to_recommendation_run(record)


def list_recommendation_runs(session: Session, candidate_id: str, limit: int = 10) -> List[RecommendationRun]:
    rows = session.scalars(
        select(RecommendationRunRecord)
        .where(RecommendationRunRecord.candidate_id == candidate_id)
        .order_by(RecommendationRunRecord.created_at.desc())
        .limit(limit)
    ).all()
    return [record_to_recommendation_run(row) for row in rows]
