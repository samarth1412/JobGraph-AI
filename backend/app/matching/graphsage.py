from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Dict, Iterable, List, Tuple

import numpy as np

from backend.app.schemas import CandidateProfile, Job


@dataclass(frozen=True)
class GraphSageDiagnostics:
    nodes: int
    edges: int
    layers: int
    embedding_dim: int
    model: str = "local_graphsage_message_passing_v1"


def graphsage_affinity_scores(candidate: CandidateProfile, jobs: List[Job], layers: int = 2, dim: int = 32) -> Tuple[List[float], GraphSageDiagnostics]:
    """Run deterministic GraphSAGE-style inference over the candidate-job graph.

    This is a local inference baseline, not a trained PyTorch model. It uses
    typed graph construction, deterministic feature initialization, weighted
    mean neighborhood aggregation, and candidate-job embedding similarity. The
    shape mirrors the production path for a future trained PyTorch Geometric
    GraphSAGE link-prediction model.
    """
    graph = _build_graph(candidate, jobs)
    embeddings = {node: _initial_embedding(node, dim) for node in graph}

    for _ in range(layers):
        next_embeddings: Dict[str, np.ndarray] = {}
        for node, neighbors in graph.items():
            if not neighbors:
                next_embeddings[node] = embeddings[node]
                continue
            total_weight = sum(weight for _, weight in neighbors) or 1.0
            neighbor_mean = sum(embeddings[neighbor] * weight for neighbor, weight in neighbors) / total_weight
            next_embeddings[node] = _normalize(0.52 * embeddings[node] + 0.48 * neighbor_mean)
        embeddings = next_embeddings

    candidate_node = _candidate_node(candidate)
    candidate_embedding = embeddings.get(candidate_node, _initial_embedding(candidate_node, dim))
    raw_scores = []
    for job in jobs:
        job_embedding = embeddings.get(_job_node(job), _initial_embedding(_job_node(job), dim))
        cosine = float(np.dot(candidate_embedding, job_embedding))
        skill_prior = _skill_overlap_prior(candidate, job)
        raw_scores.append(0.72 * ((cosine + 1.0) / 2.0) + 0.28 * skill_prior)

    max_score = max(raw_scores) if raw_scores else 1.0
    min_score = min(raw_scores) if raw_scores else 0.0
    spread = max(max_score - min_score, 1e-9)
    normalized = [(score - min_score) / spread for score in raw_scores] if len(raw_scores) > 1 else raw_scores
    edge_count = sum(len(neighbors) for neighbors in graph.values()) // 2
    return normalized, GraphSageDiagnostics(nodes=len(graph), edges=edge_count, layers=layers, embedding_dim=dim)


def _build_graph(candidate: CandidateProfile, jobs: List[Job]) -> Dict[str, List[Tuple[str, float]]]:
    graph: Dict[str, List[Tuple[str, float]]] = {}

    def connect(left: str, right: str, weight: float) -> None:
        graph.setdefault(left, []).append((right, weight))
        graph.setdefault(right, []).append((left, weight))

    candidate_node = _candidate_node(candidate)
    graph.setdefault(candidate_node, [])

    for skill in candidate.skills:
        connect(candidate_node, _typed_node("skill", skill), 1.2)

    for role in candidate.target_roles:
        connect(candidate_node, _typed_node("role", role), 0.75)

    for location in candidate.location_preferences:
        connect(candidate_node, _typed_node("location", location), 0.45)

    for job in jobs:
        job_node = _job_node(job)
        graph.setdefault(job_node, [])
        connect(job_node, _typed_node("company", job.company), 0.22)
        if job.location:
            connect(job_node, _typed_node("location", job.location), 0.38)
        if job.work_model:
            connect(job_node, _typed_node("work_model", job.work_model), 0.35)
        for skill in job.required_skills:
            connect(job_node, _typed_node("skill", skill), 1.0)
        for role in candidate.target_roles:
            if role.lower() in job.title.lower():
                connect(job_node, _typed_node("role", role), 0.9)

    return graph


def _skill_overlap_prior(candidate: CandidateProfile, job: Job) -> float:
    candidate_skills = {skill.lower() for skill in candidate.skills}
    required = {skill.lower() for skill in job.required_skills}
    if not required:
        return 0.0
    return len(candidate_skills & required) / len(required)


def _candidate_node(candidate: CandidateProfile) -> str:
    return f"candidate:{candidate.candidate_id}"


def _job_node(job: Job) -> str:
    return f"job:{job.job_id}"


def _typed_node(node_type: str, value: str) -> str:
    return f"{node_type}:{value.lower().strip()}"


def _initial_embedding(node: str, dim: int) -> np.ndarray:
    digest = hashlib.sha256(node.encode("utf-8")).digest()
    values = np.fromiter(_bytes_to_values(digest, dim), dtype=np.float64, count=dim)
    return _normalize(values)


def _bytes_to_values(digest: bytes, dim: int) -> Iterable[float]:
    index = 0
    while index < dim:
        byte = digest[index % len(digest)]
        yield (byte / 127.5) - 1.0
        index += 1


def _normalize(vector: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vector)
    if norm == 0:
        return vector
    return vector / norm
