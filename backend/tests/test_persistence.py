from backend.app.db.session import init_db
from backend.app.schemas import ApplicationEvent
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
