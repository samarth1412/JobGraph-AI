from __future__ import annotations

import math
from typing import Any, Dict, List, Set

from backend.app.matching.ranker import rank_jobs
from backend.app.matching.trained_gnn import NEGATIVE_EVENTS, POSITIVE_EVENTS
from backend.app.schemas import ApplicationEvent, CandidateProfile, Job


def evaluate_ranker(candidate: CandidateProfile, jobs: List[Job], events: List[ApplicationEvent], k: int = 10) -> Dict[str, Any]:
    labels = _labels(events)
    if not labels:
        return {"evaluated": False, "reason": "No labeled application feedback yet.", "labeled_jobs": 0}

    ranked = rank_jobs(candidate, jobs, k=max(len(jobs), k))
    ranked_ids = [match.job.job_id for match in ranked]
    positives = {job_id for job_id, label in labels.items() if label >= 0.7}
    if not positives:
        return {"evaluated": False, "reason": "Need at least one positive feedback event.", "labeled_jobs": len(labels)}

    top_k = ranked_ids[:k]
    hits = [1 if job_id in positives else 0 for job_id in top_k]
    precision = sum(hits) / max(len(top_k), 1)
    recall = sum(hits) / max(len(positives), 1)
    mrr = _mrr(ranked_ids, positives)
    ndcg = _ndcg(ranked_ids[:k], labels)
    return {
        "evaluated": True,
        "labeled_jobs": len(labels),
        "positive_jobs": len(positives),
        "k": k,
        "precision_at_k": round(precision, 4),
        "recall_at_k": round(recall, 4),
        "mrr": round(mrr, 4),
        "ndcg_at_k": round(ndcg, 4),
    }


def _labels(events: List[ApplicationEvent]) -> Dict[str, float]:
    labels: Dict[str, float] = {}
    for event in events:
        if event.status in POSITIVE_EVENTS:
            labels[event.job_id] = max(labels.get(event.job_id, 0.0), POSITIVE_EVENTS[event.status])
        if event.status in NEGATIVE_EVENTS and event.job_id not in labels:
            labels[event.job_id] = NEGATIVE_EVENTS[event.status]
    return labels


def _mrr(ranked_ids: List[str], positives: Set[str]) -> float:
    for index, job_id in enumerate(ranked_ids, start=1):
        if job_id in positives:
            return 1.0 / index
    return 0.0


def _ndcg(ranked_ids: List[str], labels: Dict[str, float]) -> float:
    gains = [labels.get(job_id, 0.0) for job_id in ranked_ids]
    dcg = sum((2**gain - 1) / math.log2(index + 2) for index, gain in enumerate(gains))
    ideal = sorted(labels.values(), reverse=True)[: len(ranked_ids)]
    idcg = sum((2**gain - 1) / math.log2(index + 2) for index, gain in enumerate(ideal))
    return dcg / idcg if idcg else 0.0
