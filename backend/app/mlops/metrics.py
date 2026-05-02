from __future__ import annotations

from backend.app.services import store


def system_metrics() -> dict:
    counts = store.metrics_counts()
    counts.update({"model": "hybrid_skill_semantic_graphsage_ranker_v3", "next_model": "trained_pytorch_geometric_graphsage_link_prediction"})
    return counts
