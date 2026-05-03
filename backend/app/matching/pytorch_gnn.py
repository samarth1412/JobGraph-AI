from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np

from backend.app.matching.trained_gnn import NEGATIVE_EVENTS, POSITIVE_EVENTS
from backend.app.schemas import ApplicationEvent, CandidateProfile, Job

PYTORCH_GNN_PATH = Path("models/pytorch_graphsage_job_ranker.pt")
MODEL_NAME = "pytorch_geometric_graphsage_link_predictor_v1"
NODE_TYPES = ["candidate", "job", "skill", "role", "location", "company", "work_model"]


@dataclass(frozen=True)
class GraphDataset:
    node_ids: List[str]
    node_features: np.ndarray
    edge_index: np.ndarray
    candidate_index: int
    job_indices: List[int]
    job_ids: List[str]


def train_pytorch_graphsage(candidate: CandidateProfile, jobs: List[Job], events: List[ApplicationEvent], path: Path = PYTORCH_GNN_PATH) -> dict:
    torch, nn, F, SAGEConv = _torch_imports()
    labels = _labels_from_events(events)
    positive_ids = {job_id for job_id, label in labels.items() if label >= 0.7}
    explicit_ids = set(labels)
    if not positive_ids and len(explicit_ids) < 2:
        return {"trained": False, "reason": "Need saved/applied positive feedback or at least two explicit labels.", "examples": len(explicit_ids)}

    dataset = _build_dataset(candidate, jobs)
    if not dataset.job_ids:
        return {"trained": False, "reason": "No jobs available for GNN training.", "examples": 0}

    pair_indices, y = _training_pairs(dataset, labels)
    if len(pair_indices) < 2 or len(set(float(value) >= 0.5 for value in y)) < 2:
        return {"trained": False, "reason": "Need both positive and negative candidate-job examples.", "examples": len(pair_indices)}

    x = torch.tensor(dataset.node_features, dtype=torch.float32)
    edge_index = torch.tensor(dataset.edge_index, dtype=torch.long)
    candidate_indices = torch.tensor([dataset.candidate_index for _ in pair_indices], dtype=torch.long)
    job_indices = torch.tensor([pair[1] for pair in pair_indices], dtype=torch.long)
    labels_tensor = torch.tensor(y, dtype=torch.float32)

    torch.manual_seed(13)
    model = GraphSageLinkPredictor(in_dim=x.shape[1], hidden_dim=48, sage_conv=SAGEConv, nn=nn)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.018, weight_decay=1e-4)

    for _ in range(260):
        model.train()
        optimizer.zero_grad()
        logits = model(x, edge_index, candidate_indices, job_indices)
        loss = F.binary_cross_entropy_with_logits(logits, labels_tensor)
        loss.backward()
        optimizer.step()

    with torch.no_grad():
        scores = torch.sigmoid(model(x, edge_index, candidate_indices, job_indices))
        predictions = (scores >= 0.5).float()
        accuracy = float((predictions == (labels_tensor >= 0.5).float()).float().mean().item())

    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "model": MODEL_NAME,
        "candidate_id": candidate.candidate_id,
        "state_dict": model.state_dict(),
        "in_dim": int(x.shape[1]),
        "hidden_dim": 48,
        "examples": len(pair_indices),
        "explicit_labels": len(explicit_ids),
        "positive_examples": int(sum(1 for value in y if value >= 0.5)),
        "accuracy": round(accuracy, 4),
        "feature_schema": "node_type_one_hot_plus_hash_v1",
    }
    torch.save(payload, path)
    result = {key: value for key, value in payload.items() if key != "state_dict"}
    result["trained"] = True
    return result


