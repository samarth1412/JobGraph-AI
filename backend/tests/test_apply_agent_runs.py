from backend.app.apply_agent.browser import cancel_apply_run, continue_apply_run, create_apply_run
from backend.app.db.session import init_db
from backend.app.schemas import AutofillProfile, CandidateProfile, Job
from backend.app.services import store


def test_apply_agent_run_persists_start_and_cancel_state():
    init_db()
    store.upsert_jobs(
        [
            Job(
                job_id="apply-agent-test",
                source="greenhouse",
                title="Machine Learning Engineer",
                company="Graph Labs",
                apply_url="https://boards.greenhouse.io/graph/jobs/123",
                required_skills=["Python"],
            )
        ]
    )
    store.save_candidate(CandidateProfile(candidate_id="apply-agent-candidate", name="Resume User", email="resume@example.com"))
    store.save_autofill(AutofillProfile(candidate_id="apply-agent-candidate", legal_name="Resume User", email="resume@example.com"))

    run = create_apply_run("apply-agent-candidate", "apply-agent-test", headless=True)
    continued = continue_apply_run(run.id)
    cancelled = cancel_apply_run(run.id)
    listed = store.list_apply_agent_runs("apply-agent-candidate")

    assert run.id is not None
    assert run.status == "starting"
    assert run.ats == "greenhouse"
    assert continued.metadata["submit_policy"] == "never_submit_without_user_approval"
    assert cancelled.status == "cancelled"
    assert listed[0].id == run.id


def test_apply_agent_run_fails_without_apply_url():
    init_db()
    store.upsert_jobs([Job(job_id="apply-agent-no-url", source="ashby", title="ML Engineer", company="Graph Labs")])

    run = create_apply_run("default", "apply-agent-no-url")

    assert run.status == "failed"
    assert "apply URL" in run.error
