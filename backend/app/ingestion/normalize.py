from __future__ import annotations

import hashlib
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
