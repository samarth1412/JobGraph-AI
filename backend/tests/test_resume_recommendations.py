import asyncio
from io import BytesIO

from fastapi import UploadFile

from backend.app.main import recommend_from_resume
from backend.app.schemas import Job
from backend.app.services import store


def test_resume_recommendation_endpoint_returns_gnn_ranked_matches():
    store.upsert_jobs(
        [
            Job(
                job_id="endpoint-good",
                source="ashby",
                title="Machine Learning Engineer",
                company="Graph Labs",
                location="Remote",
                work_model="remote",
                description="Build PyTorch recommendation models and graph neural networks.",
                required_skills=["Python", "PyTorch", "Graph Neural Networks"],
            ),
            Job(
                job_id="endpoint-weak",
                source="ashby",
                title="Sales Operations Associate",
                company="Ops Co",
                location="Onsite",
                work_model="onsite",
                description="Maintain CRM records and support sales operations.",
                required_skills=["Salesforce"],
            ),
        ]
    )
    resume = b"""
    Manav Sharma
    manav@example.com

    Skills
    Python, PyTorch, Graph Neural Networks, Recommendation Systems

    Projects
    Built a GNN based job recommendation engine.
    """

    payload = asyncio.run(
        recommend_from_resume(
            candidate_id="endpoint-test",
            k=10000,
            file=UploadFile(filename="resume.txt", file=BytesIO(resume)),
        )
    )

    matches = {item["job"]["job_id"]: item for item in payload["matches"]}
    assert payload["candidate"]["skills"]
    assert payload["parsed_resume"]["inferred_search_query"]
    assert payload["recommendation_run"]["id"] is not None
    assert payload["gnn_diagnostics"]["model"] == "local_graphsage_message_passing_v1"
    assert matches["endpoint-good"]["score"] > matches["endpoint-weak"]["score"]
    assert matches["endpoint-good"]["gnn_score"] > matches["endpoint-weak"]["gnn_score"]
