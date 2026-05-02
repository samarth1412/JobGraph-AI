from __future__ import annotations

from typing import Dict, List
from backend.app.schemas import ApplicationEvent, AutofillProfile, CandidateProfile, Job

JOBS: Dict[str, Job] = {}
CANDIDATES: Dict[str, CandidateProfile] = {}
APPLICATIONS: List[ApplicationEvent] = []
AUTOFILL_PROFILES: Dict[str, AutofillProfile] = {}


def upsert_jobs(jobs: List[Job]) -> List[Job]:
    for job in jobs:
        JOBS[job.job_id] = job
    return jobs


def save_candidate(profile: CandidateProfile) -> CandidateProfile:
    CANDIDATES[profile.candidate_id] = profile
    if profile.candidate_id not in AUTOFILL_PROFILES:
        AUTOFILL_PROFILES[profile.candidate_id] = AutofillProfile(
            candidate_id=profile.candidate_id,
            legal_name=profile.name,
            email=profile.email,
            phone=profile.phone,
            linkedin=profile.links.get("linkedin", ""),
            github=profile.links.get("github", ""),
            portfolio=profile.links.get("portfolio", ""),
        )
    return profile


def get_candidate(candidate_id: str = "default") -> CandidateProfile:
    if candidate_id not in CANDIDATES:
        CANDIDATES[candidate_id] = CandidateProfile(candidate_id=candidate_id)
    return CANDIDATES[candidate_id]
