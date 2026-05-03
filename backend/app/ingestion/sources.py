from __future__ import annotations

from collections import Counter
from typing import Iterable, List

from backend.app.schemas import Job

SEARCH_SOURCES = ["ashby", "greenhouse", "lever", "workday"]
ATS_SOURCES = {"ashby", "greenhouse", "lever", "workday"}
LEGACY_SOURCES = {"adzuna", "usajobs", "jsearch", "demo"}


def is_scraper_source(source: str) -> bool:
    return source in ATS_SOURCES


def scraper_jobs(jobs: Iterable[Job]) -> List[Job]:
    return [job for job in jobs if is_scraper_source(job.source)]


def scraper_source_counts(jobs: Iterable[Job]) -> dict:
    return dict(Counter(job.source for job in jobs if is_scraper_source(job.source)))
