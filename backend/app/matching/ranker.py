from __future__ import annotations

from typing import List

from backend.app.matching.semantic import semantic_scores
from backend.app.schemas import CandidateProfile, Job, MatchResult


def rank_jobs(candidate: CandidateProfile, jobs: List[Job], k: int = 25) -> List[MatchResult]:
    candidate_skills = {skill.lower(): skill for skill in candidate.skills}
    semantic = semantic_scores(candidate, jobs)
    results: List[MatchResult] = []

    for index, job in enumerate(jobs):
        required = {skill.lower(): skill for skill in job.required_skills}
        matched_keys = sorted(set(candidate_skills) & set(required))
        missing_keys = sorted(set(required) - set(candidate_skills))
        role_bonus = 0.15 if any(role.lower() in job.title.lower() for role in candidate.target_roles) else 0.0
        location_bonus = 0.10 if any(loc.lower() in job.location.lower() for loc in candidate.location_preferences) else 0.0
        skill_score = len(matched_keys) / max(len(required), 1)
        semantic_score = semantic[index] if index < len(semantic) else 0.0
        score = min(1.0, 0.58 * skill_score + 0.22 * semantic_score + role_bonus + location_bonus)
        matched = [required[key] for key in matched_keys]
        missing = [required[key] for key in missing_keys]
        results.append(
            MatchResult(
                job=job,
                score=round(score * 100, 1),
                matched_skills=matched,
                missing_skills=missing,
                explanation=explain(job, matched, missing, score, semantic_score),
            )
        )

    return sorted(results, key=lambda item: item.score, reverse=True)[:k]


def explain(job: Job, matched: List[str], missing: List[str], score: float, semantic_score: float = 0.0) -> str:
    parts = []
    if matched:
        parts.append(f"Matches {len(matched)} core skills: {', '.join(matched[:6])}.")
    if missing:
        parts.append(f"Missing or weak signals: {', '.join(missing[:6])}.")
    if semantic_score > 0:
        parts.append(f"Semantic resume/job similarity is {round(semantic_score * 100)}%.")
    if job.work_model != "unknown":
        parts.append(f"Work model detected as {job.work_model}.")
    parts.append(
        f"Overall fit is {round(score * 100)} based on skill graph overlap, semantic similarity, role intent, and location preference."
    )
    return " ".join(parts)