def pytorch_graphsage_scores(candidate: CandidateProfile, jobs: List[Job], path: Path = PYTORCH_GNN_PATH) -> Tuple[Optional[List[float]], str]:
    if not path.exists() or not jobs:
        return None, "hybrid_skill_semantic_graphsage_ranker_v3"
    torch, nn, _F, SAGEConv = _torch_imports()
    payload = torch.load(path, map_location="cpu", weights_only=False)
    if payload.get("model") != MODEL_NAME:
        return None, "hybrid_skill_semantic_graphsage_ranker_v3"
    if payload.get("candidate_id") and payload.get("candidate_id") != candidate.candidate_id:
        return None, "hybrid_skill_semantic_graphsage_ranker_v3"
    if not payload.get("candidate_id"):
        return None, "hybrid_skill_semantic_graphsage_ranker_v3"

    dataset = _build_dataset(candidate, jobs)
    if not dataset.job_indices:
        return [], MODEL_NAME
    model = GraphSageLinkPredictor(in_dim=int(payload["in_dim"]), hidden_dim=int(payload["hidden_dim"]), sage_conv=SAGEConv, nn=nn)
    model.load_state_dict(payload["state_dict"])
    model.eval()

    x = torch.tensor(dataset.node_features, dtype=torch.float32)
    edge_index = torch.tensor(dataset.edge_index, dtype=torch.long)
    candidate_indices = torch.tensor([dataset.candidate_index for _ in dataset.job_indices], dtype=torch.long)
    job_indices = torch.tensor(dataset.job_indices, dtype=torch.long)
    with torch.no_grad():
        scores = torch.sigmoid(model(x, edge_index, candidate_indices, job_indices)).cpu().numpy().astype(float).tolist()
    return scores, MODEL_NAME


def load_pytorch_graphsage_metadata(path: Path = PYTORCH_GNN_PATH) -> Optional[dict]:
    if not path.exists():
        return None
    torch, _nn, _F, _SAGEConv = _torch_imports()
    payload = torch.load(path, map_location="cpu", weights_only=False)
    if not payload.get("candidate_id"):
        return None
    return {key: value for key, value in payload.items() if key != "state_dict"}


class GraphSageLinkPredictor:
    def __new__(cls, in_dim: int, hidden_dim: int, sage_conv, nn):
        class _Model(nn.Module):
            def __init__(self):
                super().__init__()
                self.conv1 = sage_conv(in_dim, hidden_dim)
                self.conv2 = sage_conv(hidden_dim, hidden_dim)
                self.scorer = nn.Sequential(
                    nn.Linear(hidden_dim * 4, hidden_dim),
                    nn.ReLU(),
                    nn.Dropout(0.08),
                    nn.Linear(hidden_dim, 1),
                )

            def encode(self, x, edge_index):
                import torch.nn.functional as F

                hidden = F.relu(self.conv1(x, edge_index))
                return F.relu(self.conv2(hidden, edge_index))

            def forward(self, x, edge_index, candidate_indices, job_indices):
                embeddings = self.encode(x, edge_index)
                left = embeddings[candidate_indices]
                right = embeddings[job_indices]
                pair_features = __import__("torch").cat([left, right, (left - right).abs(), left * right], dim=1)
                return self.scorer(pair_features).squeeze(-1)

        return _Model()


