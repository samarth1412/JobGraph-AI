from backend.app.matching.trained_gnn import train_graph_ranker, trained_scores
from backend.app.schemas import ApplicationEvent, CandidateProfile, Job


def test_train_graph_ranker_learns_from_application_feedback(tmp_path):
    candidate = CandidateProfile(
        candidate_id="c",
        skills=["Python", "PyTorch", "FastAPI"],
        target_roles=["Machine Learning Engineer"],
        location_preferences=["Remote"],
    )
    jobs = [
        Job(job_id="good", source="ashby", title="Machine Learning Engineer", company="A", location="Remote", work_model="remote", required_skills=["Python", "PyTorch"]),
        Job(job_id="bad", source="ashby", title="Sales Associate", company="B", location="Onsite", work_model="onsite", required_skills=["Salesforce"]),
    ]
    events = [
        ApplicationEvent(candidate_id="c", job_id="good", status="applied"),
        ApplicationEvent(candidate_id="c", job_id="bad", status="skipped"),
    ]
    model_path = tmp_path / "gnn_ranker.json"

    result = train_graph_ranker(candidate, jobs, events, path=model_path)
    scores, model_source = trained_scores(candidate, jobs, path=model_path)

    assert result["trained"] is True
    assert model_path.exists()
    assert model_source == "trained_graphsage_feedback_ranker_v1"
    assert scores[0] > scores[1]
