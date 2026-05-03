from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional

from sqlalchemy import DateTime, Float, Integer, JSON, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class JobRecord(Base):
    __tablename__ = "jobs"

    job_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    source: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(512), index=True)
    company: Mapped[str] = mapped_column(String(256), index=True)
    location: Mapped[str] = mapped_column(String(256), default="")
    work_model: Mapped[str] = mapped_column(String(32), default="unknown")
    description: Mapped[str] = mapped_column(Text, default="")
    apply_url: Mapped[str] = mapped_column(Text, default="")
    posted_at: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    salary_min: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    salary_max: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    required_skills: Mapped[List[str]] = mapped_column(JSON, default=list)
    raw: Mapped[Dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CandidateRecord(Base):
    __tablename__ = "candidates"

    candidate_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(256), default="")
    email: Mapped[str] = mapped_column(String(256), default="")
    phone: Mapped[str] = mapped_column(String(64), default="")
    location_preferences: Mapped[List[str]] = mapped_column(JSON, default=list)
    target_roles: Mapped[List[str]] = mapped_column(JSON, default=list)
    skills: Mapped[List[str]] = mapped_column(JSON, default=list)
    projects: Mapped[List[str]] = mapped_column(JSON, default=list)
    experience_years: Mapped[float] = mapped_column(Float, default=0)
    links: Mapped[Dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ApplicationRecord(Base):
    __tablename__ = "applications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    candidate_id: Mapped[str] = mapped_column(String(128), index=True)
    job_id: Mapped[str] = mapped_column(String(128), index=True)
    status: Mapped[str] = mapped_column(String(64), index=True)
    note: Mapped[str] = mapped_column(Text, default="")
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AutofillRecord(Base):
    __tablename__ = "autofill_profiles"

    candidate_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    legal_name: Mapped[str] = mapped_column(String(256), default="")
    email: Mapped[str] = mapped_column(String(256), default="")
    phone: Mapped[str] = mapped_column(String(64), default="")
    linkedin: Mapped[str] = mapped_column(Text, default="")
    github: Mapped[str] = mapped_column(Text, default="")
    portfolio: Mapped[str] = mapped_column(Text, default="")
    work_authorization: Mapped[str] = mapped_column(String(256), default="")
    sponsorship_required: Mapped[str] = mapped_column(String(64), default="")
    education: Mapped[Dict] = mapped_column(JSON, default=dict)
    custom_answers: Mapped[Dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ApplySessionRecord(Base):
    __tablename__ = "apply_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    candidate_id: Mapped[str] = mapped_column(String(128), index=True)
    job_id: Mapped[str] = mapped_column(String(128), index=True)
    apply_url: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(64), default="pending", index=True)
    autofill_profile: Mapped[Dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class ApplyAgentRunRecord(Base):
    __tablename__ = "apply_agent_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    candidate_id: Mapped[str] = mapped_column(String(128), index=True)
    job_id: Mapped[str] = mapped_column(String(128), index=True)
    apply_url: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(64), default="starting", index=True)
    ats: Mapped[str] = mapped_column(String(64), default="generic")
    current_url: Mapped[str] = mapped_column(Text, default="")
    filled_fields: Mapped[List[Dict]] = mapped_column(JSON, default=list)
    blockers: Mapped[List[Dict]] = mapped_column(JSON, default=list)
    file_fields: Mapped[List[Dict]] = mapped_column(JSON, default=list)
    page_summary: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str] = mapped_column(Text, default="")
    run_metadata: Mapped[Dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class IntegrationSettingsRecord(Base):
    __tablename__ = "integration_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    adzuna_app_id: Mapped[str] = mapped_column(String(256), default="")
    adzuna_app_key: Mapped[str] = mapped_column(String(512), default="")
    usajobs_user_agent: Mapped[str] = mapped_column(String(256), default="")
    usajobs_api_key: Mapped[str] = mapped_column(String(512), default="")
    jsearch_api_key: Mapped[str] = mapped_column(String(512), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class IngestionRunRecord(Base):
    __tablename__ = "ingestion_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    query: Mapped[str] = mapped_column(String(512), default="")
    location: Mapped[str] = mapped_column(String(256), default="")
    sources: Mapped[List[str]] = mapped_column(JSON, default=list)
    jobs_found: Mapped[int] = mapped_column(Integer, default=0)
    jobs_saved: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(64), default="pending")
    error: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class RecommendationRunRecord(Base):
    __tablename__ = "recommendation_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    candidate_id: Mapped[str] = mapped_column(String(128), index=True)
    query: Mapped[str] = mapped_column(String(512), default="")
    location: Mapped[str] = mapped_column(String(256), default="")
    model_source: Mapped[str] = mapped_column(String(128), default="")
    model_version: Mapped[str] = mapped_column(String(128), default="")
    job_pool_size: Mapped[int] = mapped_column(Integer, default=0)
    match_job_ids: Mapped[List[str]] = mapped_column(JSON, default=list)
    parsed_resume: Mapped[Dict] = mapped_column(JSON, default=dict)
    diagnostics: Mapped[Dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
