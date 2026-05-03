from backend.app.matching import ranker
from backend.app.matching.graphsage import graphsage_affinity_scores
from backend.app.schemas import CandidateProfile, Job


def test_graph_affinity_prefers_skill_connected_job(monkeypatch):
    monkeypatch.setattr(ranker, "trained_scores", lambda candidate, jobs: (None, "hybrid_skill_semantic_graphsage_ranker_v3"))
    candidate = CandidateProfile(candidate_id="c", skills=["Python", "PyTorch"], target_roles=["Machine Learning Engineer"])
    jobs = [
        Job(job_id="good", source="test", title="Machine Learning Engineer", company="A", required_skills=["Python", "PyTorch"]),
        Job(job_id="weak", source="test", title="Sales Associate", company="B", required_skills=["Redis"]),
    ]

    scores, diagnostics = graphsage_affinity_scores(candidate, jobs)
    ranked = ranker.rank_jobs(candidate, jobs)

    assert diagnostics.nodes > 0
    assert diagnostics.model == "local_graphsage_message_passing_v1"
    assert scores[0] > scores[1]
    assert ranked[0].job.job_id == "good"
    assert ranked[0].model_source in {"hybrid_skill_semantic_graphsage_ranker_v3", "pytorch_geometric_graphsage_link_predictor_v1"}
    assert "gnn graph affinity" in ranked[0].explanation.lower()
