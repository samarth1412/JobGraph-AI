from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


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


class CandidateProfile(BaseModel):
    candidate_id: str = "default"
    name: str = ""
    email: str = ""
    phone: str = ""
    location_preferences: List[str] = Field(default_factory=list)
    target_roles: List[str] = Field(default_factory=list)
    skills: List[str] = Field(default_factory=list)
    projects: List[str] = Field(default_factory=list)
    experience_years: float = 0
    links: Dict[str, str] = Field(default_factory=dict)


class SearchRequest(BaseModel):
    query: str = "machine learning engineer new grad"
    location: str = "United States"
    page: int = 1
    results_per_page: int = 25
    sources: List[str] = Field(default_factory=lambda: ["jobspy", "ashby", "greenhouse", "lever", "workday"])


class IntegrationSettings(BaseModel):
    adzuna_app_id: str = ""
    adzuna_app_key: str = ""
    usajobs_user_agent: str = ""
    usajobs_api_key: str = ""
    jsearch_api_key: str = ""


class IntegrationStatus(BaseModel):
    adzuna_configured: bool = False
    usajobs_configured: bool = False
    jsearch_configured: bool = False
    usajobs_user_agent: str = ""
    scraper_sources: List[str] = Field(default_factory=lambda: ["jobspy", "ashby", "greenhouse", "lever", "workday"])


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
    model_source: str = "skill_graph_ranker"


class AgentRequest(BaseModel):
    candidate_id: str = "default"
    message: str


class ApplicationEvent(BaseModel):
    candidate_id: str = "default"
    job_id: str
    status: str
    note: str = ""
    timestamp: datetime = Field(default_factory=datetime.utcnow)


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
