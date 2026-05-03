from __future__ import annotations

import hashlib
import math
import re
from typing import Any, Dict, Iterable, List
from backend.app.matching.skills import extract_skills
from backend.app.schemas import Job


def stable_job_id(source: str, title: str, company: str, location: str) -> str:
    key = "|".join([source, title.lower(), company.lower(), location.lower()])
    return f"{source}_{hashlib.sha1(key.encode('utf-8')).hexdigest()[:12]}"


def detect_work_model(text: str, location: str = "") -> str:
    blob = f"{text} {location}".lower()
    if "remote" in blob:
        return "remote"
    if "hybrid" in blob:
        return "hybrid"
    return "onsite"


def clean_html(value: str) -> str:
    return re.sub(r"<[^>]+>", " ", value or "").replace("&nbsp;", " ").strip()


def compact_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def dedupe_jobs(jobs: Iterable[Job]) -> List[Job]:
    seen = set()
    deduped = []
    for job in jobs:
        key = (job.title.lower(), job.company.lower(), job.location.lower())
        if key in seen:
            continue
        seen.add(key)
        deduped.append(job)
    return deduped


def from_ashby(row: Dict[str, Any], board_name: str) -> Job:
    title = row.get("title") or ""
    company = row.get("companyName") or board_name
    location = row.get("location") or ""
    description = clean_html(row.get("descriptionPlain") or row.get("descriptionHtml") or "")
    workplace = (row.get("workplaceType") or "").lower()
    work_model = "remote" if workplace == "remote" or row.get("isRemote") else "hybrid" if workplace == "hybrid" else "onsite"
    compensation = row.get("compensation") or {}
    salary_min, salary_max = _ashby_salary(compensation)
    return Job(
        job_id=stable_job_id("ashby", title, company, location),
        source="ashby",
        title=title,
        company=company,
        location=location,
        work_model=work_model,
        description=description,
        apply_url=row.get("applyUrl") or row.get("jobUrl") or "",
        posted_at=row.get("publishedAt"),
        salary_min=salary_min,
        salary_max=salary_max,
        required_skills=extract_skills(f"{title} {description}"),
        raw=row,
    )


def from_greenhouse(row: Dict[str, Any], board_name: str) -> Job:
    title = compact_text(row.get("title"))
    company = board_name
    location_rows = row.get("offices") or []
    location = ", ".join(compact_text(item.get("name")) for item in location_rows if item.get("name"))
    if not location:
        location = compact_text((row.get("location") or {}).get("name"))
    description = clean_html(row.get("content") or row.get("description") or "")
    absolute_url = compact_text(row.get("absolute_url"))
    return Job(
        job_id=stable_job_id("greenhouse", title, company, location),
        source="greenhouse",
        title=title,
        company=company,
        location=location,
        work_model=detect_work_model(description, location),
        description=description,
        apply_url=absolute_url,
        posted_at=compact_text(row.get("updated_at")),
        required_skills=extract_skills(f"{title} {description}"),
        raw=row,
    )


def from_lever(row: Dict[str, Any], company: str) -> Job:
    title = compact_text(row.get("text"))
    categories = row.get("categories") or {}
    location = compact_text(categories.get("location"))
    description = clean_html(" ".join(compact_text(item.get("text")) for item in row.get("lists", []) if item.get("text")))
    hosted_url = compact_text(row.get("hostedUrl"))
    apply_url = compact_text(row.get("applyUrl")) or hosted_url
    return Job(
        job_id=stable_job_id("lever", title, company, location),
        source="lever",
        title=title,
        company=company,
        location=location,
        work_model=detect_work_model(f"{description} {compact_text(categories.get('commitment'))}", location),
        description=description,
        apply_url=apply_url,
        posted_at=compact_text(row.get("createdAt")),
        required_skills=extract_skills(f"{title} {description}"),
        raw=row,
    )


def from_workday(row: Dict[str, Any], tenant: str, site: str, base_url: str) -> Job:
    title = compact_text(row.get("title"))
    company = tenant
    location = compact_text(row.get("locationsText")) or ", ".join(compact_text(item) for item in row.get("locations", []) if item)
    external_path = compact_text(row.get("externalPath"))
    apply_url = f"{base_url.rstrip('/')}/en-US/{site}{external_path}" if external_path else base_url
    description = clean_html(
        " ".join(
            compact_text(value)
            for value in [
                row.get("title"),
                row.get("locationsText"),
                row.get("timeType"),
                row.get("jobFamily"),
                row.get("jobType"),
            ]
            if value
        )
    )
    return Job(
        job_id=stable_job_id("workday", title, company, location),
        source="workday",
        title=title,
        company=company,
        location=location,
        work_model=detect_work_model(description, location),
        description=description,
        apply_url=apply_url,
        posted_at=compact_text(row.get("postedOn")),
        required_skills=extract_skills(f"{title} {description}"),
        raw=row,
    )


def _ashby_salary(compensation: Dict[str, Any]) -> tuple[float | None, float | None]:
    for component in compensation.get("summaryComponents", []) or []:
        if component.get("compensationType") == "Salary":
            return component.get("minValue"), component.get("maxValue")
    return None, None
