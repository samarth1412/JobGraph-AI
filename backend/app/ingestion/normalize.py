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


def from_adzuna(row: Dict[str, Any]) -> Job:
    title = row.get("title") or ""
    company = (row.get("company") or {}).get("display_name") or "Unknown"
    location = (row.get("location") or {}).get("display_name") or ""
    description = clean_html(row.get("description") or "")
    return Job(job_id=stable_job_id("adzuna", title, company, location), source="adzuna", title=title, company=company, location=location, work_model=detect_work_model(description, location), description=description, apply_url=row.get("redirect_url") or "", posted_at=row.get("created"), salary_min=row.get("salary_min"), salary_max=row.get("salary_max"), required_skills=extract_skills(f"{title} {description}"), raw=row)


def from_usajobs(row: Dict[str, Any]) -> Job:
    descriptor = row.get("MatchedObjectDescriptor", {})
    title = descriptor.get("PositionTitle") or ""
    company = descriptor.get("OrganizationName") or descriptor.get("DepartmentName") or "US Federal Government"
    locations = descriptor.get("PositionLocation", []) or []
    location = ", ".join([loc.get("LocationName", "") for loc in locations if loc.get("LocationName")])
    description = clean_html(descriptor.get("QualificationSummary") or descriptor.get("UserArea", {}).get("Details", {}).get("JobSummary", ""))
    return Job(job_id=stable_job_id("usajobs", title, company, location), source="usajobs", title=title, company=company, location=location, work_model=detect_work_model(description, location), description=description, apply_url=descriptor.get("PositionURI") or "", posted_at=descriptor.get("PublicationStartDate"), required_skills=extract_skills(f"{title} {description}"), raw=row)


def from_jsearch(row: Dict[str, Any]) -> Job:
    title = row.get("job_title") or ""
    company = row.get("employer_name") or "Unknown"
    location = row.get("job_city") or row.get("job_country") or ""
    description = clean_html(row.get("job_description") or "")
    return Job(job_id=row.get("job_id") or stable_job_id("jsearch", title, company, location), source="jsearch", title=title, company=company, location=location, work_model=detect_work_model(description, location), description=description, apply_url=row.get("job_apply_link") or "", posted_at=row.get("job_posted_at_datetime_utc"), required_skills=extract_skills(f"{title} {description}"), raw=row)


def from_jobspy(row: Dict[str, Any]) -> Job:
    title = compact_text(row.get("title"))
    company = compact_text(row.get("company")) or "Unknown"
    city = compact_text(row.get("city"))
    state = compact_text(row.get("state"))
    country = compact_text(row.get("country"))
    location = ", ".join(part for part in [city, state, country] if part) or compact_text(row.get("location"))
    description = clean_html(compact_text(row.get("description")))
    source = f"jobspy_{compact_text(row.get('site') or 'board').lower().replace(' ', '_')}"
    apply_url = compact_text(row.get("job_url_direct")) or compact_text(row.get("job_url")) or compact_text(row.get("url"))
    work_model = "remote" if bool(row.get("is_remote")) else detect_work_model(f"{title} {description}", location)
    return Job(
        job_id=compact_text(row.get("id")) or stable_job_id(source, title, company, location),
        source=source,
        title=title,
        company=company,
        location=location,
        work_model=work_model,
        description=description,
        apply_url=apply_url,
        posted_at=compact_text(row.get("date_posted")),
        salary_min=_number_or_none(row.get("min_amount")),
        salary_max=_number_or_none(row.get("max_amount")),
        required_skills=extract_skills(f"{title} {description}"),
        raw={key: _json_safe(value) for key, value in row.items()},
    )


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


def _number_or_none(value: Any) -> float | None:
    try:
        if value is None:
            return None
        number = float(value)
        if math.isnan(number):
            return None
        return number
    except (TypeError, ValueError):
        return None


def _json_safe(value: Any) -> Any:
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, (str, int, bool)) or value is None:
        return value
    if isinstance(value, float):
        return value
    return str(value)
