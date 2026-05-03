from backend.app.matching.pytorch_gnn import MODEL_NAME, pytorch_graphsage_scores, train_pytorch_graphsage
from backend.app.schemas import ApplicationEvent, CandidateProfile, Job


def test_pytorch_graphsage_trains_and_scores_feedback(tmp_path):
    candidate = CandidateProfile(
        candidate_id="torch-c",
        skills=["Python", "PyTorch", "Graph Neural Networks"],
        target_roles=["Machine Learning Engineer"],
        location_preferences=["Remote"],
    )
    jobs = [
        Job(job_id="good", source="ashby", title="Machine Learning Engineer", company="A", location="Remote", required_skills=["Python", "PyTorch"]),
        Job(job_id="bad", source="ashby", title="Sales Associate", company="B", location="Onsite", required_skills=["Salesforce"]),
        Job(job_id="weak", source="ashby", title="Data Analyst", company="C", location="Onsite", required_skills=["SQL"]),
    ]
    events = [
        ApplicationEvent(candidate_id="torch-c", job_id="good", status="applied"),
        ApplicationEvent(candidate_id="torch-c", job_id="bad", status="skipped"),
    ]
    model_path = tmp_path / "graphsage.pt"

    result = train_pytorch_graphsage(candidate, jobs, events, path=model_path)
    scores, source = pytorch_graphsage_scores(candidate, jobs, path=model_path)

    assert result["trained"] is True
    assert result["model"] == MODEL_NAME
    assert source == MODEL_NAME
    assert scores[0] > scores[1]
