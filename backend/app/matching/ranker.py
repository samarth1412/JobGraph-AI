from __future__ import annotations

from typing import List
from backend.app.schemas import CandidateProfile, Job, MatchResult


def rank_jobs(candidate: CandidateProfile, jobs: List[Job], k: int = 25) -> List[MatchResult]:
    candidate_skills = {skill.lower(): skill for skill in candidate.skills}
    results: List[MatchResult] = []
    for job in jobs:
        required = {skill.lower(): skill for skill in job.required_skills}
        matched_keys = sorted(set(candidate_skills) & set(required))
        missing_keys = sorted(set(required) - set(candidate_skills))
        role_bonus = 0.15 if any(role.lower() in job.title.lower() for role in candidate.target_roles) else 0.0
        location_bonus = 0.10 if any(loc.lower() in job.location.lower() for loc in candidate.location_preferences) else 0.0
        skill_score = len(matched_keys) / max(len(required), 1)
        score = min(1.0, 0.75 * skill_score + role_bonus + location_bonus)
        matched = [required[key] for key in matched_keys]
        missing = [required[key] for key in missing_keys]
        results.append(MatchResult(job=job, score=round(score * 100, 1), matched_skills=matched, missing_skills=missing, explanation=explain(job, matched, missing, score)))
    return sorted(results, key=lambda item: item.score, reverse=True)[:k]


def explain(job: Job, matched: List[str], missing: List[str], score: float) -> str:
    parts = []
    if matched:
        parts.append(f"Matches {len(matched)} core skills: {', '.join(matched[:6])}.")
    if missing:
        parts.append(f"Missing or weak signals: {', '.join(missing[:6])}.")
    if job.work_model != "unknown":
        parts.append(f"Work model detected as {job.work_model}.")
    parts.append(f"Overall fit is {round(score * 100)} based on skill overlap, role intent, and location preference.")
    return " ".join(parts)
