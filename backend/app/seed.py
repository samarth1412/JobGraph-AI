from __future__ import annotations

from backend.app.schemas import CandidateProfile
from backend.app.services import store


def seed() -> None:
    profile = CandidateProfile(
        candidate_id="default",
        name="Manav",
        email="manav@example.com",
        target_roles=["Machine Learning Engineer", "AI Engineer", "Recommendation Systems Engineer"],
        location_preferences=["Remote", "California", "New York"],
        skills=["Python", "PyTorch", "FastAPI", "Docker", "LangGraph", "RAG", "ML Evaluation", "Graph Neural Networks", "Recommendation Systems"],
        links={"github": "https://github.com/example", "linkedin": "https://linkedin.com/in/example"},
    )
    if not store.get_candidate("default").skills:
        store.save_candidate(profile)


if __name__ == "__main__":
    seed()
    print("Seeded default candidate (ATS jobs come from ingestion, not demo data).")
