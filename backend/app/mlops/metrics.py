from __future__ import annotations

from backend.app.ingestion.sources import scraper_jobs, scraper_source_counts
from backend.app.services import store


def system_metrics() -> dict:
    counts = store.metrics_counts()
    active_jobs = scraper_jobs(store.list_jobs())
    counts.update(
        {
            "jobs_total_all": counts["jobs_total"],
            "jobs_total": len(active_jobs),
            "jobs_by_source_all": counts["jobs_by_source"],
            "jobs_by_source": scraper_source_counts(active_jobs),
            "model": "hybrid_skill_semantic_graphsage_ranker_v3",
            "next_model": "trained_pytorch_geometric_graphsage_link_prediction",
        }
    )
    return counts
