"""Latest-per-job application labels for ranking and evaluation."""

from __future__ import annotations

from typing import Dict, List

from backend.app.matching.trained_gnn import NEGATIVE_EVENTS, POSITIVE_EVENTS
from backend.app.schemas import ApplicationEvent


def latest_job_feedback_labels(events: List[ApplicationEvent]) -> Dict[str, float]:
    """Use only the most recent event per job so Saved→Applied→Interview flows make sense."""
    ordered = sorted(events, key=lambda e: e.timestamp)
    latest: Dict[str, ApplicationEvent] = {}
    for event in ordered:
        latest[event.job_id] = event
    labels: Dict[str, float] = {}
    for job_id, event in latest.items():
        if event.status in POSITIVE_EVENTS:
            labels[job_id] = POSITIVE_EVENTS[event.status]
        elif event.status in NEGATIVE_EVENTS:
            labels[job_id] = NEGATIVE_EVENTS[event.status]
    return labels
