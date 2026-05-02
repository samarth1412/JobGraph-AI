from backend.app.db.session import init_db
from backend.app.schemas import ApplicationEvent, CandidateProfile
from backend.app.seed import seed
from backend.app.services import store


def test_seeded_jobs_and_application_persist_through_store():
    init_db()
    seed()
    jobs = store.list_jobs()
    assert jobs

    event = ApplicationEvent(candidate_id="default", job_id=jobs[0].job_id, status="saved")
    store.save_application(event)
    applications = store.list_applications("default")

    assert any(item.job_id == jobs[0].job_id and item.status == "saved" for item in applications)


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
