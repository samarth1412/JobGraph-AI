"""Resolve a small logo URL for job cards (ATS artwork when present, else favicon)."""

from __future__ import annotations

import re
from typing import Any, Dict
from urllib.parse import urlparse


def _is_logo_url(value: Any) -> bool:
    return isinstance(value, str) and value.startswith(("http://", "https://"))


def _logo_from_raw(raw: Dict[str, Any]) -> str:
    for key in ("logoUrl", "logo_url", "companyLogoUrl", "organizationLogoUrl", "brandLogoUrl", "imageUrl"):
        v = raw.get(key)
        if _is_logo_url(v):
            return v.strip()
    for key in ("team", "department", "organization", "company"):
        nested = raw.get(key)
        if isinstance(nested, dict):
            for nk in ("logoUrl", "avatarUrl", "imageUrl", "pictureUrl"):
                v = nested.get(nk)
                if _is_logo_url(v):
                    return str(v).strip()
    return ""


def _ats_host(host: str) -> bool:
    h = host.lower()
    markers = (
        "greenhouse.io",
        "lever.co",
        "ashbyhq.com",
        "myworkdayjobs.com",
    )
    return any(m in h for m in markers)


def _guess_domain(source: str, company: str, apply_url: str) -> str:
    parsed = urlparse(apply_url or "")
    host = (parsed.netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]

    if "myworkdayjobs.com" in host:
        sub = host.split(".")[0]
        if sub and len(sub) > 1:
            return f"{sub}.com"

    if host and not _ats_host(host) and "." in host:
        parts = host.split(".")
        if len(parts) >= 2:
            return ".".join(parts[-2:])

    slug = re.sub(r"[^a-z0-9]", "", (company or "").lower())
    if not slug:
        return ""
    return f"{slug}.com"


def resolve_company_logo_url(source: str, company: str, apply_url: str, raw: Dict[str, Any]) -> str:
    raw = raw or {}
    direct = _logo_from_raw(raw)
    if direct:
        return direct
    domain = _guess_domain(source, company, apply_url)
    if not domain:
        return ""
    return f"https://www.google.com/s2/favicons?domain={domain}&sz=128"