def _build_dataset(candidate: CandidateProfile, jobs: List[Job]) -> GraphDataset:
    node_ids: List[str] = []
    node_types: Dict[str, str] = {}
    edges: List[Tuple[str, str]] = []

    def add_node(node_id: str, node_type: str) -> None:
        if node_id not in node_types:
            node_ids.append(node_id)
            node_types[node_id] = node_type

    def connect(left: str, left_type: str, right: str, right_type: str) -> None:
        add_node(left, left_type)
        add_node(right, right_type)
        edges.append((left, right))
        edges.append((right, left))

    candidate_node = f"candidate:{candidate.candidate_id}"
    add_node(candidate_node, "candidate")
    for skill in candidate.skills:
        connect(candidate_node, "candidate", _typed_node("skill", skill), "skill")
    for role in candidate.target_roles:
        connect(candidate_node, "candidate", _typed_node("role", role), "role")
    for location in candidate.location_preferences:
        connect(candidate_node, "candidate", _typed_node("location", location), "location")

    job_ids: List[str] = []
    for job in jobs:
        job_node = _job_node(job)
        job_ids.append(job.job_id)
        add_node(job_node, "job")
        if job.company:
            connect(job_node, "job", _typed_node("company", job.company), "company")
        if job.location:
            connect(job_node, "job", _typed_node("location", job.location), "location")
        if job.work_model:
            connect(job_node, "job", _typed_node("work_model", job.work_model), "work_model")
        for skill in job.required_skills:
            connect(job_node, "job", _typed_node("skill", skill), "skill")
        for role in candidate.target_roles:
            if role.lower() in job.title.lower():
                connect(job_node, "job", _typed_node("role", role), "role")

    index = {node_id: position for position, node_id in enumerate(node_ids)}
    if edges:
        edge_index = np.array([[index[left], index[right]] for left, right in edges], dtype=np.int64).T
    else:
        edge_index = np.empty((2, 0), dtype=np.int64)
    features = np.vstack([_node_feature(node_id, node_types[node_id]) for node_id in node_ids]).astype(np.float32)
    return GraphDataset(
        node_ids=node_ids,
        node_features=features,
        edge_index=edge_index,
        candidate_index=index[candidate_node],
        job_indices=[index[_job_node(job)] for job in jobs],
        job_ids=job_ids,
    )


def _training_pairs(dataset: GraphDataset, labels: Dict[str, float]) -> Tuple[List[Tuple[int, int]], List[float]]:
    pairs: List[Tuple[int, int]] = []
    y: List[float] = []
    job_index_by_id = dict(zip(dataset.job_ids, dataset.job_indices))

    for job_id, label in labels.items():
        if job_id in job_index_by_id:
            pairs.append((dataset.candidate_index, job_index_by_id[job_id]))
            y.append(float(label))

    positive_count = sum(1 for value in y if value >= 0.5)
    negative_count = sum(1 for value in y if value < 0.5)
    if positive_count and negative_count == 0:
        labeled = set(labels)
        for job_id, job_index in job_index_by_id.items():
            if job_id not in labeled:
                pairs.append((dataset.candidate_index, job_index))
                y.append(0.05)
                if sum(1 for value in y if value < 0.5) >= max(positive_count, 3):
                    break
    return pairs, y


def _labels_from_events(events: List[ApplicationEvent]) -> Dict[str, float]:
    labels: Dict[str, float] = {}
    for event in events:
        if event.status in POSITIVE_EVENTS:
            labels[event.job_id] = max(labels.get(event.job_id, 0.0), POSITIVE_EVENTS[event.status])
        if event.status in NEGATIVE_EVENTS and event.job_id not in labels:
            labels[event.job_id] = NEGATIVE_EVENTS[event.status]
    return labels


def _node_feature(node_id: str, node_type: str, hash_dim: int = 32) -> np.ndarray:
    one_hot = np.zeros(len(NODE_TYPES), dtype=np.float32)
    one_hot[NODE_TYPES.index(node_type)] = 1.0
    digest = hashlib.sha256(node_id.encode("utf-8")).digest()
    hashed = np.fromiter(_bytes_to_values(digest, hash_dim), dtype=np.float32, count=hash_dim)
    return np.concatenate([one_hot, hashed])


def _bytes_to_values(digest: bytes, dim: int) -> Iterable[float]:
    for index in range(dim):
        yield (digest[index % len(digest)] / 127.5) - 1.0


def _job_node(job: Job) -> str:
    return f"job:{job.job_id}"


def _typed_node(node_type: str, value: str) -> str:
    return f"{node_type}:{value.lower().strip()}"


def _torch_imports():
    try:
        import torch
        import torch.nn as nn
        import torch.nn.functional as F
        from torch_geometric.nn import SAGEConv
    except Exception as exc:
        raise RuntimeError("PyTorch and torch_geometric are required for the trained GraphSAGE model.") from exc
    return torch, nn, F, SAGEConv
