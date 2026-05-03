"""Deterministic entity-graph signals: candidate–skills–jobs–company–ATS (no trained GNN claims)."""

from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Tuple

from backend.app.schemas import ApplicationEvent, CandidateProfile, Job


def structural_entity_scores(candidate: CandidateProfile, jobs: List[Job]) -> List[float]:
    """Path-style score in [0, 1]: shared skills, title/role hooks, company/ATS presence on graph."""
    cand_skills = {s.lower() for s in candidate.skills}
    roles = [r.lower() for r in candidate.target_roles]
    scores: List[float] = []
    for job in jobs:
        req = {s.lower() for s in job.required_skills}
        overlap = len(cand_skills & req) / max(len(req), 1) if req else 0.35
        title_blob = job.title.lower()
        role_hit = 0.22 if any(r and r in title_blob for r in roles) else 0.0
        ats_bonus = 0.06 if (job.source or "").lower() in ("ashby", "greenhouse", "lever", "workday") else 0.0
        company_bonus = 0.05 if job.company else 0.0
        raw = min(1.0, 0.62 * overlap + role_hit + ats_bonus + company_bonus)
        scores.append(raw)
    if len(scores) <= 1:
        return scores
    lo, hi = min(scores), max(scores)
    span = max(hi - lo, 1e-9)
    return [(s - lo) / span for s in scores]


def company_feedback_multipliers(jobs: List[Job], events: List[ApplicationEvent]) -> List[float]:
    """Boost/penalize jobs at companies inferred from latest tracker state per job (Phase 9 feedback)."""
    latest = _latest_event_by_job(events)
    company_sentiment: Dict[str, float] = defaultdict(float)
    for job_id, event in latest.items():
        job = next((j for j in jobs if j.job_id == job_id), None)
        if not job:
            continue
        key = job.company.strip().lower()
        if not key:
            continue
        if event.status in ("applied", "interview", "offer"):
            company_sentiment[key] += 0.12
        elif event.status in ("rejected", "skipped", "failed"):
            company_sentiment[key] -= 0.06
        elif event.status == "saved":
            company_sentiment[key] += 0.03

    multipliers: List[float] = []
    for job in jobs:
        key = job.company.strip().lower()
        adj = company_sentiment.get(key, 0.0)
        multipliers.append(max(0.88, min(1.15, 1.0 + adj)))
    return multipliers


def _latest_event_by_job(events: List[ApplicationEvent]) -> Dict[str, ApplicationEvent]:
    ordered = sorted(events, key=lambda e: e.timestamp)
    out: Dict[str, ApplicationEvent] = {}
    for event in ordered:
        out[event.job_id] = event
    return out


def combined_structural_feedback_vector(
    candidate: CandidateProfile, jobs: List[Job], events: List[ApplicationEvent]
) -> Tuple[List[float], List[float], List[float], Dict[str, float]]:
    struct = structural_entity_scores(candidate, jobs)
    mult = company_feedback_multipliers(jobs, events)
    combined = [min(1.0, s * m) for s, m in zip(struct, mult)]
    meta = {
        "structural_mean": sum(struct) / max(len(struct), 1),
        "feedback_mult_mean": sum(mult) / max(len(mult), 1),
    }
    return struct, mult, combined, meta
