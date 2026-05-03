from backend.app.matching.evaluation import evaluate_ranker
from backend.app.schemas import ApplicationEvent, CandidateProfile, Job


def test_evaluate_ranker_reports_feedback_metrics():
    candidate = CandidateProfile(
        candidate_id="eval",
        skills=["Python", "PyTorch"],
        target_roles=["Machine Learning Engineer"],
        location_preferences=["Remote"],
    )
    jobs = [
        Job(job_id="good", source="ashby", title="Machine Learning Engineer", company="A", location="Remote", required_skills=["Python", "PyTorch"]),
        Job(job_id="bad", source="ashby", title="Sales Associate", company="B", location="Onsite", required_skills=["Salesforce"]),
    ]
    events = [
        ApplicationEvent(candidate_id="eval", job_id="good", status="applied"),
        ApplicationEvent(candidate_id="eval", job_id="bad", status="skipped"),
    ]

    metrics = evaluate_ranker(candidate, jobs, events, k=2)

    assert metrics["evaluated"] is True
    assert metrics["positive_jobs"] == 1
    assert metrics["mrr"] == 1.0
    assert metrics["ndcg_at_k"] > 0
