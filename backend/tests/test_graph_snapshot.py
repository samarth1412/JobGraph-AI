from backend.app.matching.graph import build_graph_snapshot
from backend.app.schemas import CandidateProfile, Job


def test_graph_snapshot_contains_candidate_job_and_skill_nodes():
    candidate = CandidateProfile(candidate_id="c", name="Candidate", skills=["Python"])
    jobs = [Job(job_id="j", source="test", title="ML Engineer", company="Acme", required_skills=["Python", "Docker"])]

    graph = build_graph_snapshot(candidate, jobs)
    node_types = {node["type"] for node in graph["nodes"]}
    edge_types = {edge["type"] for edge in graph["edges"]}

    assert {"candidate", "job", "skill", "company"}.issubset(node_types)
    assert {"has_skill", "requires_skill"}.issubset(edge_types)
    assert graph["summary"]["jobs"] == 1
