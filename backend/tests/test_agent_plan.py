from backend.app.agents.copilot import run_copilot
from backend.app.db.session import init_db
from backend.app.seed import seed
from backend.app.schemas import Job
from backend.app.services import store


def test_copilot_returns_tool_plan_for_explain():
    init_db()
    seed()
    job = store.list_jobs()[0]

    output = run_copilot("default", f"explain {job.job_id}")

    assert output["agent"] == "jobgraph_react_tool_agent_v2"
    assert output["plan"][0]["tool"] == "explain_match"
    assert output["result"]["job"]["job_id"] == job.job_id


def test_copilot_find_best_jobs_prefers_live_jobs_when_available():
    init_db()
    store.upsert_jobs(
        [
            Job(job_id="demo_agent_test", source="demo", title="AI Engineer", company="Demo", required_skills=["Python"], apply_url=""),
            Job(job_id="adzuna_agent_test", source="adzuna", title="Machine Learning Engineer", company="Live", required_skills=["Python"], apply_url="https://provider.example/apply"),
        ]
    )

    output = run_copilot("default", "find best jobs")
    sources = {match["job"]["source"] for match in output["result"]["matches"]}

    assert sources == {"adzuna"}
