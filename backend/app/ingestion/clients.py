from __future__ import annotations

from typing import List, Optional
import requests
from backend.app.core.config import get_settings
from backend.app.ingestion.normalize import stable_job_id
from backend.app.ingestion.normalize import (
    dedupe_jobs,
    from_adzuna,
    from_ashby,
    from_greenhouse,
    from_jobspy,
    from_jsearch,
    from_lever,
    from_usajobs,
    from_workday,
)
from backend.app.matching.skills import extract_skills
from backend.app.schemas import IntegrationSettings, Job, SearchRequest


class JobIngestionClient:
    def __init__(self, integration_settings: Optional[IntegrationSettings] = None) -> None:
        self.integration_settings = integration_settings or IntegrationSettings()

    def search(self, request: SearchRequest) -> List[Job]:
        jobs: List[Job] = []
        failures: List[str] = []
        source_handlers = {
            "jobspy": self._jobspy,
            "ashby": self._ashby,
            "greenhouse": self._greenhouse,
            "lever": self._lever,
            "workday": self._workday,
            "adzuna": self._adzuna,
            "usajobs": self._usajobs,
            "jsearch": self._jsearch,
            "demo": self._demo_jobs,
        }
        for source in request.sources:
            handler = source_handlers.get(source)
            if not handler:
                failures.append(f"{source}: unknown source")
                continue
            try:
                jobs.extend(handler(request))
            except Exception as exc:
                failures.append(f"{source}: {exc}")
        deduped = dedupe_jobs(jobs)
        if not deduped and failures:
            raise RuntimeError("; ".join(failures))
        return deduped

    def _demo_jobs(self, request: SearchRequest) -> List[Job]:
        query_role = request.query.title() if request.query else "Machine Learning Engineer"
        samples = [
            (
                f"{query_role} - New Grad",
                "Northstar AI",
                request.location or "Remote",
                "Build PyTorch model serving systems with FastAPI, Docker, MLflow, evaluation pipelines, and clean experiment tracking.",
                "remote",
            ),
            (
                "AI Engineer, Agentic Workflows",
                "Orbit Labs",
                "Remote",
                "Create LangGraph agents, RAG evaluation suites, OpenAI tool-calling workflows, and production telemetry with OpenTelemetry.",
                "remote",
            ),
            (
                "Recommendation Systems Engineer",
                "ShopGraph",
                "New York, NY",
                "Train ranking models and graph neural networks for recommendations using Python, PyTorch Geometric, SQL, and feature stores.",
                "hybrid",
            ),
            (
                "Machine Learning Platform Engineer",
                "VectorWorks",
                "San Francisco, CA",
                "Own model serving, vector search, Kubernetes deployments, CI/CD, PostgreSQL, Redis, and MLOps reliability.",
                "onsite",
            ),
            (
                "Applied AI Engineer",
                "TalentLoop",
                "United States",
                "Ship LLM features with RAG, prompt evaluation, FastAPI services, TypeScript dashboards, and customer-facing analytics.",
                "remote",
            ),
        ]
        return [
            Job(
                job_id=stable_job_id("demo", title, company, location),
                source="demo",
                title=title,
                company=company,
                location=location,
                work_model=work_model,
                description=description,
                apply_url="",
                required_skills=extract_skills(f"{title} {description}"),
            )
            for title, company, location, description, work_model in samples
        ]

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

    def _jobspy(self, request: SearchRequest) -> List[Job]:
        try:
            from jobspy import scrape_jobs
        except ImportError as exc:
            raise RuntimeError("python-jobspy is not installed. Install Python 3.10+ and `pip install python-jobspy`.") from exc

        settings = get_settings()
        sites = [site.strip() for site in settings.jobspy_sites.split(",") if site.strip()]
        results_per_site = max(1, min(request.results_per_page, 50))
        dataframe = scrape_jobs(
            site_name=sites,
            search_term=request.query,
            google_search_term=f"{request.query} jobs near {request.location}",
            location=request.location,
            results_wanted=results_per_site,
            hours_old=settings.jobspy_hours_old,
            country_indeed=settings.jobspy_country,
            linkedin_fetch_description=True,
            description_format="markdown",
            verbose=0,
        )
        rows = dataframe.to_dict(orient="records")
        return [from_jobspy(row) for row in rows if row.get("title")]

    def _ashby(self, request: SearchRequest) -> List[Job]:
        settings = get_settings()
        boards = [board.strip() for board in settings.ashby_job_boards.split(",") if board.strip()]
        jobs: List[Job] = []
        for board in boards:
            response = requests.get(
                f"https://api.ashbyhq.com/posting-api/job-board/{board}",
                params={"includeCompensation": "true"},
                timeout=20,
            )
            response.raise_for_status()
            rows = response.json().get("jobs", [])
            jobs.extend(
                from_ashby(row, board_name=board)
                for row in rows
                if row.get("isListed", True) and self._matches_query(row.get("title", ""), row.get("descriptionPlain", ""), request)
            )
        return jobs

    def _greenhouse(self, request: SearchRequest) -> List[Job]:
        settings = get_settings()
        boards = [board.strip() for board in settings.greenhouse_boards.split(",") if board.strip()]
        jobs: List[Job] = []
        for board in boards:
            response = requests.get(
                f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs",
                params={"content": "true"},
                timeout=20,
            )
            response.raise_for_status()
            rows = response.json().get("jobs", [])
            jobs.extend(
                from_greenhouse(row, board_name=board)
                for row in rows
                if self._matches_query(row.get("title", ""), row.get("content", ""), request)
            )
        return jobs

    def _lever(self, request: SearchRequest) -> List[Job]:
        settings = get_settings()
        companies = [company.strip() for company in settings.lever_companies.split(",") if company.strip()]
        jobs: List[Job] = []
        for company in companies:
            response = requests.get(f"https://api.lever.co/v0/postings/{company}", params={"mode": "json"}, timeout=20)
            response.raise_for_status()
            rows = response.json()
            jobs.extend(
                from_lever(row, company=company)
                for row in rows
                if self._matches_query(row.get("text", ""), " ".join(item.get("text", "") for item in row.get("lists", [])), request)
            )
        return jobs

    def _workday(self, request: SearchRequest) -> List[Job]:
        settings = get_settings()
        boards = [board.strip() for board in settings.workday_boards.split(",") if board.strip()]
        jobs: List[Job] = []
        for board in boards:
            tenant, site, base_url = self._parse_workday_board(board)
            response = requests.post(
                f"{base_url.rstrip('/')}/wday/cxs/{tenant}/{site}/jobs",
                json={
                    "appliedFacets": {},
                    "limit": min(request.results_per_page, 50),
                    "offset": max(request.page - 1, 0) * request.results_per_page,
                    "searchText": request.query,
                },
                timeout=20,
            )
            response.raise_for_status()
            rows = response.json().get("jobPostings", [])
            jobs.extend(from_workday(row, tenant=tenant, site=site, base_url=base_url) for row in rows if row.get("title"))
        return jobs

    def _matches_query(self, title: str, description: str, request: SearchRequest) -> bool:
        terms = [term for term in request.query.lower().split() if len(term) > 2]
        if not terms:
            return True
        blob = f"{title} {description}".lower()
        return any(term in blob for term in terms)

    def _parse_workday_board(self, value: str) -> tuple[str, str, str]:
        parts = [part.strip() for part in value.split("|")]
        if len(parts) != 3:
            raise ValueError("Workday board must be tenant|site|base_url, for example company|External|https://company.wd1.myworkdayjobs.com")
        return parts[0], parts[1], parts[2]
