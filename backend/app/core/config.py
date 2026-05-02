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
    database_url: str = "sqlite:///./jobgraph.db"

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
