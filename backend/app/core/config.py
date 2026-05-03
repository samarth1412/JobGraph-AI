from __future__ import annotations

from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "JobGraph AI"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    database_url: str = "sqlite:///./jobgraph.db"
    companies_catalog_path: str = "companies.json"
    ashby_job_boards: str = ""
    greenhouse_boards: str = ""
    lever_companies: str = ""
    workday_boards: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
