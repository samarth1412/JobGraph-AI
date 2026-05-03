from __future__ import annotations

from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "JobGraph AI"
    adzuna_app_id: str = ""
    adzuna_app_key: str = ""
    usajobs_user_agent: str = ""
    usajobs_api_key: str = ""
    jsearch_api_key: str = ""
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    database_url: str = "sqlite:///./jobgraph.db"
    jobspy_sites: str = "indeed,linkedin,zip_recruiter,google"
    jobspy_hours_old: int = 168
    jobspy_country: str = "USA"
    ashby_job_boards: str = "Ashby"
    greenhouse_boards: str = ""
    lever_companies: str = ""
    workday_boards: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
