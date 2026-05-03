from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator

from backend.app.core.config import Settings, get_settings
from backend.app.ingestion.sources import ATS_SOURCES

_REPO_ROOT = Path(__file__).resolve().parents[3]


class CompanyEntry(BaseModel):
    company: str
    ats: str
    board: Optional[str] = None
    url: Optional[str] = None

    @field_validator("ats")
    @classmethod
    def ats_lower(cls, v: str) -> str:
        return (v or "").strip().lower()


def default_catalog_path() -> Path:
    return _REPO_ROOT / "companies.json"


def resolve_catalog_path(settings: Optional[Settings] = None) -> Path:
    s = settings or get_settings()
    raw = (s.companies_catalog_path or "companies.json").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = _REPO_ROOT / path
    return path


def workday_board_from_url(url: str) -> str:
    """Build ``tenant|site|base_url`` for :meth:`JobIngestionClient._parse_workday_board`."""
    parsed = urlparse(url.strip())
    if not parsed.scheme or not parsed.netloc:
        raise ValueError(f"Invalid Workday URL: {url}")
    base_url = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    parts = [p for p in (parsed.path or "").split("/") if p]
    tenant = parsed.netloc.split(".")[0].lower()
    if not parts:
        site = "Careers"
    elif re.match(r"^[a-z]{2}-[A-Z]{2}$", parts[0]) and len(parts) > 1:
        site = parts[1]
    else:
        site = parts[0]
    return f"{tenant}|{site}|{base_url}"


def load_company_entries(path: Optional[Path] = None) -> List[CompanyEntry]:
    catalog_path = path or resolve_catalog_path()
    if not catalog_path.is_file():
        return []
    data = json.loads(catalog_path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        return []
    return [CompanyEntry.model_validate(item) for item in data if isinstance(item, dict)]


def boards_from_entries(entries: List[CompanyEntry]) -> Dict[str, List[str]]:
    out: Dict[str, List[str]] = {"ashby": [], "greenhouse": [], "lever": [], "workday": []}
    for entry in entries:
        ats = entry.ats
        if ats not in ATS_SOURCES:
            continue
        if ats == "workday":
            if entry.url:
                try:
                    token = workday_board_from_url(entry.url)
                    out["workday"].append(token)
                except ValueError:
                    continue
            elif entry.board and "|" in entry.board:
                out["workday"].append(entry.board.strip())
        elif entry.board:
            out[ats].append(entry.board.strip())
    return out


def _dedupe_preserve(seq: List[str]) -> List[str]:
    seen = set()
    result: List[str] = []
    for item in seq:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def merge_board_lists(
    catalog_boards: Dict[str, List[str]],
    settings: Settings,
) -> Dict[str, List[str]]:
    def split_csv(value: str) -> List[str]:
        return [part.strip() for part in (value or "").split(",") if part.strip()]

    merged: Dict[str, List[str]] = {}
    for key in ("ashby", "greenhouse", "lever", "workday"):
        env_key = {
            "ashby": settings.ashby_job_boards,
            "greenhouse": settings.greenhouse_boards,
            "lever": settings.lever_companies,
            "workday": settings.workday_boards,
        }[key]
        merged[key] = _dedupe_preserve(list(catalog_boards.get(key, [])) + split_csv(env_key))
    return merged


def load_merged_board_lists(settings: Optional[Settings] = None) -> Dict[str, List[str]]:
    s = settings or get_settings()
    entries = load_company_entries(resolve_catalog_path(s))
    catalog_boards = boards_from_entries(entries)
    return merge_board_lists(catalog_boards, s)


def catalog_meta(settings: Optional[Settings] = None) -> Dict[str, Any]:
    s = settings or get_settings()
    path = resolve_catalog_path(s)
    entries = load_company_entries(path)
    boards = boards_from_entries(entries)
    return {
        "path": str(path),
        "exists": path.is_file(),
        "company_rows": len(entries),
        "boards": {k: len(v) for k, v in boards.items()},
    }
