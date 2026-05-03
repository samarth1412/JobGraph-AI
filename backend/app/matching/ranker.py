from __future__ import annotations

import re
from typing import List, Optional, Tuple

from backend.app.matching.graphsage import graphsage_affinity_scores
from backend.app.matching.semantic import semantic_scores
from backend.app.matching.structural_graph import combined_structural_feedback_vector
from backend.app.matching.trained_gnn import trained_scores
from backend.app.schemas import ApplicationEvent, CandidateProfile, Job, MatchResult


def _title_match_fraction(candidate: CandidateProfile, title: str) -> float:
    tokens = [t for t in title.lower().split() if len(t) > 2]
    if not tokens:
        return 0.0
    blob = (" ".join(candidate.target_roles) + " " + " ".join(candidate.skills)).lower()
    hits = sum(1 for t in tokens if t in blob)
    return hits / len(tokens)


def _recency_score(posted_at: Optional[str]) -> float:
    if not posted_at:
        return 0.35
    lowered = posted_at.lower()
    if any(token in lowered for token in ("hour", "day", "week", "today", "just posted", "posted today")):
        return 0.92
    if "2026" in posted_at:
        return 0.82
    if "2025" in posted_at:
        return 0.55
    return 0.42


def _experience_fit(candidate_years: float, job: Job) -> float:
    blob = f"{job.title} {job.description}".lower()
    matches = re.findall(r"(\d+)\+?\s*(?:years|yrs|yr\b)", blob)
    if not matches:
        return 0.72
    required = max(float(value) for value in matches)
    if candidate_years >= required:
        return 1.0
    return max(0.18, min(1.0, candidate_years / max(required, 1.0)))


def _build_why_lists(
    job: Job,
    matched: List[str],
    missing: List[str],
    title_frac: float,
    recency: float,
    exp_fit: float,
    role_bonus: float,
    location_bonus: float,
) -> Tuple[List[str], List[str]]:
    why_fit: List[str] = []
    why_not: List[str] = []
    if matched:
        why_fit.append(f"Skill overlap with the posting on: {', '.join(matched[:10])}.")
    if title_frac >= 0.25:
        why_fit.append("Job title overlaps your stated target roles or resume skills.")
    if role_bonus:
        why_fit.append("Title matches at least one of your target role phrases.")
    if location_bonus:
        why_fit.append("Location matches one of your stated location preferences.")
    if recency >= 0.75:
        why_fit.append("Posting looks recent compared to the rest of the pool.")
    if exp_fit >= 0.85:
        why_fit.append("Stated experience expectations look compatible with your resume years.")

    if missing:
        why_not.append(f"Posting highlights skills not on your resume list: {', '.join(missing[:8])}.")
    if title_frac < 0.12 and not role_bonus:
        why_not.append("Title is a weak match for your target roles and headline skills.")
    if exp_fit < 0.55:
        why_not.append("The role may expect more years of experience than your resume shows.")
    if recency < 0.45:
        why_not.append("Posting date is unclear or likely older; treat fit as slightly less certain.")
    return why_fit, why_not


