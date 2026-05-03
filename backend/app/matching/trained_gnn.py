from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

from backend.app.matching.graphsage import graphsage_affinity_scores
from backend.app.matching.semantic import semantic_scores
from backend.app.schemas import ApplicationEvent, CandidateProfile, Job

MODEL_PATH = Path("models/gnn_ranker.json")
POSITIVE_EVENTS = {"saved": 0.72, "applying": 0.86, "applied": 1.0, "interview": 1.0, "offer": 1.0}
NEGATIVE_EVENTS = {"skipped": 0.0, "failed": 0.18, "rejected": 0.12}


@dataclass(frozen=True)
class TrainedGraphRanker:
    weights: List[float]
    bias: float
    examples: int
    model: str = "trained_graphsage_feedback_ranker_v1"


def load_trained_ranker(path: Path = MODEL_PATH) -> Optional[TrainedGraphRanker]:
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    return TrainedGraphRanker(weights=list(data["weights"]), bias=float(data["bias"]), examples=int(data.get("examples", 0)))


def train_graph_ranker(candidate: CandidateProfile, jobs: List[Job], events: List[ApplicationEvent], path: Path = MODEL_PATH) -> dict:
    pytorch_result = _train_pytorch_graphsage(candidate, jobs, events)
    labels = _labels_from_events(events)
    training_jobs = [job for job in jobs if job.job_id in labels]
    if len(training_jobs) < 2:
        return {
            "trained": bool(pytorch_result.get("trained")),
            "model": pytorch_result.get("model", "trained_graphsage_feedback_ranker_v1"),
            "pytorch_graphsage": pytorch_result,
            "linear_fallback": {
                "trained": False,
                "reason": "Need at least two labeled jobs from saved/applied/skipped/failed events.",
                "examples": len(training_jobs),
            },
        }

    features = _feature_matrix(candidate, training_jobs)
    y = np.array([labels[job.job_id] for job in training_jobs], dtype=np.float64)
    weights = np.zeros(features.shape[1], dtype=np.float64)
    bias = 0.0
    lr = 0.18

    for _ in range(420):
        logits = features @ weights + bias
        predictions = _sigmoid(logits)
        error = predictions - y
        weights -= lr * ((features.T @ error) / len(y) + 0.015 * weights)
        bias -= lr * float(np.mean(error))

    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "model": "trained_graphsage_feedback_ranker_v1",
        "weights": weights.round(6).tolist(),
        "bias": round(float(bias), 6),
        "examples": len(training_jobs),
        "feature_order": ["graphsage", "semantic", "skill_overlap", "role_match", "location_match", "work_model_remote"],
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return {"trained": True, "pytorch_graphsage": pytorch_result, "linear_fallback": payload, **payload}


def trained_scores(candidate: CandidateProfile, jobs: List[Job], path: Path = MODEL_PATH) -> Tuple[Optional[List[float]], str]:
    if path == MODEL_PATH:
        pytorch_scores, pytorch_source = _pytorch_graphsage_scores(candidate, jobs)
        if pytorch_scores is not None:
            return pytorch_scores, pytorch_source
    model = load_trained_ranker(path)
    if not model or not jobs:
        return None, "hybrid_skill_semantic_graphsage_ranker_v3"
    features = _feature_matrix(candidate, jobs)
    weights = np.array(model.weights, dtype=np.float64)
    scores = _sigmoid(features @ weights + model.bias).tolist()
    return scores, model.model


def _feature_matrix(candidate: CandidateProfile, jobs: List[Job]) -> np.ndarray:
    semantic = semantic_scores(candidate, jobs)
    graph_scores, _ = graphsage_affinity_scores(candidate, jobs)
    rows = []
    candidate_skills = {skill.lower() for skill in candidate.skills}
    for index, job in enumerate(jobs):
        required = {skill.lower() for skill in job.required_skills}
        skill_overlap = len(candidate_skills & required) / max(len(required), 1)
        role_match = 1.0 if any(role.lower() in job.title.lower() for role in candidate.target_roles) else 0.0
        location_match = 1.0 if any(loc.lower() in job.location.lower() for loc in candidate.location_preferences) else 0.0
        remote = 1.0 if "remote" in f"{job.work_model} {job.location}".lower() else 0.0
        rows.append([graph_scores[index], semantic[index], skill_overlap, role_match, location_match, remote])
    return np.array(rows, dtype=np.float64)


def _labels_from_events(events: List[ApplicationEvent]) -> Dict[str, float]:
    from backend.app.matching.feedback_events import latest_job_feedback_labels

    return latest_job_feedback_labels(events)


def _sigmoid(value):
    return 1.0 / (1.0 + np.exp(-np.clip(value, -30, 30)))


def _train_pytorch_graphsage(candidate: CandidateProfile, jobs: List[Job], events: List[ApplicationEvent]) -> dict:
    try:
        from backend.app.matching.pytorch_gnn import train_pytorch_graphsage

        return train_pytorch_graphsage(candidate, jobs, events)
    except Exception as exc:
        return {"trained": False, "reason": str(exc), "model": "pytorch_geometric_graphsage_link_predictor_v1"}


def _pytorch_graphsage_scores(candidate: CandidateProfile, jobs: List[Job]) -> Tuple[Optional[List[float]], str]:
    try:
        from backend.app.matching.pytorch_gnn import pytorch_graphsage_scores

        return pytorch_graphsage_scores(candidate, jobs)
    except Exception:
        return None, "hybrid_skill_semantic_graphsage_ranker_v3"
