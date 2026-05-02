from __future__ import annotations

from backend.app.services import store


def system_metrics() -> dict:
    sources = {}
    for job in store.JOBS.values():
        sources[job.source] = sources.get(job.source, 0) + 1
    return {"jobs_total": len(store.JOBS), "candidates_total": len(store.CANDIDATES), "applications_total": len(store.APPLICATIONS), "jobs_by_source": sources, "model": "skill_graph_ranker_v0", "next_model": "heterogeneous_graphsage_link_prediction"}
