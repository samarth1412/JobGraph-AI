from __future__ import annotations

from typing import List, Tuple

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from backend.app.schemas import CandidateProfile, Job


def candidate_document(candidate: CandidateProfile) -> str:
    return " ".join(
        [
            candidate.name,
            " ".join(candidate.target_roles),
            " ".join(candidate.skills),
            " ".join(candidate.projects),
            " ".join(candidate.location_preferences),
        ]
    )


def job_document(job: Job) -> str:
    return " ".join(
        [
            job.title,
            job.company,
            job.location,
            job.work_model,
            job.description,
            " ".join(job.required_skills),
        ]
    )


def semantic_scores(candidate: CandidateProfile, jobs: List[Job]) -> List[float]:
    if not jobs:
        return []
    corpus = [candidate_document(candidate)] + [job_document(job) for job in jobs]
    matrix = TfidfVectorizer(ngram_range=(1, 2), min_df=1).fit_transform(corpus)
    return cosine_similarity(matrix[0], matrix[1:]).flatten().tolist()


def top_semantic_jobs(candidate: CandidateProfile, jobs: List[Job], k: int = 10) -> List[Tuple[Job, float]]:
    scores = semantic_scores(candidate, jobs)
    return sorted(zip(jobs, scores), key=lambda item: item[1], reverse=True)[:k]
