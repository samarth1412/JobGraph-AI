from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator


class Job(BaseModel):
    job_id: str
    source: str
    title: str
    company: str
    location: str = ""
    work_model: str = "unknown"
    description: str = ""
    apply_url: str = ""
    posted_at: Optional[str] = None
    salary_min: Optional[float] = None
    salary_max: Optional[float] = None
    required_skills: List[str] = Field(default_factory=list)
    raw: Dict[str, Any] = Field(default_factory=dict)
    remote: bool = False
    job_type: str = ""
    source_ats: str = ""
    source_url: str = ""
    requirements: str = ""
    posted_date: Optional[str] = None
    salary: Optional[str] = None


def job_with_unified_api_fields(job: Job) -> Job:
    """Populate portal-style unified fields without a model validator (avoids nested validation warnings)."""
    data = job.model_dump()
    raw = data.get("raw") or {}
    jt = str(raw.get("employment_type") or raw.get("jobType") or raw.get("timeType") or data.get("job_type") or "full_time")
    salary_val: Optional[str] = data.get("salary")
    if salary_val is None and (data.get("salary_min") is not None or data.get("salary_max") is not None):
        lo, hi = data.get("salary_min"), data.get("salary_max")
        if lo is not None and hi is not None and lo != hi:
            salary_val = f"{int(lo)}–{int(hi)}"
        elif lo is not None:
            salary_val = str(int(lo))
        elif hi is not None:
            salary_val = str(int(hi))
    req = data.get("requirements") or (data.get("description") or "")[:2000]
    data.update(
        {
            "source_ats": data.get("source_ats") or data.get("source"),
            "source_url": data.get("source_url") or data.get("apply_url"),
            "posted_date": data.get("posted_date") or data.get("posted_at"),
            "remote": data.get("work_model") == "remote",
            "job_type": jt,
            "requirements": req,
            "salary": salary_val,
        }
    )
    return Job.model_validate(data)


class CandidateProfile(BaseModel):
    candidate_id: str = "default"
    name: str = ""
    email: str = ""
    phone: str = ""
    summary: str = ""
    location_preferences: List[str] = Field(default_factory=list)
    target_roles: List[str] = Field(default_factory=list)
    skills: List[str] = Field(default_factory=list)
    projects: List[str] = Field(default_factory=list)
    experience: List[Dict[str, Any]] = Field(default_factory=list)
    education: List[Dict[str, Any]] = Field(default_factory=list)
    certifications: List[str] = Field(default_factory=list)
    experience_years: float = 0
    work_authorization: str = ""
    sponsorship_required: str = ""
    links: Dict[str, str] = Field(default_factory=dict)


class SearchRequest(BaseModel):
    query: str = "machine learning engineer new grad"
    location: str = "United States"
    page: int = 1
    results_per_page: int = 25
    sources: List[str] = Field(default_factory=lambda: ["ashby", "greenhouse", "lever", "workday"])


class IntegrationSettings(BaseModel):
    adzuna_app_id: str = ""
    adzuna_app_key: str = ""
    usajobs_user_agent: str = ""
    usajobs_api_key: str = ""
    jsearch_api_key: str = ""


class IntegrationStatus(BaseModel):
    ats_sources: List[str] = Field(default_factory=lambda: ["ashby", "greenhouse", "lever", "workday"])
    companies_catalog: Dict[str, Any] = Field(default_factory=dict)
    adzuna_configured: bool = False
    usajobs_configured: bool = False
    jsearch_configured: bool = False
    usajobs_user_agent: str = ""
    scraper_sources: List[str] = Field(default_factory=lambda: ["ashby", "greenhouse", "lever", "workday"])


class IngestionRun(BaseModel):
    id: Optional[int] = None
    query: str
    location: str
    sources: List[str] = Field(default_factory=list)
    jobs_found: int = 0
    jobs_saved: int = 0
    status: str = "pending"
    error: str = ""
    started_at: datetime = Field(default_factory=datetime.utcnow)
    finished_at: Optional[datetime] = None


class MatchResult(BaseModel):
    job: Job
    score: float
    matched_skills: List[str]
    missing_skills: List[str]
    explanation: str
    why_fit: List[str] = Field(default_factory=list)
    why_may_not_fit: List[str] = Field(default_factory=list)
    title_match_score: float = 0.0
    recency_score: float = 0.0
    experience_fit_score: float = 0.0
    structural_entity_score: float = 0.0
    graph_feedback_multiplier: float = 1.0
    model_source: str = "skill_graph_ranker"
    gnn_score: float = 0.0
    semantic_score: float = 0.0
    skill_overlap_score: float = 0.0


class ResumeRecommendationResponse(BaseModel):
    candidate_id: str
    candidate: CandidateProfile
    matches: List[MatchResult]
    gnn_diagnostics: Dict[str, Any]
    ingestion: Dict[str, Any] = Field(default_factory=dict)
    recommendation_run: Dict[str, Any] = Field(default_factory=dict)
    parsed_resume: Dict[str, Any] = Field(default_factory=dict)


class RecommendationRun(BaseModel):
    id: Optional[int] = None
    candidate_id: str = "default"
    query: str = ""
    location: str = ""
    model_source: str = ""
    model_version: str = ""
    job_pool_size: int = 0
    match_job_ids: List[str] = Field(default_factory=list)
    parsed_resume: Dict[str, Any] = Field(default_factory=dict)
    diagnostics: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AgentRequest(BaseModel):
    candidate_id: str = "default"
    message: str


class ApplicationJobSummary(BaseModel):
    job_id: str
    latest_status: str
    latest_note: str = ""
    applied_at: Optional[datetime] = None
    reminder_at: Optional[datetime] = None
    last_updated: datetime = Field(default_factory=datetime.utcnow)
    history_count: int = 0
    job_title: str = ""
    company: str = ""


class ApplicationEvent(BaseModel):
    id: Optional[int] = None
    candidate_id: str = "default"
    job_id: str
    status: str
    note: str = ""
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    applied_at: Optional[datetime] = None
    reminder_at: Optional[datetime] = None

    @field_validator("status")
    @classmethod
    def _normalize_status(cls, value: str) -> str:
        from backend.app.tracking.statuses import normalize_application_status

        return normalize_application_status(value)


class AutofillProfile(BaseModel):
    candidate_id: str = "default"
    legal_name: str = ""
    email: str = ""
    phone: str = ""
    linkedin: str = ""
    github: str = ""
    portfolio: str = ""
    work_authorization: str = ""
    sponsorship_required: str = ""
    education: Dict[str, str] = Field(default_factory=dict)
    custom_answers: Dict[str, str] = Field(default_factory=dict)


class ApplySession(BaseModel):
    id: Optional[int] = None
    candidate_id: str = "default"
    job_id: str
    apply_url: str = ""
    status: str = "pending"
    autofill_profile: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: Optional[datetime] = None


class ApplyAgentRunRequest(BaseModel):
    candidate_id: str = "default"
    job_id: str
    headless: bool = False


class ApplyAgentRun(BaseModel):
    id: Optional[int] = None
    candidate_id: str = "default"
    job_id: str
    apply_url: str = ""
    status: str = "starting"
    ats: str = "generic"
    current_url: str = ""
    filled_fields: List[Dict[str, Any]] = Field(default_factory=list)
    blockers: List[Dict[str, Any]] = Field(default_factory=list)
    file_fields: List[Dict[str, Any]] = Field(default_factory=list)
    page_summary: str = ""
    error: str = ""
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    finished_at: Optional[datetime] = None
