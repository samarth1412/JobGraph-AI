from __future__ import annotations

from typing import List

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.db.models import ApplicationRecord, AutofillRecord, CandidateRecord, JobRecord
from backend.app.schemas import ApplicationEvent, AutofillProfile, CandidateProfile, Job


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

    if not session.get(AutofillRecord, profile.candidate_id):
        session.add(AutofillRecord(**autofill_from_candidate(profile).model_dump()))
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
        "jobs_by_source": {source: count for source, count in source_rows},
    }
