from __future__ import annotations

import re
from pathlib import Path
from pypdf import PdfReader
from backend.app.matching.skills import extract_skills
from backend.app.schemas import CandidateProfile


def extract_text_from_pdf(path: Path) -> str:
    reader = PdfReader(str(path))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def parse_resume_text(text: str, candidate_id: str = "default") -> CandidateProfile:
    email_match = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text)
    phone_match = re.search(r"(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}", text)
    links = {}
    for label, pattern in {"linkedin": r"https?://(?:www\.)?linkedin\.com/[^\s)]+", "github": r"https?://(?:www\.)?github\.com/[^\s)]+", "portfolio": r"https?://[^\s)]+"}.items():
        match = re.search(pattern, text, flags=re.I)
        if match and label not in links:
            links[label] = match.group(0)
    first_line = next((line.strip() for line in text.splitlines() if line.strip()), "")
    return CandidateProfile(candidate_id=candidate_id, name=first_line[:80], email=email_match.group(0) if email_match else "", phone=phone_match.group(0) if phone_match else "", skills=extract_skills(text), target_roles=["Machine Learning Engineer", "AI Engineer"], projects=[], links=links)
