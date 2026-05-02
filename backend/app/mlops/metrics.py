from __future__ import annotations

from backend.app.services import store


def system_metrics() -> dict:
    counts = store.metrics_counts()
    counts.update({"model": "skill_graph_ranker_v0", "next_model": "heterogeneous_graphsage_link_prediction"})
    return counts
