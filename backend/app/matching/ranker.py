from __future__ import annotations

from typing import List

from backend.app.matching.graphsage import graphsage_affinity_scores
from backend.app.matching.semantic import semantic_scores
from backend.app.matching.trained_gnn import trained_scores
from backend.app.schemas import CandidateProfile, Job, MatchResult


def rank_jobs(candidate: CandidateProfile, jobs: List[Job], k: int = 25) -> List[MatchResult]:
    candidate_skills = {skill.lower(): skill for skill in candidate.skills}
    semantic = semantic_scores(candidate, jobs)
    graph_affinity, _diagnostics = graphsage_affinity_scores(candidate, jobs)
    learned_scores, model_source = trained_scores(candidate, jobs)
    results: List[MatchResult] = []

    for index, job in enumerate(jobs):
        required = {skill.lower(): skill for skill in job.required_skills}
        matched_keys = sorted(set(candidate_skills) & set(required))
        missing_keys = sorted(set(required) - set(candidate_skills))
        role_bonus = 0.15 if any(role.lower() in job.title.lower() for role in candidate.target_roles) else 0.0
        location_bonus = 0.10 if any(loc.lower() in job.location.lower() for loc in candidate.location_preferences) else 0.0
        skill_score = len(matched_keys) / max(len(required), 1)
        semantic_score = semantic[index] if index < len(semantic) else 0.0
        graph_score = graph_affinity[index] if index < len(graph_affinity) else 0.0
        base_score = min(1.0, 0.42 * skill_score + 0.16 * semantic_score + 0.27 * graph_score + role_bonus + location_bonus)
        score = (0.58 * base_score + 0.42 * learned_scores[index]) if learned_scores else base_score
        matched = [required[key] for key in matched_keys]
        missing = [required[key] for key in missing_keys]
        results.append(
            MatchResult(
                job=job,
                score=round(score * 100, 1),
                matched_skills=matched,
                missing_skills=missing,
                explanation=explain(job, matched, missing, score, semantic_score, graph_score),
                model_source=model_source,
                gnn_score=round(graph_score * 100, 1),
                semantic_score=round(semantic_score * 100, 1),
                skill_overlap_score=round(skill_score * 100, 1),
            )
        )

    return sorted(results, key=lambda item: item.score, reverse=True)[:k]


def explain(job: Job, matched: List[str], missing: List[str], score: float, semantic_score: float = 0.0, graph_score: float = 0.0) -> str:
    parts = []
    if matched:
        parts.append(f"Matches {len(matched)} core skills: {', '.join(matched[:6])}.")
    if missing:
        parts.append(f"Missing or weak signals: {', '.join(missing[:6])}.")
    if semantic_score > 0:
        parts.append(f"Semantic resume/job similarity is {round(semantic_score * 100)}%.")
    if graph_score > 0:
        parts.append(f"GNN graph affinity signal is {round(graph_score * 100)}% from GraphSAGE-style candidate-skill-role-job message passing.")
    if job.work_model != "unknown":
        parts.append(f"Work model detected as {job.work_model}.")
    parts.append(
        f"Overall fit is {round(score * 100)} based on skill overlap, semantic similarity, graph affinity, role intent, and location preference."
    )
    return " ".join(parts)
