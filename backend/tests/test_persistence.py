from backend.app.db.session import init_db
from datetime import datetime, timedelta

from backend.app.schemas import ApplicationEvent, ApplySession, AutofillProfile, CandidateProfile, Job, RecommendationRun
from backend.app.seed import seed
from backend.app.services import store


def test_seeded_jobs_and_application_persist_through_store():
    init_db()
    seed()
    store.upsert_jobs(
        [
            Job(
                job_id="persistence_seed_job",
                source="ashby",
                title="ML Engineer",
                company="PersistCo",
                apply_url="https://example.com/apply",
                required_skills=["Python"],
            )
        ]
    )
    jobs = store.list_jobs()
    assert any(job.job_id == "persistence_seed_job" for job in jobs)

    event = ApplicationEvent(candidate_id="default", job_id="persistence_seed_job", status="saved")
    store.save_application(event)
    applications = store.list_applications("default")

    assert any(item.job_id == "persistence_seed_job" and item.status == "saved" for item in applications)


def test_candidate_save_populates_blank_autofill_fields():
    init_db()
    profile = CandidateProfile(
        candidate_id="autofill-test",
        name="Resume User",
        email="resume@example.com",
        phone="555-111-2222",
        links={"linkedin": "https://linkedin.com/in/resume-user", "github": "https://github.com/resume-user"},
    )

    store.save_candidate(profile)
    autofill = store.get_autofill("autofill-test")

    assert autofill.legal_name == "Resume User"
    assert autofill.email == "resume@example.com"
    assert autofill.phone == "555-111-2222"
    assert autofill.linkedin == "https://linkedin.com/in/resume-user"


def test_candidate_save_replaces_stale_resume_autofill_fields():
    init_db()
    store.save_autofill(
        AutofillProfile(
            candidate_id="autofill-refresh-test",
            legal_name="Old Seeded User",
            email="old@example.com",
            phone="555-000-0000",
            linkedin="https://linkedin.com/in/old",
            github="https://github.com/old",
            custom_answers={"why": "Keep this answer"},
        )
    )
    profile = CandidateProfile(
        candidate_id="autofill-refresh-test",
        name="Uploaded Resume User",
        email="resume@example.com",
        phone="555-111-2222",
        links={"linkedin": "https://linkedin.com/in/resume-user"},
    )

    store.save_candidate(profile)
    autofill = store.get_autofill("autofill-refresh-test")

    assert autofill.legal_name == "Uploaded Resume User"
    assert autofill.email == "resume@example.com"
    assert autofill.phone == "555-111-2222"
    assert autofill.linkedin == "https://linkedin.com/in/resume-user"
    assert autofill.github == ""
    assert autofill.custom_answers == {"why": "Keep this answer"}


def test_recommendation_runs_persist_through_store():
    init_db()
    run = RecommendationRun(
        candidate_id="run-test",
        query="machine learning engineer",
        location="Remote",
        model_source="hybrid_skill_semantic_graphsage_ranker_v3",
        model_version="local_graphsage_message_passing_v1",
        job_pool_size=2,
        match_job_ids=["job-a", "job-b"],
        parsed_resume={"skills": ["Python"]},
        diagnostics={"nodes": 4},
    )

    saved = store.save_recommendation_run(run)
    runs = store.list_recommendation_runs("run-test")

    assert saved.id is not None
    assert runs[0].query == "machine learning engineer"
    assert runs[0].match_job_ids == ["job-a", "job-b"]


def test_apply_session_persists_and_updates_status():
    init_db()
    saved = store.save_apply_session(
        ApplySession(
            candidate_id="apply-test",
            job_id="job-123",
            apply_url="https://company.example/apply",
            autofill_profile={"email": "candidate@example.com"},
            expires_at=datetime.utcnow() + timedelta(hours=1),
        )
    )

    active = store.latest_apply_session("apply-test")
    updated = store.update_apply_session_status(saved.id, "filled")

    assert active.job_id == "job-123"
    assert active.autofill_profile["email"] == "candidate@example.com"
    assert updated.status == "filled"
