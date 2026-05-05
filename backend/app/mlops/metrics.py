from __future__ import annotations

from backend.app.ingestion.sources import scraper_jobs, scraper_source_counts
from backend.app.matching.pytorch_gnn import load_pytorch_graphsage_metadata
from backend.app.matching.trained_gnn import load_trained_ranker
from backend.app.services import store


def system_metrics() -> dict:
    counts = store.metrics_counts()
    active_jobs = scraper_jobs(store.list_jobs())
    trained_model = load_trained_ranker()
    try:
        pytorch_model = load_pytorch_graphsage_metadata()
    except Exception as exc:
        pytorch_model = {"available": False, "reason": str(exc), "model": "pytorch_geometric_graphsage_link_predictor_v1"}
    counts.update(
        {
            "jobs_total_all": counts["jobs_total"],
            "jobs_total": len(active_jobs),
            "jobs_by_source_all": counts["jobs_by_source"],
            "jobs_by_source": scraper_source_counts(active_jobs),
            "model": "hybrid_skill_semantic_graphsage_ranker_v3",
            "trained_model": trained_model.__dict__ if trained_model else None,
            "pytorch_graphsage_model": pytorch_model,
            "next_model": "multi_candidate_batch_training_and_model_registry",
        }
    )
    return counts
