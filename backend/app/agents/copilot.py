from __future__ import annotations

from backend.app.agents.planner import JobSearchAgent


def run_copilot(candidate_id: str, message: str) -> dict:
    return JobSearchAgent(candidate_id).run(message)
