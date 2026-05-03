from __future__ import annotations

import re
from typing import Iterable, Optional

from backend.app.apply_agent.schemas import FieldMatch
from backend.app.schemas import AutofillProfile

FIELD_TERMS = {
    "legal_name": ("name", "full name", "legal name", "preferred name", "first and last"),
    "email": ("email", "e-mail"),
    "phone": ("phone", "mobile", "telephone"),
    "linkedin": ("linkedin", "linked in"),
    "github": ("github", "git hub"),
    "portfolio": ("portfolio", "website", "personal site"),
    "work_authorization": ("work authorization", "authorized to work", "legally authorized", "eligible to work"),
    "sponsorship_required": ("sponsorship", "visa", "require sponsorship", "future sponsorship"),
}

EDUCATION_TERMS = {
    "school": ("school", "university", "college"),
    "degree": ("degree", "program"),
    "major": ("major", "field of study", "discipline"),
}

YES_TERMS = ("yes", "y", "true", "authorized")
NO_TERMS = ("no", "n", "false", "not")


def normalize_label(label: str) -> str:
    return re.sub(r"\s+", " ", label or "").strip().lower()


def value_for_field(profile: AutofillProfile, label: str) -> Optional[FieldMatch]:
    normalized = normalize_label(label)
    if not normalized:
        return None

    direct = _direct_value(profile, normalized)
    if direct:
        return direct

    education = _education_value(profile, normalized)
    if education:
        return education

    custom = _custom_answer(profile, normalized)
    if custom:
        return custom

    return None


def boolean_choice(value: str, option_label: str) -> bool:
    normalized_value = normalize_label(value)
    normalized_option = normalize_label(option_label)
    wants_yes = _contains_any(normalized_value, YES_TERMS)
    wants_no = _contains_any(normalized_value, NO_TERMS)
    return (wants_yes and _contains_any(normalized_option, YES_TERMS)) or (wants_no and _contains_any(normalized_option, NO_TERMS))


def _direct_value(profile: AutofillProfile, label: str) -> Optional[FieldMatch]:
    for key, terms in FIELD_TERMS.items():
        value = str(getattr(profile, key, "") or "").strip()
        if value and _contains_any(label, terms):
            return FieldMatch(key=key, value=value, confidence=0.92)
    return None


def _education_value(profile: AutofillProfile, label: str) -> Optional[FieldMatch]:
    for key, terms in EDUCATION_TERMS.items():
        value = str(profile.education.get(key, "") or "").strip()
        if value and _contains_any(label, terms):
            return FieldMatch(key=f"education.{key}", value=value, confidence=0.78)
    return None


def _custom_answer(profile: AutofillProfile, label: str) -> Optional[FieldMatch]:
    for question, answer in profile.custom_answers.items():
        normalized_question = normalize_label(question)
        value = str(answer or "").strip()
        if value and normalized_question[:48] and normalized_question[:48] in label:
            return FieldMatch(key=f"custom_answers.{question}", value=value, confidence=0.7)
    return None


def _contains_any(value: str, terms: Iterable[str]) -> bool:
    return any(term in value for term in terms)
