from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List

import requests
from pypdf import PdfReader

from backend.app.core.config import get_settings
from backend.app.matching.skills import extract_skills
from backend.app.schemas import CandidateProfile


SECTION_ALIASES = {
    "experience": ("experience", "work experience", "professional experience", "employment"),
    "education": ("education",),
    "projects": ("projects", "project experience"),
    "certifications": ("certifications", "certificates", "licenses"),
    "skills": ("skills", "technical skills", "technologies"),
}


def extract_text_from_pdf(path: Path) -> str:
    reader = PdfReader(str(path))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def parse_resume_text(text: str, candidate_id: str = "default") -> CandidateProfile:
    cleaned = _clean_resume_text(text)
    llm_profile = _parse_with_openai(cleaned, candidate_id)
    if llm_profile:
        return _merge_with_heuristics(llm_profile, cleaned)
    return _heuristic_profile(cleaned, candidate_id)


def _parse_with_openai(text: str, candidate_id: str) -> CandidateProfile | None:
    settings = get_settings()
    if not settings.openai_api_key:
        return None

    schema_hint = {
        "name": "",
        "email": "",
        "phone": "",
        "summary": "",
        "target_roles": [],
        "location_preferences": [],
        "skills": [],
        "projects": [],
        "experience": [{"company": "", "title": "", "location": "", "start": "", "end": "", "bullets": []}],
        "education": [{"school": "", "degree": "", "field": "", "start": "", "end": ""}],
        "certifications": [],
        "experience_years": 0,
        "work_authorization": "",
        "sponsorship_required": "",
        "links": {"linkedin": "", "github": "", "portfolio": ""},
    }
    prompt = (
        "Extract a truthful structured candidate profile from this resume. "
        "Return only compact JSON matching this shape. Do not invent missing facts. "
        f"Shape: {json.dumps(schema_hint)}\n\nResume:\n{text[:16000]}"
    )
    try:
        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.openai_api_key}", "Content-Type": "application/json"},
            json={
                "model": settings.openai_model,
                "messages": [
                    {"role": "system", "content": "You are a precise resume parser. Return JSON only."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0,
                "response_format": {"type": "json_object"},
            },
            timeout=35,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        data = json.loads(content)
        data["candidate_id"] = candidate_id
        return CandidateProfile(**_normalize_profile_payload(data))
    except Exception:
        return None


def _heuristic_profile(text: str, candidate_id: str) -> CandidateProfile:
    email_match = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text)
    phone_match = re.search(r"(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}", text)
    links = _extract_links(text)
    sections = _split_sections(text)
    skills = _ordered_unique(extract_skills(text) + _skills_from_section(sections.get("skills", "")))
    name = _candidate_name(text, email_match.group(0) if email_match else "")
    roles = _infer_target_roles(text, skills)
    projects = _section_bullets(sections.get("projects", ""))[:8]
    experience = _experience_entries(sections.get("experience", ""))
    education = _education_entries(sections.get("education", ""))
    certifications = _section_bullets(sections.get("certifications", ""))[:8]

    return CandidateProfile(
        candidate_id=candidate_id,
        name=name,
        email=email_match.group(0) if email_match else "",
        phone=phone_match.group(0) if phone_match else "",
        summary=_summary_from_profile(roles, skills, projects),
        location_preferences=_infer_locations(text),
        target_roles=roles,
        skills=skills,
        projects=projects,
        experience=experience,
        education=education,
        certifications=certifications,
        experience_years=_infer_years(text, experience),
        work_authorization=_infer_work_authorization(text),
        sponsorship_required=_infer_sponsorship(text),
        links=links,
    )


def _merge_with_heuristics(profile: CandidateProfile, text: str) -> CandidateProfile:
    fallback = _heuristic_profile(text, profile.candidate_id)
    profile.email = profile.email or fallback.email
    profile.phone = profile.phone or fallback.phone
    profile.name = profile.name or fallback.name
    profile.summary = profile.summary or fallback.summary
    profile.skills = _ordered_unique(profile.skills + fallback.skills)
    profile.target_roles = _ordered_unique(profile.target_roles + fallback.target_roles)[:6]
    profile.location_preferences = _ordered_unique(profile.location_preferences + fallback.location_preferences)[:8]
    profile.projects = profile.projects or fallback.projects
    profile.experience = profile.experience or fallback.experience
    profile.education = profile.education or fallback.education
    profile.certifications = profile.certifications or fallback.certifications
    profile.experience_years = profile.experience_years or fallback.experience_years
    profile.work_authorization = profile.work_authorization or fallback.work_authorization
    profile.sponsorship_required = profile.sponsorship_required or fallback.sponsorship_required
    profile.links = {**fallback.links, **{key: value for key, value in profile.links.items() if value}}
    return profile


def _clean_resume_text(text: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", text.replace("\x00", "")).strip()


def _extract_links(text: str) -> Dict[str, str]:
    links: Dict[str, str] = {}
    patterns = {
        "linkedin": r"https?://(?:www\.)?linkedin\.com/[^\s)]+",
        "github": r"https?://(?:www\.)?github\.com/[^\s)]+",
        "portfolio": r"https?://[^\s)]+",
    }
    for label, pattern in patterns.items():
        match = re.search(pattern, text, flags=re.I)
        if match and label not in links:
            links[label] = match.group(0).rstrip(".,")
    return links


def _candidate_name(text: str, email: str) -> str:
    for line in text.splitlines()[:8]:
        cleaned = line.strip(" -|")
        if not cleaned or email in cleaned or "@" in cleaned or "http" in cleaned.lower():
            continue
        if len(cleaned.split()) <= 5 and not re.search(r"\d", cleaned):
            return cleaned[:80]
    return ""


def _split_sections(text: str) -> Dict[str, str]:
    lines = text.splitlines()
    sections: Dict[str, List[str]] = {}
    current = "header"
    for line in lines:
        normalized = re.sub(r"[^a-z ]", "", line.lower()).strip()
        matched = next((key for key, aliases in SECTION_ALIASES.items() if normalized in aliases), None)
        if matched:
            current = matched
            sections.setdefault(current, [])
            continue
        sections.setdefault(current, []).append(line)
    return {key: "\n".join(value).strip() for key, value in sections.items()}


def _skills_from_section(section: str) -> List[str]:
    chunks = re.split(r"[,|;/\n]", section)
    return [chunk.strip() for chunk in chunks if 1 < len(chunk.strip()) < 40]


def _section_bullets(section: str) -> List[str]:
    bullets = []
    for line in section.splitlines():
        cleaned = re.sub(r"^[\-*•\s]+", "", line).strip()
        if len(cleaned) > 8:
            bullets.append(cleaned)
    return bullets


def _experience_entries(section: str) -> List[Dict[str, Any]]:
    entries = []
    current: Dict[str, Any] | None = None
    for line in section.splitlines():
        cleaned = line.strip()
        if not cleaned:
            continue
        if _looks_like_heading(cleaned):
            if current:
                entries.append(current)
            current = {"title": cleaned, "company": "", "location": "", "start": "", "end": "", "bullets": []}
        elif current:
            current.setdefault("bullets", []).append(re.sub(r"^[\-*•\s]+", "", cleaned))
    if current:
        entries.append(current)
    return entries[:6]


def _education_entries(section: str) -> List[Dict[str, Any]]:
    entries = []
    for line in _section_bullets(section):
        entries.append({"school": line, "degree": "", "field": "", "start": "", "end": ""})
    return entries[:4]


def _looks_like_heading(line: str) -> bool:
    if re.search(r"\b(20\d{2}|19\d{2}|present|current|intern|engineer|developer|analyst|assistant|research)\b", line, flags=re.I):
        return True
    return len(line.split()) <= 9 and not line.startswith(("-", "*", "•"))


def _infer_target_roles(text: str, skills: List[str]) -> List[str]:
    lowered = text.lower()
    roles = []
    role_signals = [
        ("Machine Learning Engineer", ("machine learning", "pytorch", "tensorflow", "mlflow")),
        ("AI Engineer", ("llm", "rag", "langgraph", "openai", "agent")),
        ("Software Engineer", ("software engineer", "react", "fastapi", "typescript")),
        ("Data Scientist", ("data scientist", "statistics", "analytics")),
        ("Data Engineer", ("data engineer", "spark", "airflow", "etl")),
    ]
    skill_blob = " ".join(skills).lower()
    for role, signals in role_signals:
        if any(signal in lowered or signal in skill_blob for signal in signals):
            roles.append(role)
    return roles[:4] or ["Software Engineer"]


def _infer_locations(text: str) -> List[str]:
    locations = []
    for value in ("Remote", "United States", "New York", "California", "Texas", "Seattle", "San Francisco"):
        if value.lower() in text.lower():
            locations.append(value)
    return _ordered_unique(locations or ["United States"])


def _infer_years(text: str, experience: List[Dict[str, Any]]) -> float:
    match = re.search(r"(\d+(?:\.\d+)?)\+?\s+years?", text, flags=re.I)
    if match:
        return float(match.group(1))
    return float(min(len(experience), 5))


def _infer_work_authorization(text: str) -> str:
    lowered = text.lower()
    if "citizen" in lowered:
        return "US Citizen"
    if "green card" in lowered or "permanent resident" in lowered:
        return "US permanent resident"
    if "opt" in lowered or "cpt" in lowered or "h-1b" in lowered or "h1b" in lowered:
        return "Requires visa-aware review"
    return ""


def _infer_sponsorship(text: str) -> str:
    lowered = text.lower()
    if "no sponsorship" in lowered or "do not require sponsorship" in lowered:
        return "No"
    if "sponsorship" in lowered or "h-1b" in lowered or "h1b" in lowered:
        return "Unknown"
    return ""


def _summary_from_profile(roles: List[str], skills: List[str], projects: List[str]) -> str:
    role = roles[0] if roles else "candidate"
    skill_text = ", ".join(skills[:5])
    project_text = " with project experience" if projects else ""
    return f"{role}{project_text}. Core skills: {skill_text}." if skill_text else role


def _normalize_profile_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(data)
    for key in ("target_roles", "location_preferences", "skills", "projects", "experience", "education", "certifications"):
        value = normalized.get(key)
        if value is None:
            normalized[key] = []
        elif isinstance(value, str):
            normalized[key] = [item.strip() for item in re.split(r"[,;\n]", value) if item.strip()]
    normalized["links"] = normalized.get("links") if isinstance(normalized.get("links"), dict) else {}
    return normalized


def _ordered_unique(values: List[str]) -> List[str]:
    seen = set()
    result = []
    for value in values:
        cleaned = str(value).strip()
        key = cleaned.lower()
        if cleaned and key not in seen:
            seen.add(key)
            result.append(cleaned)
    return result
