from __future__ import annotations

from backend.app.matching.ranker import rank_jobs
from backend.app.schemas import ApplicationEvent
from backend.app.services import store


def find_best_jobs(candidate_id: str = "default", k: int = 10) -> dict:
    candidate = store.get_candidate(candidate_id)
    jobs = _live_preferred_jobs()
    matches = rank_jobs(candidate, jobs, k=k)
    return {"candidate_id": candidate_id, "matches": [match.model_dump() for match in matches]}


def explain_match(candidate_id: str, job_id: str) -> dict:
    candidate = store.get_candidate(candidate_id)
    job = store.get_job(job_id)
    return rank_jobs(candidate, [job], k=1)[0].model_dump()


def tailor_resume(candidate_id: str, job_id: str) -> dict:
    match = explain_match(candidate_id, job_id)
    missing = match["missing_skills"]
    bullets = [f"Emphasize production experience with {skill} if you have it; otherwise add a focused project section." for skill in missing[:5]]
    return {"job_id": job_id, "resume_strategy": bullets, "ats_keywords": match["matched_skills"] + missing[:8]}


def analyze_keyword_gaps(candidate_id: str, job_id: str) -> dict:
    match = explain_match(candidate_id, job_id)
    missing = match["missing_skills"]
    matched = match["matched_skills"]
    recommendations = [
        f"Add a truthful resume bullet or project detail that demonstrates {skill}."
        for skill in missing[:8]
    ]
    if not recommendations:
        recommendations = ["Your resume already covers the extracted keywords for this posting. Focus on stronger impact metrics."]
    return {
        "job_id": job_id,
        "matched_keywords": matched,
        "missing_keywords": missing,
        "recommendations": recommendations,
        "fit_explanation": match["explanation"],
    }


def generate_cover_letter(candidate_id: str, job_id: str) -> dict:
    candidate = store.get_candidate(candidate_id)
    job = store.get_job(job_id)
    match = explain_match(candidate_id, job_id)
    draft = f"Dear {job.company} team,\n\nI am excited to apply for the {job.title} role. My background in {', '.join(candidate.skills[:5])} aligns with the role's needs, especially {', '.join(match['matched_skills'][:4])}.\n\nSincerely,\n{candidate.name or 'Candidate'}"
    return {"job_id": job_id, "cover_letter": draft}


def prepare_autofill_profile(candidate_id: str = "default") -> dict:
    return store.get_autofill(candidate_id).model_dump()


def prepare_application(candidate_id: str, job_id: str) -> dict:
    job = store.get_job(job_id)
    profile = store.get_autofill(candidate_id)
    resume_strategy = tailor_resume(candidate_id, job_id)
    return {
        "job_id": job_id,
        "title": job.title,
        "company": job.company,
        "apply_url": job.apply_url,
        "can_open_apply_portal": bool(job.apply_url),
        "autofill_profile": profile.model_dump(),
        "resume_strategy": resume_strategy,
        "human_review_required": True,
        "next_step": "Open the apply URL, then use the JobGraph Chrome extension to fill fields from this profile.",
    }


def track_application(candidate_id: str, job_id: str, status: str, note: str = "") -> dict:
    event = ApplicationEvent(candidate_id=candidate_id, job_id=job_id, status=status, note=note)
    store.save_application(event)
    return {"stored": True, "event": event.model_dump()}


def _live_preferred_jobs():
    jobs = store.list_jobs()
    live_jobs = [job for job in jobs if job.source != "demo"]
    return live_jobs or jobs
