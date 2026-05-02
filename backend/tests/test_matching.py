from backend.app.matching.ranker import rank_jobs
from backend.app.schemas import CandidateProfile, Job


def test_rank_jobs_prefers_skill_overlap():
    candidate = CandidateProfile(candidate_id="c", skills=["Python", "PyTorch"], target_roles=["Machine Learning Engineer"])
    jobs = [Job(job_id="a", source="test", title="Machine Learning Engineer", company="A", required_skills=["Python", "PyTorch"]), Job(job_id="b", source="test", title="Data Analyst", company="B", required_skills=["SQL", "Tableau"])]
    ranked = rank_jobs(candidate, jobs)
    assert ranked[0].job.job_id == "a"
    assert ranked[0].score > ranked[1].score
    assert "semantic" in ranked[0].explanation.lower()
