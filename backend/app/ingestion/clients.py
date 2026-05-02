from __future__ import annotations

from typing import List, Optional
import requests
from backend.app.core.config import get_settings
from backend.app.ingestion.normalize import dedupe_jobs, from_adzuna, from_jsearch, from_usajobs
from backend.app.schemas import IntegrationSettings, Job, SearchRequest


class JobIngestionClient:
    def __init__(self, integration_settings: Optional[IntegrationSettings] = None) -> None:
        self.integration_settings = integration_settings or IntegrationSettings()

    def search(self, request: SearchRequest) -> List[Job]:
        jobs: List[Job] = []
        if "adzuna" in request.sources:
            jobs.extend(self._adzuna(request))
        if "usajobs" in request.sources:
            jobs.extend(self._usajobs(request))
        if "jsearch" in request.sources:
            jobs.extend(self._jsearch(request))
        return dedupe_jobs(jobs)

    def _adzuna(self, request: SearchRequest) -> List[Job]:
        settings = get_settings()
        app_id = self.integration_settings.adzuna_app_id or settings.adzuna_app_id
        app_key = self.integration_settings.adzuna_app_key or settings.adzuna_app_key
        if not app_id or not app_key:
            return []
        response = requests.get(f"https://api.adzuna.com/v1/api/jobs/us/search/{request.page}", params={"app_id": app_id, "app_key": app_key, "what": request.query, "where": request.location, "results_per_page": request.results_per_page, "content-type": "application/json"}, timeout=20)
        response.raise_for_status()
        return [from_adzuna(row) for row in response.json().get("results", [])]

    def _usajobs(self, request: SearchRequest) -> List[Job]:
        settings = get_settings()
        user_agent = self.integration_settings.usajobs_user_agent or settings.usajobs_user_agent
        api_key = self.integration_settings.usajobs_api_key or settings.usajobs_api_key
        if not user_agent or not api_key:
            return []
        headers = {"Host": "data.usajobs.gov", "User-Agent": user_agent, "Authorization-Key": api_key}
        params = {"Keyword": request.query, "LocationName": request.location, "Page": request.page, "ResultsPerPage": min(request.results_per_page, 100)}
        response = requests.get("https://data.usajobs.gov/api/Search", headers=headers, params=params, timeout=20)
        response.raise_for_status()
        return [from_usajobs(row) for row in response.json().get("SearchResult", {}).get("SearchResultItems", [])]

    def _jsearch(self, request: SearchRequest) -> List[Job]:
        settings = get_settings()
        api_key = self.integration_settings.jsearch_api_key or settings.jsearch_api_key
        if not api_key:
            return []
        headers = {"X-RapidAPI-Key": api_key, "X-RapidAPI-Host": "jsearch.p.rapidapi.com"}
        params = {"query": f"{request.query} in {request.location}", "page": request.page, "num_pages": 1}
        response = requests.get("https://jsearch.p.rapidapi.com/search", headers=headers, params=params, timeout=20)
        response.raise_for_status()
        return [from_jsearch(row) for row in response.json().get("data", [])]
