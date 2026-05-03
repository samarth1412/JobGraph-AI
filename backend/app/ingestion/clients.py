from __future__ import annotations

import re
from typing import List, Optional

import requests

from backend.app.ingestion.companies_catalog import load_merged_board_lists
from backend.app.ingestion.normalize import dedupe_jobs, from_ashby, from_greenhouse, from_lever, from_workday
from backend.app.ingestion.sources import ATS_SOURCES
from backend.app.schemas import IntegrationSettings, Job, SearchRequest


class JobIngestionClient:
    def __init__(self, integration_settings: Optional[IntegrationSettings] = None) -> None:
        self.integration_settings = integration_settings or IntegrationSettings()

    def search(self, request: SearchRequest) -> List[Job]:
        if not request.sources:
            return []

        jobs: List[Job] = []
        failures: List[str] = []
        normalized = [str(source).strip().lower() for source in request.sources if str(source).strip()]
        unknown = [source for source in normalized if source not in ATS_SOURCES]
        for source in unknown:
            failures.append(f"{source}: only ATS sources are supported (ashby, greenhouse, lever, workday)")

        boards = load_merged_board_lists()
        source_handlers = {
            "ashby": lambda: self._ashby(request, boards.get("ashby", [])),
            "greenhouse": lambda: self._greenhouse(request, boards.get("greenhouse", [])),
            "lever": lambda: self._lever(request, boards.get("lever", [])),
            "workday": lambda: self._workday(request, boards.get("workday", [])),
        }

        for source in normalized:
            if source not in ATS_SOURCES:
                continue
            try:
                jobs.extend(source_handlers[source]())
            except Exception as exc:
                failures.append(f"{source}: {exc}")

        deduped = dedupe_jobs(jobs)
        if not deduped and failures:
            raise RuntimeError("; ".join(failures))
        return deduped

    def _ashby(self, request: SearchRequest, boards: List[str]) -> List[Job]:
        jobs: List[Job] = []
        for board in boards:
            try:
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
                    if row.get("isListed", True)
                    and self._matches_filters(
                        row.get("title", ""),
                        row.get("descriptionPlain", ""),
                        str(row.get("location") or ""),
                        request,
                    )
                )
            except requests.RequestException:
                continue
        return jobs

    def _greenhouse(self, request: SearchRequest, boards: List[str]) -> List[Job]:
        jobs: List[Job] = []
        for board in boards:
            try:
                response = requests.get(
                    f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs",
                    params={"content": "true"},
                    timeout=20,
                )
                response.raise_for_status()
                rows = response.json().get("jobs", [])
                for row in rows:
                    office_names = [str(o.get("name") or "") for o in (row.get("offices") or [])]
                    loc_str = ", ".join(office_names) if office_names else str((row.get("location") or {}).get("name") or "")
                    if not self._matches_filters(row.get("title", ""), row.get("content", ""), loc_str, request):
                        continue
                    jobs.append(from_greenhouse(row, board_name=board))
            except requests.RequestException:
                continue
        return jobs

    def _lever(self, request: SearchRequest, companies: List[str]) -> List[Job]:
        jobs: List[Job] = []
        for company in companies:
            try:
                response = requests.get(f"https://api.lever.co/v0/postings/{company}", params={"mode": "json"}, timeout=20)
                response.raise_for_status()
                rows = response.json()
                for row in rows:
                    cat = row.get("categories") or {}
                    loc_str = str(cat.get("location") or "")
                    desc_blob = " ".join(item.get("text", "") for item in row.get("lists", []))
                    if not self._matches_filters(row.get("text", ""), desc_blob, loc_str, request):
                        continue
                    jobs.append(from_lever(row, company=company))
            except requests.RequestException:
                continue
        return jobs

    def _workday(self, request: SearchRequest, boards: List[str]) -> List[Job]:
        jobs: List[Job] = []
        for board in boards:
            try:
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
                for row in rows:
                    if not row.get("title"):
                        continue
                    loc_str = str(row.get("locationsText") or "")
                    if not self._matches_filters(row.get("title", ""), str(row.get("jobFamily") or "") + " " + str(row.get("timeType") or ""), loc_str, request):
                        continue
                    jobs.append(from_workday(row, tenant=tenant, site=site, base_url=base_url))
            except (ValueError, requests.RequestException):
                continue
        return jobs

    def _matches_filters(self, title: str, description: str, job_location: str, request: SearchRequest) -> bool:
        """Keep jobs whose title/description (and optional job location text) match the search query and location."""
        blob = f"{title} {description} {job_location}".lower()
        terms = [term for term in request.query.lower().split() if len(term) > 2]
        if terms and not any(term in blob for term in terms):
            return False
        return self._location_matches(blob, request)

    def _location_matches(self, blob_lower: str, request: SearchRequest) -> bool:
        raw = (request.location or "").strip().lower()
        if not raw:
            return True
        if raw in ("united states", "usa", "us", "anywhere", "worldwide", "global", "world"):
            return True
        if raw in blob_lower:
            return True
        parts = [p.strip().lower() for p in re.split(r"[,/+]|(?:\s+)", raw) if p.strip()]
        sig = [p for p in parts if len(p) >= 2]
        if not sig:
            return True
        return any(p in blob_lower for p in sig)

    def _parse_workday_board(self, value: str) -> tuple[str, str, str]:
        parts = [part.strip() for part in value.split("|")]
        if len(parts) != 3:
            raise ValueError("Workday board must be tenant|site|base_url, for example company|External|https://company.wd1.myworkdayjobs.com")
        return parts[0], parts[1], parts[2]
