from __future__ import annotations

import re
from backend.app.agents import tools


def run_copilot(candidate_id: str, message: str) -> dict:
    lowered = message.lower()
    job_ids = re.findall(r"(?:demo|adzuna|usajobs|jsearch)_[a-z0-9]{12}|job_[a-z0-9_]+", message)
    if "cover" in lowered and job_ids:
        return {"intent": "generate_cover_letter", "result": tools.generate_cover_letter(candidate_id, job_ids[0])}
    if "tailor" in lowered and job_ids:
        return {"intent": "tailor_resume", "result": tools.tailor_resume(candidate_id, job_ids[0])}
    if "explain" in lowered and job_ids:
        return {"intent": "explain_match", "result": tools.explain_match(candidate_id, job_ids[0])}
    if "autofill" in lowered:
        return {"intent": "prepare_autofill", "result": tools.prepare_autofill_profile(candidate_id)}
    return {"intent": "find_best_jobs", "result": tools.find_best_jobs(candidate_id, k=10)}
