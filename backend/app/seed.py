from __future__ import annotations

from backend.app.ingestion.normalize import stable_job_id
from backend.app.matching.skills import extract_skills
from backend.app.schemas import CandidateProfile, Job
from backend.app.services import store


def seed() -> None:
    if store.JOBS:
        return
    profile = CandidateProfile(candidate_id="default", name="Manav", email="manav@example.com", target_roles=["Machine Learning Engineer", "AI Engineer", "Recommendation Systems Engineer"], location_preferences=["Remote", "California", "New York"], skills=["Python", "PyTorch", "FastAPI", "Docker", "LangGraph", "RAG", "ML Evaluation", "Graph Neural Networks", "Recommendation Systems"], links={"github": "https://github.com/example", "linkedin": "https://linkedin.com/in/example"})
    store.save_candidate(profile)
    samples = [("Machine Learning Engineer - New Grad", "Northstar AI", "California", "Build PyTorch model serving systems with FastAPI, Docker, MLflow, and evaluation pipelines."), ("AI Engineer - Agentic Workflows", "Orbit Labs", "Remote", "Build LangGraph agents, RAG evaluation, tool calling, and OpenTelemetry traces."), ("Recommendation Systems Engineer", "ShopGraph", "New York", "Train ranking and graph neural networks for product recommendations using PyTorch Geometric.")]
    jobs = []
    for title, company, location, description in samples:
        jobs.append(Job(job_id=stable_job_id("demo", title, company, location), source="demo", title=title, company=company, location=location, work_model="remote" if location == "Remote" else "onsite", description=description, apply_url="https://example.com/apply", required_skills=extract_skills(description)))
    store.upsert_jobs(jobs)


if __name__ == "__main__":
    seed()
    print("Seeded demo candidate and jobs")