def rank_jobs(
    candidate: CandidateProfile,
    jobs: List[Job],
    k: int = 25,
    application_events: Optional[List[ApplicationEvent]] = None,
) -> List[MatchResult]:
    application_events = application_events or []
    struct_entity, feedback_mult, struct_combined, _struct_meta = combined_structural_feedback_vector(candidate, jobs, application_events)
    candidate_skills = {skill.lower(): skill for skill in candidate.skills}
    semantic = semantic_scores(candidate, jobs)
    graph_affinity, _diagnostics = graphsage_affinity_scores(candidate, jobs)
    learned_scores, model_source = trained_scores(candidate, jobs)
    if application_events and any(struct_entity):
        if model_source == "hybrid_skill_semantic_graphsage_ranker_v3":
            model_source = "entity_graph_skill_graphsage_feedback_v1"
    results: List[MatchResult] = []

    for index, job in enumerate(jobs):
        required = {skill.lower(): skill for skill in job.required_skills}
        matched_keys = sorted(set(candidate_skills) & set(required))
        missing_keys = sorted(set(required) - set(candidate_skills))
        role_bonus = 0.12 if any(role.lower() in job.title.lower() for role in candidate.target_roles) else 0.0
        location_bonus = 0.08 if any(loc.lower() in job.location.lower() for loc in candidate.location_preferences) else 0.0
        skill_score = len(matched_keys) / max(len(required), 1)
        semantic_score = semantic[index] if index < len(semantic) else 0.0
        graph_score = graph_affinity[index] if index < len(graph_affinity) else 0.0
        title_frac = _title_match_fraction(candidate, job.title)
        recency = _recency_score(job.posted_at)
        exp_fit = _experience_fit(candidate.experience_years, job)
        struct_signal = struct_combined[index] if index < len(struct_combined) else 0.0

        base_score = min(
            1.0,
            0.27 * skill_score
            + 0.12 * semantic_score
            + 0.18 * graph_score
            + 0.10 * title_frac
            + 0.07 * recency
            + 0.07 * exp_fit
            + 0.07 * struct_signal
            + role_bonus
            + location_bonus,
        )
        score = (0.58 * base_score + 0.42 * learned_scores[index]) if learned_scores else base_score
        matched = [required[key] for key in matched_keys]
        missing = [required[key] for key in missing_keys]
        why_fit, why_may_not_fit = _build_why_lists(job, matched, missing, title_frac, recency, exp_fit, role_bonus, location_bonus)
        if struct_entity[index] >= 0.55 and application_events:
            why_fit.append("Entity graph signal (skills, company, ATS path) is relatively strong for this posting.")
        if feedback_mult[index] > 1.04:
            why_fit.append("Your tracker shows positive momentum at this company; ranking nudges similar roles slightly up.")
        if feedback_mult[index] < 0.98:
            why_may_not_fit.append("Tracker feedback for this company is mixed or negative; similar roles are nudged down slightly.")
        explanation = explain_short(
            matched,
            missing,
            score,
            semantic_score,
            graph_score,
            title_frac,
            recency,
            exp_fit,
            struct_entity[index] if index < len(struct_entity) else 0.0,
            feedback_mult[index] if index < len(feedback_mult) else 1.0,
        )
        results.append(
            MatchResult(
                job=job,
                score=round(score * 100, 1),
                matched_skills=matched,
                missing_skills=missing,
                explanation=explanation,
                why_fit=why_fit,
                why_may_not_fit=why_may_not_fit,
                title_match_score=round(title_frac * 100, 1),
                recency_score=round(recency * 100, 1),
                experience_fit_score=round(exp_fit * 100, 1),
                structural_entity_score=round(struct_entity[index] * 100, 1) if index < len(struct_entity) else 0.0,
                graph_feedback_multiplier=round(feedback_mult[index], 3) if index < len(feedback_mult) else 1.0,
                model_source=model_source,
                gnn_score=round(graph_score * 100, 1),
                semantic_score=round(semantic_score * 100, 1),
                skill_overlap_score=round(skill_score * 100, 1),
            )
        )

    return sorted(results, key=lambda item: item.score, reverse=True)[:k]


def explain_short(
    matched: List[str],
    missing: List[str],
    score: float,
    semantic_score: float,
    graph_score: float,
    title_frac: float,
    recency: float,
    exp_fit: float,
    structural_entity: float = 0.0,
    feedback_multiplier: float = 1.0,
) -> str:
    parts = [
        f"Composite score {round(score * 100)} blends skill overlap, semantics, a local message-passing graph signal (not a separately trained production GNN), title overlap ({round(title_frac * 100)}%), recency, experience fit, and a small deterministic entity-graph boost ({round(structural_entity * 100)}%).",
    ]
    if matched:
        parts.append(f"{len(matched)} skills aligned with the posting.")
    if missing:
        parts.append(f"{len(missing)} highlighted skills are not on your resume list.")
    parts.append(
        f"Signals: semantic {round(semantic_score * 100)}%, graph affinity {round(graph_score * 100)}%, recency {round(recency * 100)}%, experience fit {round(exp_fit * 100)}%, tracker company multiplier {round(feedback_multiplier, 3)}."
    )
    return " ".join(parts)


def explain(job: Job, matched: List[str], missing: List[str], score: float, semantic_score: float = 0.0, graph_score: float = 0.0) -> str:
    return explain_short(matched, missing, score, semantic_score, graph_score, 0.0, 0.5, 0.7, 0.0, 1.0)
